/* eslint-disable camelcase */

const _ = require('lodash')
const date = require('date-fns')

// NOTE: memoized functions that we'll want to manage cache for will need to be
// declared only once (eg outside the dynamic module pattern).

// TODO: clearing cache only affects this server

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  maxNetworkRetries: 3,
})

const TEST = {/* eslint-disable camelcase */
  users: {
    webhook: {
      id: 0,
      email: 'erik@bookawardpro.com',
      fullname: 'Jabroney Jones',
    },
  },
  subscriptions: {
    webhook: {
      id: 0,
      book: {
        title: 'Cute Funny Fresh',
        cover: 'https://media.illustrationx.com/images/artist/RohanEason/106234/watermark/1300/the-hollow-woods.jpg',
      },
      product: {
        name: 'Cool Test Plan',
      },
    },
  },
  products: {
    webhook: {
      id: 0,
      price: 33,
      name: 'Submit Boost',
    },
  },
  cards: {
    good: {
      brand: 'visa',
      last4: '4242',
      expires: {
        year: 2022,
        month: 8,
      },
      billing: {
        name: 'Jabroney Jones',
      },
    }
  },
}

if (process.env.OFFLINE) {
  stripe.paymentMethods.retrieve = () => {
    return {
      id: 'pm_test',
      card: {
        brand: 'discover',
        last4: 1337,
        exp_year: 2020,
        exp_month: 4,
      },
      billing_details: {
        name: 'Jabroney Jones',
      },
    }
  }

  stripe.paymentMethods.list = () => {
    return {data: [stripe.paymentMethods.retrieve()]}
  }

  stripe.customers.retrieve = () => {
    return {
      invoice_settings: {
        default_payment_method: stripe.paymentMethods.retrieve(),
      },
    }
  }
}

const defaultCard = async stripeId => {
  if (!stripeId) {
    return null
  }
  if (stripeId.startsWith('test-')) {
    return TEST.cards[stripeId.split('-')[1]]
  }
  const customer = await stripe.customers.retrieve(stripeId, {
    expand: ['invoice_settings.default_payment_method'],
  })
  // const defcard = customer.invoice_settings?.default_payment_method
  return customer.invoice_settings?.default_payment_method
}

const customer = async stripeId => {
  // if (stripeId.startsWith('test-')) {
  //   return TEST.customers[stripeId.split('-')[1]]
  // }
  return await stripe.customers.retrieve(stripeId, {
    expand: ['invoice_settings'],
  })
}

// safe to memoize these since immutable
const getCard = _.memoize(async id => {
  if (!id) {
    return null
  }
  return await stripe.paymentMethods.retrieve(id)
})

// const stripeSub = _.memoize(async id => {
//   if (!id) {
//     return null
//   }
//   if (id.startsWith('test-')) {
//     return TEST.subscriptions[id.split('-')[1]]
//   }
//   return await stripe.subscriptions.retrieve(id, {
//     expand: ['default_payment_method'],
//   })
// })

class ScaError extends Error {
  constructor(intent) {
    // Pass remaining arguments (including vendor specific ones) to parent constructor
    super('SCA Required')

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    // if (Error.captureStackTrace) {
    //   Error.captureStackTrace(this, CustomError)
    // }

    this.name = 'ScaError'
    this.id = intent.id
    this.secret = intent.client_secret
    this.customer = intent.customer
  }
}

