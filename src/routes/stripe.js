
const _ = require('lodash')
const express = require('express')

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  maxNetworkRetries: 3,
})

// billing cycle:
// - payment fails
// - bap subscription disabled
// - stripe will retry on payment update & new billing cycle
// - once payment succeeds, then bap subscription re-enabled

// const STRIPE_STATUS = {/* eslint-disable camelcase */
//   active: 'Active',
//   past_due: 'Past Due',
//   unpaid: 'Unpaid',
//   canceled: 'Canceled',
//   incomplete: 'Incomplete',
//   incomplete_expired: 'Incomplete',
//   trialing: 'Trial',
// }

module.exports = ({app, log, sequelize}) => { // eslint-disable-line no-unused-vars
  const model = require('@bap/cotton/model')(sequelize)
  const libstripe = require('@bap/cotton/lib/stripe')({log, sequelize})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  app.get('/stripe/customer', async (req, res) => {
    const customer = await stripe.customers.retrieve(req.user.stripeId, {
      expand: ['invoice_settings.default_payment_method'],
    })
    res.status(200).send(customer)
  })

  app.get('/products', async (req, res) => { // TODO: deprecate
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', model.User, userId)
    }
    const where = {}
    if (req.query.kind) {
      where.kind = req.query.kind
    }
    const settings = await model.settingsForUser(userId)
    const products = (await model.Product.findAll({
      where,
      order: ['kind', 'price'],
    })).map(i => i.toJSON())
    const offered = []
    for (const product of products) {
      const overrides = settings.products[product.id]
      if (settings.products[product.id]) {
        overrides.enabled = true
        offered.push(_.merge(product, overrides))
      }
    }
    // if (settings) {
    //   for (const product of products) {
    //     product.enabled = true
    //     const overrides = settings.products[product.id]
    //     if (overrides) {
    //       _.assign(product, overrides)
    //     }
    //   }
    // }
    res.status(200).send(offered)
  })

  app.get('/credit-cards', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', model.User, userId)
    }
    const user = await model.User.findByPk(userId)
    if (!user.stripeId) {
      res.status(200).send([])
      return
    }
    const cards = await stripe.paymentMethods.list({
      customer: user.stripeId,
      type: 'card',
      limit: 99,
    })
    const l = []
    for (const card of cards.data) {
      l.push(await xforms.card(card))
    }
    res.status(200).send(l)
  })

  app.get('/credit-cards/:id', async (req, res) => {
    const card = await stripe.paymentMethods.retrieve(req.params.id)
    const user = await model.User.findOne({where: {
      stripeId: card.customer,
    }})
    if (!user) {
      log.error({id: req.params.id}, 'unable to find customer for payment method:', req.params.id)
      res.status(200).send({error: 'unknown payment method'})
      return
    }
    res.status(200).send(await xforms.card(card))
  })

  app.post('/credit-cards', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('update', model.User, userId)
    }
    const user = await model.User.findByPk(userId)
    const needsStripeAcct = !user.stripeId
    if (needsStripeAcct) {
      try { /* eslint-disable camelcase */
        user.stripeId = (await stripe.customers.create({
          email: user.email,
          name: user.fullname,
          tax_exempt: 'reverse',
        })).id
        await user.save()
      } catch (err) {
        res.status(400).send(libstripe.userErrMsg(err, user.email, 'failed to create stripe account'))
        return
      }
    }
    let card = null
    try { /* eslint-disable camelcase */
      const setup = await stripe.setupIntents.create({
        confirm: true,
        customer: user.stripeId,
        payment_method: libstripe.asDefaultCard(user.stripeId, req.body.id),
      })
      if (setup.status === 'requires_action') {
        res.status(400).send({error: 'SCA', secret: setup.client_secret})
        return
      }
      card = await stripe.paymentMethods.attach(
        req.body.id,
        {customer: user.stripeId},
      )
      if (needsStripeAcct || req.body.default) {
        await stripe.customers.update(user.stripeId, {
          invoice_settings: {
            default_payment_method: card.id,
          },
        })
        // libstripe.defaultCard.cache.delete(card.customer)
      }
      if (req.body.unpaid) {
        await libstripe.updateSubscriptionCard(parseInt(req.body.unpaid), card.id)
      }
    } catch (err) {
      res.status(400).send(libstripe.userErrMsg(err, card?.id || req.body.id, 'failed to add card'))
      return
    }
    res.status(200).send(await xforms.card(card))
  })

  app.put('/credit-cards/:id', async (req, res) => {
    let pm = await stripe.paymentMethods.retrieve(req.params.id)
    const user = await model.User.findOne({where: {
      stripeId: pm.customer,
    }})
    if (!user) {
      log.error({id: req.params.id}, 'unable to find customer for payment method:', req.params.id)
      res.status(200).send({error: 'unknown payment method'})
      return
    }
    if (req.body.default) { /* eslint-disable camelcase */
      await stripe.customers.update(user.stripeId, {
        invoice_settings: {
          default_payment_method: pm.id,
        },
      })
      // libstripe.defaultCard.cache.delete(pm.customer)
    }
    if (req.body.name) { /* eslint-disable camelcase */
      const [exp_month, exp_year] = req.body.expires?.split('/').map(i => parseInt(i))
      if (!exp_month || !exp_year) {
        res.status(200).send({id: pm.id, error: 'invalid field: expires'})
        return
      }
      pm = await stripe.paymentMethods.update(pm.id, {
        card: {
          exp_month,
          exp_year,
        },
        billing_details: {
          name: req.body.name,
        },
      })
      // libstripe.getCard.cache.set(pm.id, pm)
    }
    res.status(200).send(await xforms.card(pm))
  })

  app.delete('/credit-cards/:id', async (req, res) => {
    const pm = await stripe.paymentMethods.retrieve(req.params.id)
    const user = await model.User.findOne({where: {
      stripeId: pm.customer,
    }})
    if (!user) {
      log.error({id: pm.id}, 'unable to find customer for payment method:', pm.id)
      res.status(200).send({error: 'unknown payment method'})
      return
    }
    const defcard = await libstripe.defaultCard(user.stripeId)
    if (defcard.id === pm.id) {
      res.status(200).send({id: pm.id, error: 'cannot remove default payment method'})
      return
    }
    await req.user.can('update', model.User, user.id)
    const subscriptions = await model.Subscription.findAll({where: {cardId: pm.id}})
    if (subscriptions.length > 0) {
      for (const subscription of subscriptions) {
        subscription.cardId = defcard.id
        await subscription.save()
      }
    }
    await stripe.paymentMethods.detach(pm.id)
    res.status(200).send({id: pm.id}) // await xforms.card(pm))
  })

  // TODO: sort by status, start date
  // status enum: active past_due unpaid canceled incomplete incomplete_expired trialing all ended
  // * No Book  (active subscription, but no assigned book) (color: danger alert)
  // * Active (active subscription and assigned book) (color: primary alert)
  // * Paused (user can not pause/unpause, but Partner can and we can) (color: warning alert)
  // * One-Time (a non-recurring subscription, like Boosts) (color: info alert
  // * Cancelled (color: dark alert)

  app.get('/coupons/:id', async (req, res) => {
    const id = req.params.id
    try {
      const coupon = await stripe.coupons.retrieve(id)
      if (!coupon.valid) {
        res.status(200).send({id, valid: false})
        return
      }
      const amount = coupon.amount_off ? `$${Math.floor(coupon.amount_off / 100)}` : `${coupon.percent_off}%`
      let duration = null
      if (!coupon.duration_in_months) {
        duration = coupon.duration
      } else if (coupon.duration_in_months === 1) {
        duration = 'for 1 month'
      } else {
        duration = `for ${coupon.duration_in_months} months`
      }
      res.status(200).send({id, valid: true, msg: `${amount} off ${duration}`})
    } catch (err) {
      log.error(err, 'failed to lookup coupon:', id)
      res.status(200).send({id, valid: false})
    }
  })

  // Handle the event:
  // - https://stripe.com/docs/api/events/types
  // - https://stripe.com/docs/billing/webhooks

  // Basic testing with payloads that aren't very useful:
  // - stripe listen --events invoice.payment_succeeded --forward-to localhost:3001/stripe/webhook
  // - strip trigger invoice.payment_succeeded

  // Testing with real-world payloads:
  // - mount this stripe.js over image stripe.js and resend webhooks

  app.post('/stripe/webhook', express.raw({type: 'application/json'}), async (req, res) => {
    let event = null
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        req.headers['stripe-signature'],
        process.env.STRIPE_WEBHOOK_SECRET
      )
    } catch (err) {
      log.error(err, 'stripe webhook signature verification failed')
      res.sendStatus(500)
      return
    }
    const data = event.data.object
    log.info({id: data.id, type: data.object}, 'stripe webhook:', event.type, data.id)

    if (event.type === 'charge.succeeded') {
      // for handling adhoc payments (not invoices)
      await libstripe.onChargeSucceeded(data)
    } else if (event.type === 'invoice.payment_succeeded') {
      // couldn't use charge.succeeded cuz that event doesn't fire when amount=0 (eg credit balance, legacy paypal)
      await libstripe.onInvoicePaid(data)
    } else if (event.type === 'invoice.payment_failed') {
      // for handling invoice payment failures, adhoc payments communicated in real time
      await libstripe.onInvoiceUnpaid(data)
    } else if (event.type === 'customer.subscription.deleted') {
      // fired at the end of the subscription period, "Subscription Canceled" already sent at time of cancel
      await libstripe.onSubscriptionCanceled(data)
    } else if (event.type === 'customer.source.expiring') {
      // fired when payment card will expire at end of month
      await libstripe.onCardExpiring(data)
    } else if (event.type === 'invoice.payment_action_required') {
      // log to get a sense of how often this is happening
      log.warn({id: data.id}, 'invoice requires further action')
    } else if (event.type === 'invoice.marked_uncollectible') {
      // checking how many days we've had this problem
      await libstripe.onInvoiceUncollectible(data)
    }
    res.sendStatus(200)
  })
}
