
const date = require('date-fns')
const {Op} = require('sequelize')

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  maxNetworkRetries: 3,
})

// TODO: bust customer cache on new service or boost when customer has credit

module.exports = ({app, log, sequelize}) => { // eslint-disable-line no-unused-vars
  const model = require('@bap/cotton/model')(sequelize)
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const libstripe = require('@bap/cotton/lib/stripe')({log, sequelize})
  const libcupid = require('@bap/cotton/lib/cupid')({log})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  app.get('/subscriptions', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', model.User, userId)
    }
    const where = {
      userId,
      enabled: true,
    }
    if (req.query.view === 'Disabled') {
      where.enabled = false
    } else if (req.query.view === 'All') {
      delete where.enabled
    }
    const subs = await model.Subscription.findAll({
      where,
      order: ['status', 'created'],
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author], required: false},
        {model: model.Product},
      ],
    })
    const l = []
    for (const sub of subs) {
      l.push(await xforms.subscription(sub))
    }
    res.status(200).send(l)
  })

  app.post('/subscriptions', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('create', model.User, userId)
    }
    const bookId = parseInt(req.body.bookId) || null
    if (bookId) {
      await req.user.can('read', model.Book, bookId)
    }
    const product = await model.Product.findByPk(req.body.productId)
    const user = await model.User.findByPk(userId)
    const settings = await model.settingsForUser(user.id)
    const managed = req.user.id !== userId
    if (!managed && settings.enterprise) {
      // example use case: AF customer requesting service
      // NOTE: no book only allowed for partners & AM's
      const partner = await model.parentUser(userId)
      const request = await model.Request.create({
        userId: partner.id,
        childId: user.id,
        productId: product.id,
        data: {book: bookId},
      })
      await libmail.add('Service Requested', partner, {
        request,
        customer: user,
        name: product.name,
        book: await model.Book.findByPk(bookId, {include: [model.Author]}),
      })
      await libmail.add('Request Receipt', user, {
        request,
        plan: product.name,
      })
      res.status(200).send({id: 0, request})
      return
    }
    const bookSubscription = await model.Subscription.findOne({
      where: {bookId},
    })
    if (bookId && bookSubscription) {
      // handle the edge case where a user attempts to create a subscription for a service that is cancelled but still enabled
      if (bookSubscription.enabled && bookSubscription.status === 'canceled') {
        res.redirect(307, `/subscriptions/${bookSubscription.id}/reactivate`)
        return
      }
      res.redirect(307, `/subscriptions/${bookSubscription.id}/restart`)
      return
    }
    let stripeId = null
    let status = 'active'
    const endsOrRenews = date.add(new Date(), {months: product.months})
    if (!settings.enterprise) {
      try {
        const stripeSub = await libstripe.newSubscription({
          user,
          cardId: req.body.cardId,
          paymentIntentId: req.body.paymentIntentId,
          priceId: product.stripeId,
          productId: product.id,
        })
        stripeId = stripeSub.id
        status = stripeSub.status
      } catch (err) {
        res.status(400).send(libstripe.userErrMsg(err, user.stripeId, 'unable to add service'))
        return
      }
    }
    const subscription = await model.Subscription.create({
      userId,
      bookId,
      stripeId,
      status,
      productId: product.id,
      cardId: req.body.cardId, // will be null for enterprise accounts
      renews: product.recurs ? endsOrRenews : null,
      end: product.recurs ? null : endsOrRenews,
    })
    await subscription.reload({
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author], required: false},
        {model: model.Product},
      ],
    })
    log.info({id: String(subscription.id)}, 'new subscription:', subscription.stripeId)
    if (!stripeId) { // avoid race condition with stripe webhook
      try {
        const {stdout, stderr} = await libcupid.run(subscription.id)
        process.stdout.write(stdout)
        if (stderr) {
          process.stderr.write(stderr)
        }
      } catch (err) {
        err.id = subscription.id
        log.error(err, 'failed to run cupid for new subscription:', subscription.id)
      }
    }
    res.status(201).send(await xforms.subscription(subscription))
  })

  // use cases:
  // - use another payment card
  // - switch plans
  // - assign book
  app.put('/subscriptions/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', model.Subscription, id)

    const updateParams = {
      cardId: req.body.cardId,
      productId: req.body.productId,
      paymentIntentId: req.body.paymentIntentId,
      bookId: req.body.bookId
    }
    const updateRes = await libstripe.updateSubscription(id, updateParams)

    res.status(updateRes.status).send(updateRes.status === 200 ? xforms.subscription(updateRes.msg) : updateRes.msg)
  })

  app.get('/subscriptions/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('read', model.Subscription, id)
    const subscription = await model.Subscription.findByPk(id, {
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author], required: false},
        {model: model.Product},
      ],
    })
    if (!subscription) {
      throw new model.NotFoundError('subscription', req.params.id)
    }
    res.status(200).send(await xforms.subscription(subscription))
  })

  app.delete('/subscriptions/:old/migrate/:new', async (req, res) => {
    const oldId = parseInt(req.params.old)
    const newId = parseInt(req.params.new)

    if (!req.user.isSA()) {
      throw new model.AccessError(req.user.id, 'migration', 'subscription', oldId)
    }
    await req.user.can('delete', model.Subscription, oldId)

    const subscription = await model.Subscription.findByPk(oldId, {
      where: {
        enabled: false,
        status: 'canceled',
      }
    })
    if (!subscription) {
      log.warn({id: req.params.id}, 'unable to uncancel subscription')
      res.status(400).send({error: 'this subscription does not support this operation'})
      return
    }

    await model.Match.update({subscriptionId: newId}, {where: {subscriptionId: oldId}})
    await model.Boost.update({subscriptionId: newId}, {where: {subscriptionId: oldId}})
    await subscription.destroy()

    res.status(200).send({})
  })

  app.post('/subscriptions/:id/cancel', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('delete', model.Subscription, id)
    const subscription = await model.Subscription.findByPk(id, {
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author], required: false},
        {model: model.Product},
      ],
    })
    if (subscription.stripeId) {
      if (subscription.status !== 'unpaid') {
        await stripe.subscriptions.update(subscription.stripeId, {cancel_at_period_end: true}) // eslint-disable-line camelcase
      } else {
        // "delete" so that stripe stops trying to collect on unpaid invoices
        await stripe.subscriptions.del(subscription.stripeId)
        // const r = await stripe.invoices.list({subscription: subscription.stripeId, status: 'open'})
        // for (const inv of r.data) {
        //   log.warn({id: subscription.stripeId}, 'marking invoice for unpaid canceled subscription as uncollectible:', inv.id)
        //   await stripe.invoices.markUncollectible(inv.id)
        // }
      }
    }
    const wasActive = subscription.status === 'active'
    subscription.status = 'canceled'
    if (!subscription.end) {
      // handle when in a state of unpaid as well as non-recurring plans
      if (subscription.renews) {
        subscription.end = subscription.renews
      } else {
        subscription.end = new Date()
      }
    }
    subscription.renews = null
    await subscription.save()
    if (wasActive) {
      // only send notification if was active - sending this when was unpaid is
      // awkward to user and would require extra code in the notification
      await libmail.add('Subscription Canceled', subscription.user, {
        subscription,
        plan: subscription.product.name,
        book: subscription.book,
      })
    }
    res.status(200).send(await xforms.subscription(subscription))
  })

  // use case: allow user to request an extra target
  app.post('/subscriptions/:id/target', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', model.Subscription, id)
    const subscription = await model.Subscription.findByPk(id, {
      include: [model.Product],
    })
    if (!subscription.product.features.includes('target')) {
      log.warn({id}, 'trying to get fresh target from subscription without that feature')
      res.status(400).send({error: 'plan not allowed to target'})
      return
    }
    log.info({id}, 'forcing new target for subscription')
    try {
      const {stdout, stderr} = await libcupid.run(id, {targeting: 'force-target'})
      process.stdout.write(stdout)
      if (stderr) {
        throw new Error(stderr)
      }
    } catch (err) {
      log.error(err, 'failed to run cupid for new target')
      res.status(400).send({error: 'failed to start new target - support team notified'})
      return
    }
    res.status(200).send({id})
  })

  // use case: allow user to pay unpaid subscription with any card
  app.post('/subscriptions/:id/retry', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', model.Subscription, id)
    const subscription = await model.Subscription.findByPk(id, {
      where: {
        enabled: false,
        status: 'unpaid',
        stripeId: {[Op.not]: null},
      },
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author]},
        {model: model.Product},
      ],
    })
    if (!subscription) {
      log.warn({id: req.params.id}, 'unable to retry payment:', 'unable to find unpaid subscription')
      res.status(400).send({error: 'this subscription does not support this operation'})
      return
    }
    try {
      await libstripe.paySubscription(id, req.body.cardId)
    } catch (err) {
      res.status(400).send(libstripe.userErrMsg(err, subscription.stripeId, 'failed to retry payment'))
      return
    }
    res.status(200).send(await xforms.subscription(subscription))
  })

  // use case: allow user to uncancel before it ends
  app.post('/subscriptions/:id/reactivate', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', model.Subscription, id)
    const subscription = await model.Subscription.findByPk(id, {
      where: {
        enabled: true,
        status: 'canceled',
        stripeId: {[Op.not]: null},
      },
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author]},
        {model: model.Product},
      ],
    })
    if (!subscription) {
      log.warn({id: req.params.id}, 'unable to uncancel subscription')
      res.status(400).send({error: 'this subscription does not support this operation'})
      return
    }
    if (subscription.stripeId) {
      try { /* eslint-disable camelcase */
        await stripe.subscriptions.update(subscription.stripeId, {cancel_at_period_end: false})
      } catch (err) {
        res.status(400).send(libstripe.userErrMsg(err, subscription.stripeId, 'failed to reactivate service'))
        return
      }
    }
    subscription.status = 'active'
    subscription.renews = subscription.end
    subscription.end = null
    await subscription.save()
    res.status(200).send(await xforms.subscription(subscription))
  })

  // use case: allow user to start new service with optionally different plan & card
  app.post('/subscriptions/:id/restart', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', model.Subscription, id)
    const subscription = await model.Subscription.findByPk(id, {
      where: {
        enabled: false,
        status: 'canceled',
        stripeId: {[Op.not]: null},
      },
      include: [{model: model.User}],
    })
    if (!subscription) {
      log.warn({id: req.params.id}, 'unable to restart subscription')
      res.status(400).send({error: 'this subscription does not support this operation'})
      return
    }

    const product = await model.Product.findByPk(req.body.productId)
    const user = subscription.user
    const endsOrRenews = date.add(new Date(), {months: product.months})
    let stripeSub = null
    if (subscription.stripeId) {
      try { /* eslint-disable camelcase */
        stripeSub = await libstripe.newSubscription({
          user,
          cardId: req.body.cardId,
          paymentIntentId: req.body.paymentIntentId,
          priceId: product.stripeId,
          productId: product.id,
        })
      } catch (err) {
        res.status(400).send(libstripe.userErrMsg(err, user.stripeId, 'unable to reactivate service'))
        return
      }
    }
    const newSubscription = await model.Subscription.create({
      userId: subscription.userId,
      bookId: subscription.bookId,
      stripeId: stripeSub?.id,
      status: 'active',
      productId: product.id,
      cardId: req.body.cardId,
      renews: product.recurs ? endsOrRenews : null,
      end: product.recurs ? null : endsOrRenews,
    })
    await model.Match.update({subscriptionId: newSubscription.id}, {where: {subscriptionId: subscription.id}})
    await model.Boost.update({subscriptionId: newSubscription.id}, {where: {subscriptionId: subscription.id}})
    await subscription.destroy()
    await newSubscription.reload({
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author]},
        {model: model.Product},
      ],
    })
    log.info({id: String(newSubscription.id), old: subscription.id}, 'subscription reactivated:', newSubscription.stripeId)
    res.status(200).send(await xforms.subscription(newSubscription))
  })

  app.post('/boosts', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('create', model.User, userId)
    }
    const product = await model.Product.findByPk(req.body.productId)
    const subscription = await model.Subscription.findByPk(req.body.subscriptionId, {
      include: [
        {model: model.User},
        {model: model.Book, include: [model.Author], required: false},
        {model: model.Product},
      ],
    })
    const user = subscription.user
    const settings = await model.settingsForUser(user.id)
    let award = null
    if (req.body.awardId) {
      // protect against boosting an award that has (or will be) submitted by us (see peggy#282)
      const already = await model.Match.findOne({where: {
        awardId: req.body.awardId,
        bookId: subscription.bookId,
        submitBy: {[Op.not]: null},
      }})
      if (already) {
        log.warn({id: String(subscription.id)}, 'attempted to boost already submitted award:', req.body.awardId)
        res.status(400).send({error: 'award already submitted'})
        return
      }
      award = await model.Award.findByPk(req.body.awardId)
    }
    if (settings.enterprise) {
      // Enterprise users (whether partner or customer) use Request workflow
      const partner = await model.parentUser(user.id) // TODO: confirm don't need to go higher than parent
      const request = await model.Request.create({
        userId: partner.id,
        childId: user.id,
        productId: product.id,
        data: {subscription: subscription.id, awards: award ? [award.id] : []},
      })
      await libmail.add('Boost Requested', partner, {
        request,
        award,
        subscription,
        customer: user,
        plan: product.name,
        book: subscription.book,
      })
      await libmail.add('Request Receipt', user, {
        request,
        plan: product.name,
      })
      res.status(200).send({id: `request:{request.id}`, requested: true})
      return
    }
    try {
      await libstripe.newPayment({
        user,
        dollars: product.price + (award?.overage() || 0),
        cardId: req.body.cardId,
        paymentIntentId: req.body.paymentIntentId,
        description: product.name,
        metadata: {
          subscription: subscription.id,
          product: product.id,
        },
      })
    } catch (err) {
      res.status(400).send(libstripe.userErrMsg(err, subscription.stripeId, 'failed to purchase boost'))
      return
    }
    const boost = await model.Boost.create({
      subscriptionId: subscription.id,
      productId: product.id,
      awards: award ? [award.id] : [],
    })
    log.info({id: String(subscription.id)}, 'subscription boosted:', boost.id)
    try {
      const {stdout, stderr} = await libcupid.run(subscription.id, {matching: 'none'})
      process.stdout.write(stdout)
      if (stderr) {
        process.stderr.write(stderr)
      }
    } catch (err) {
      err.id = subscription.id
      log.error(err, 'failed to run cupid for new boost:', subscription.id)
    }
    res.status(200).send({id: boost.id, boosted: true})
  })

}