module.exports = ({log, sequelize}) => {
  const {User, Subscription, Product, Book, Author} = require('@bap/cotton/model')(sequelize)
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const libtask = require('@bap/cotton/lib/task')({log, sequelize})
  // const xforms = require('@bap/cotton/xforms')({log, sequelize})

  async function creditBalance(stripeId) {
    const cus = await stripe.customers.retrieve(stripeId)
    return Math.round(cus.balance / -100)
  }

  // if given card is the default, then return `undefined`, otherwise given card id
  const asDefaultCard = (stripeId, cardId) => {
    // stripe api reads `null` as a string, so using `undefined`
    const stripeDefault = undefined // eslint-disable-line no-undefined
    if (!cardId) {
      return stripeDefault
    }
    return cardId === defaultCard(stripeId)?.id ? stripeDefault : cardId
  }

  async function onChargeSucceeded(charge) {
    if (!charge.metadata.subscription) {
      // handling adhoc payments only and assuming tied to a subscription
      return
    }
    const subscription = await Subscription.findByPk(charge.metadata.subscription, {
      include: [User, Book, Product],
    })
    if (!subscription) {
      log.error({id: charge.metadata.subscription}, 'unable to find boost subscription:', charge.id)
      return
    }
    await libmail.add('Transaction Approved', subscription.user, {
      subscription,
      charge: {
        id: charge.id,
        ts: new Date(1000 * charge.created),
        dollars: charge.amount / 100,
        description: charge.description
      },
      card: charge.payment_method_details.card,
    })
    log.info({id: String(subscription.id)}, 'payment:', charge.description)
  }

  async function onInvoicePaid(inv) {
    if (!inv.subscription) {
      return // is null during test - don't want to run against a random enterprise subscription
    }
    const subscription = await Subscription.findOne({
      where: {stripeId: inv.subscription},
      include: [User, Book, Product],
    })
    if (!subscription) {
      log.error({id: inv.subscription}, 'unable to find paid subscription:', inv.id)
      return
    }
    // charge can be null if amount to pay was 0 (eg credit balance, legacy paypal)
    let charge = {
      id: null,
      created: inv.created,
      amount: 0,
    }
    if (inv.charge) {
      charge = await stripe.charges.retrieve(inv.charge)
    }
    await libmail.add('Transaction Approved', subscription.user, {
      subscription,
      charge: {
        id: charge.id,
        ts: new Date(1000 * charge.created),
        dollars: charge.amount / 100,
        description: subscription.product.name, // TODO: use custom product name
      },
      card: charge.payment_method_details?.card,
    })
    subscription.enabled = true
    subscription.status = 'active'
    subscription.renews = new Date(1000 * _.get(inv, 'lines.data[0].period.end'))
    subscription.renewed = new Date()
    subscription.end = null
    await subscription.save()
    log.info({id: String(subscription.id)}, 'subscription renewed:', subscription.stripeId)
    await libtask.add('Target Renewal', {id: subscription.id})
  }

  async function onInvoiceUnpaid(inv) {
    if (!inv.subscription) {
      return // is null during test - don't want to run against a random enterprise subscription
    }
    const subscription = await Subscription.findOne({
      where: {stripeId: inv.subscription},
      include: [User, Book, Product],
    })
    if (!subscription) {
      log.error({id: inv.subscription}, 'unable to find unpaid subscription:', inv.id)
      return
    }
    // when a user cancels, this webhook will fire on expiration but there will be no charge
    if (inv.charge) {
      // only send this notification if failed to renew the subscription
      const intent = await stripe.paymentIntents.retrieve(inv.payment_intent, {
        expand: ['charges'],
      })
      const charge = intent.charges.data[0]
      log.warn({id: String(subscription.id), outcome: charge.outcome}, 'disabled due to payment failure:', inv.id)
      await libmail.add('Transaction Declined', subscription.user, {
        subscription,
        plan: subscription.product.name,
        charge: {
          id: charge.id,
          ts: new Date(1000 * charge.created),
          dollars: charge.amount / 100,
          description: subscription.product.name, // TODO: use custom product name
        },
        card: charge.payment_method_details.card,
        sca: intent.status === 'requires_action' ? inv.hosted_invoice_url : null,
      })
    }
    subscription.enabled = false
    subscription.status = 'unpaid'
    subscription.renews = null
    if (!subscription.end) {
      // only set one time in case webhook replayed
      subscription.end = new Date()
    }
    await subscription.save()
  }

  async function onSubscriptionCanceled(sub) {
    const subscription = await Subscription.findOne({
      where: {stripeId: sub.id},
      include: [{model: User}],
    })
    if (!subscription) {
      // can happen when switching plans
      log.warn({id: sub.id}, 'unable to find canceled subscription:', sub.id)
      return
    }
    subscription.enabled = false
    subscription.status = 'canceled'
    subscription.renews = null
    if (!subscription.end) {
      // only set one time in case webhook replayed
      subscription.end = new Date()
    }
    await subscription.save()
    log.info({id: String(subscription.id)}, 'disabled due to cancellation:', sub.id)
    try {
      await libmail.updateTags(libmail.SERVICE_STATUS.CANCELING, {
        email: subscription.user.email,
        userId: subscription.userId,
        oldProductId: subscription.productId,
      })
    } catch (err) {
      err.message = `failed to cancel Mailchimp member tags of ${subscription.user.email}`
      throw err
    }
  }

  async function onCardExpiring(card) {
    const user = await User.findOne({
      where: {stripeId: card.customer},
    })
    if (!user) {
      log.error({id: card.customer}, 'unable to find user for expiring card:', card.id)
      return
    }
    await libmail.add('Card Expiring', user, {
      card,
    })
  }

  // to get a subscription into a state where payment can be retried:
  // - in stripe subscription page, update the subscription with:
  //   - disable "Prorate changes"
  //   - select "Email invoice ..."
  //   - select "Reset the billing cycle"
  // - in our stripe-enabled shell: inv = await stripe.invoices.finalizeInvoice('in_abc123')
  // - sql: update subscriptions set status='unpaid', "end"=renews, renews=null, enabled=false where id = 123;
  //
  async function paySubscription(id, cardId) {
    const subscription = await Subscription.findByPk(id)
    log.warn({id}, 'attempting to get unpaid subscription back in good standing:', subscription.stripeId)
    const inv = _.get(await stripe.invoices.list({
      subscription: subscription.stripeId,
      status: 'open',
    }), 'data[0]')
    if (!inv) {
      log.error({id}, 'unable to find invoice for unpaid subscription:', subscription.stripeId)
      throw new Error('no open invoice')
    }
    try {
      await stripe.invoices.pay(inv.id, {payment_method: cardId || subscription.cardId})
    } catch (err) {
      if (err.code === 'invoice_payment_intent_requires_action') {
        // to support SCA, we'd have to retrieve inv.payment_intent, send client secret, etc
        // since user can add card first and pass SCA checks, going to punt them down that path
        err.message = 'SCA not supported. Please add card first or contact customer support.'
      }
      throw err
    }
    subscription.status = 'active'
    subscription.enabled = true
    subscription.renews = new Date(1000 * _.get(inv, 'lines.data[0].period.end'))
    if (!subscription.renews.valueOf()) {
      // this should never happen, but just in case, default to 1 month away
      log.warn({id}, 'unable to get renewal date for invoice:', inv.id)
      subscription.renews = date.addMonths(new Date(), 1)
    }
    subscription.end = null
    await subscription.save()
  }

  async function updateSubscriptionCard(id, cardId) {
    const subscription = await Subscription.findByPk(id)
    if (subscription.status === 'unpaid') {
      await paySubscription(id, cardId)
    }
    await stripe.subscriptions.update(subscription.stripeId, {
      default_payment_method: cardId,
    })
    subscription.cardId = cardId
    await subscription.save()
  }

  async function newSubscription({user, cardId, priceId, coupon, paymentIntentId, startDate, productId}) { /* eslint-disable camelcase */
    if (paymentIntentId) {
      // returning after SCA
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['invoice.subscription'],
      })
      // clear in case a credit balance was applied
      // customer.cache.delete(user.stripeId)
      return intent.invoice.subscription
    }
    if (!user.stripeId) {
      const customer = await stripe.customers.create({ // eslint-disable-line no-shadow
        email: user.email,
        name: user.name,
        payment_method: cardId,
        invoice_settings: {
          default_payment_method: cardId,
        },
        tax_exempt: 'reverse',
      })
      user.stripeId = customer.id // eslint-disable-line require-atomic-updates
    }
    const payload = {
      coupon,
      customer: user.stripeId,
      items: [{price: priceId}],
      default_payment_method: asDefaultCard(user.stripeId, cardId),
      payment_behavior: 'allow_incomplete',
      expand: ['latest_invoice.payment_intent'],
    }
    if (startDate) {
      payload.billing_cycle_anchor = startDate
      payload.proration_behavior = 'none'
    }
    const subscription = await stripe.subscriptions.create(payload)
    if (user.id) {
      try {
        await libmail.updateTags(libmail.SERVICE_STATUS.ADDING, {
          email: user.email,
          userId: user.id,
          newProductId: productId,
        })
      } catch (err) {
        err.message = `failed to add Mailchimp member tags of ${user.email}`
        throw err
      }
    }
    // latest_invoice can be null when downgrading
    // intent can be null if no amount due (eg credit used)
    const intent = subscription.latest_invoice?.payment_intent
    if (intent?.status === 'requires_action') {
      throw new ScaError(intent)
    }
    // clear in case a credit balance was applied
    // customer.cache.delete(user.stripeId)
    return subscription
  }

  async function newPayment({user, cardId, dollars, paymentIntentId, description, metadata}) { /* eslint-disable camelcase */
    const credit = await creditBalance(user.stripeId)
    if (paymentIntentId) {
      // returning after SCA
      const intent = await stripe.paymentIntents.retrieve(paymentIntentId, {})
      if (intent.status !== 'succeeded') {
        log.error({id: intent.id}, 'payment intent did not succeed:', intent.status)
        throw new Error(`payment method not confirmed: ${intent.status}`)
      }
    } else if (dollars > credit) {
      const intent = await stripe.paymentIntents.create({
        description,
        metadata,
        customer: user.stripeId,
        amount: 100 * (dollars - credit),
        currency: 'USD',
        confirm: true,
        statement_descriptor_suffix: description,
        payment_method: cardId,
      })
      if (intent.status === 'requires_action') {
        throw new ScaError(intent)
      }
    }
    if (credit > 0) {
      let balance = Math.min(0, -100 * (credit - dollars))
      await stripe.customers.update(user.stripeId, {balance})
      balance *= -0.01
      // customer.cache.delete(user.stripeId)
      log.warn({balance, id: user.stripeId}, `credit of $${credit} applied to payment of $${dollars} - user=${user.id} has $${balance} remaining`)
    }
  }

  function userErrMsg(err, id, msg) {
    if (err instanceof ScaError) {
      log.warn({id: err.id}, 'SCA required for:', err.customer)
      return {error: 'SCA', secret: err.secret, customerId: err.customer}
    }
    if (err.type === 'StripeCardError') {
      // stripe does a good job of conveying to the user what the issue is in its message
      log.warn({id}, 'stripe card error for:', id, msg, err.code, err.decline_code)
      return {error: err.message}
    }
    log.error(err, 'unhandled stripe error for:', id, msg)
    return {error: `${msg} - support team notified`}
  }

  const updateSubscription = async (id, req) => {

    const subscription = await Subscription.findByPk(id, {
      include: [
        {model: User},
        {model: Book, include: [Author], required: false},
        {model: Product},
      ],
    })
    const user = subscription.user
    if (req.cardId && req.cardId !== subscription.cardId) {
      if (!subscription.stripeId) {
        log.error({id: String(subscription.id)}, 'trying to update card for non-stripe subscription')
      } else {
        try {
          await updateSubscriptionCard(subscription.id, req.cardId)
        } catch (err) {
          return {status: 400, msg: userErrMsg(err, subscription.stripeId, 'unable to update card')}
        }
      }
    }
    if (req.productId && req.productId !== subscription.productId) {
      // switching plans
      const product = await Product.findByPk(req.productId)
      const oldStripeId = subscription.stripeId
      try {
        const stripeSub = await newSubscription({
          user,
          cardId: req.cardId,
          paymentIntentId: req.paymentIntentId,
          priceId: product.stripeId,
          // when downgrading, start at end of current cycle, but unpaid subscriptions need to start immediately (see peggy#185)
          startDate: subscription.product.price > product.price && subscription.status !== 'unpaid' && subscription.renews,
        })
        // TODO: better to tombstone the old one and migrate?
        const endsOrRenews = new Date(1000 * stripeSub.current_period_end)
        subscription.product = product // needed to return current product info
        subscription.productId = product.id
        subscription.stripeId = stripeSub.id
        subscription.status = stripeSub.status
        subscription.renews = product.recurs ? endsOrRenews : null
        subscription.end = product.recurs ? null : endsOrRenews
        subscription.enabled = true
        await subscription.save()
      } catch (err) {
        return {status: 400, msg: userErrMsg(err, subscription.stripeId, 'failed to switch plan')}
      }
      // only cancel after successfully switching to new one
      if (oldStripeId === subscription.stripeId) {
        log.error({id: String(subscription.id)}, 'plan change gone wonky:', subscription.id)
      } else {
        // simply delete, handle any customer asks for credit manually
        await stripe.subscriptions.del(oldStripeId)
      }
    }
    if (req.bookId) {
      subscription.bookId = req.bookId
    }
    await subscription.save()
    if (!subscription.book && subscription.bookId) {
      // need to provide consistent shape so client doesn't show stale data
      subscription.book = await Book.findByPk(subscription.bookId, {include: [Author]})
    }
    return {status: 200, msg: subscription}
  }

  async function onInvoiceUncollectible(inv) {
    if (!inv.subscription) {
      return // is null during test - don't want to run against a random enterprise subscription
    }
    const subscription = await Subscription.findOne({
      where: {stripeId: inv.subscription},
    })
    if (!subscription) {
      // can happen when switching plans
      log.warn({id: inv.subscription}, 'unable to find canceled subscription:', inv.subscription)
      return
    }
    const lastThree = (await stripe.invoices.list({
      subscription: inv.subscription,
      limit: 3,
    })).data.filter(e => e.status === 'uncollectible')

    if (lastThree.length === 3) {
      const updateParams = {
        cardId: subscription.cardId,
        productId: 8,
        paymentIntentId: null,
        bookId: false
      }
      const updateRes = await updateSubscription(subscription.id, updateParams)
      if (updateRes.status === 200) {
        log.info({id: String(subscription.id)}, 'subscription uncollectible. downgraded to free plan:', updateRes.msg.stripeId)
      }
    }
  }

  return {
    asDefaultCard,
    customer,
    defaultCard,
    getCard,
    newPayment,
    newSubscription,
    onChargeSucceeded,
    onInvoicePaid,
    onInvoiceUnpaid,
    onSubscriptionCanceled,
    onCardExpiring,
    paySubscription,
    userErrMsg,
    updateSubscriptionCard,
    onInvoiceUncollectible,
    updateSubscription,
  }
}
