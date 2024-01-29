
const _ = require('lodash')
const crypto = require('crypto')
const session = require('express-session')
const SessionStore = require('connect-session-sequelize')(session.Store)
const passport = require('passport')
const PassportStrategy = require('passport-local').Strategy
const {Op} = require('sequelize')
const unless = require('express-unless')
const {DEFAULT_PRODUCTS} = require('@bap/cotton/lib')

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  maxNetworkRetries: 3,
})

const PUBLIC = [
  '/signup',
  '/session',
  '/account/reset-password',
  '/login',
  '/logout',
  '/notifications',
  '/stripe/webhook',
  new RegExp('/coupons/.+'), // eslint-disable-line
  new RegExp('/affiliates/referral/.+'), // eslint-disable-line
  new RegExp('/share/book/.+'), // eslint-disable-line
]

module.exports = ({app, log, sequelize}) => { // eslint-disable-line no-unused-vars

  const model = require('@bap/cotton/model')(sequelize)
  const {User, UserTree, Partner, Author, Book, Notification, Subscription, Product, Affiliate, Referral} = model
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const libstripe = require('@bap/cotton/lib/stripe')({log, sequelize})
  const {payout} = require('@bap/cotton/lib/affiliate')({log, sequelize})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  // NOTE: the order of app.use is important, should be: session, passport, auth

  // - https://expressjs.com/en/resources/middleware/session.html
  app.use(session({
    store: new SessionStore({
      db: sequelize,
      table: 'session',
    }),
    saveUninitialized: false,
    secret: process.env.SESSION_KEY,
    cookie: {maxAge: 90 * 86400 * 1000}, // 90 days
    resave: false, // we support the touch method so per the express-session docs this should be set to false
    // proxy: true, // if you do SSL outside of node.
  }))

  passport.serializeUser((user, cb) => {
    cb(null, user.id)
  })

  passport.deserializeUser(async (id, cb) => {
    try {
      const user = await User.findByPk(id)
      return cb(null, user)
    } catch (err) {
      return cb(err)
    }
  })

  const pass = {
    salt: async () => await crypto.randomBytes(32).toString('hex'),
    hash: (secret, salt) => new Promise((resolve, reject) => {
      crypto.scrypt(secret, salt, 64, (err, key) => {
        if (err) {
          reject(err)
        } else {
          resolve(key.toString('hex'))
        }
      })
    })
  }

  passport.use(new PassportStrategy(async (email, password, cb) => {
    try {
      const user = await User.findOne({
        where: {
          email: {[Op.iLike]: email},
          tombstoned: {[Op.is]: null},
        },
        attributes: {
          include: ['password'],
        }
      })
      if (!user) {
        return cb(null, false)
      }
      const [salt, hash] = user.password.split(':')
      if (hash === await pass.hash(password, salt)) {
        return cb(null, user)
      }
      return cb(null, false)
    } catch (err) {
      return cb(err)
    }
  }))

  app.use(passport.initialize())
  app.use(passport.session())

  function auth(req, res, next) {
    if (!req.user) {
      return res.status(403).send()
    }
    return next()
  }
  app.use(unless(auth, {path: PUBLIC}))

  app.post('/login', passport.authenticate('local'), (req, res) => {
    res.status(200).send(_.pick(req.user, ['id', 'fullname', 'nickname', 'email', 'avatar', 'settings']))
  })

  app.get('/logout', (req, res) => {
    req.logout()
    res.clearCookie('connect.sid', {httpOnly: true})
    if (process.env.NODE_ENV !== 'development') {
      res.redirect('/login?msg=out')
    } else {
      res.redirect('http://localhost:3000/login?msg=out')
    }
  })

  async function sessionUser(user) {
    const settings = await model.settingsForUser(user.id)
    const xxx = _.pick(user, ['id', 'fullname', 'nickname', 'email', 'verbosity', 'avatar', 'lastActive', 'newMatchNotification'])
    xxx.settings = xforms.settings(settings)
    xxx.isAM = user.isAM()
    xxx.isSA = user.isSA()
    xxx.isPartner = xxx.isAM || settings.userId === user.id
    return xxx
  }

  app.get('/session', async (req, res) => {
    let scopeId = req.user?.id
    if (req.query.scope) {
      scopeId = parseInt(req.query.scope)
    }
    const user = req.user ? await sessionUser(req.user) : {}
    if (!req.user) {
      // not logged in, so just provide white label settings
      user.settings = xforms.settings(await model.settingsForDomain(req.get('origin') || req.get('host')))
    } else if (scopeId) {
      const scopeUser = await User.findByPk(scopeId)
      if (scopeUser) {
        user.scope = await sessionUser(scopeUser)
      } else {
        log.warn({id: String(scopeId)}, 'unknown scope:', scopeId)
      }
    }
    user.settings.stripePubKey = process.env.STRIPE_PUB_KEY
    res.status(200).send(user)
    if (user.id) {
      await User.update({lastActive: new Date()}, {where: {id: req.user.id}})
    }
  })

  app.get('/account/errors', async (req, res) => {
    const ERR = {
      author: 1,
      book: 2,
      subscription: 3,
    }
    const userId = req.user.id
    const settings = await model.settingsForUser(userId)
    if (req.user.isAM() || settings.userId === userId) {
      // no checks for partners at this time
      res.status(200).send([])
      return
    }
    const errors = []
    if (await Author.count({where: {[Op.and]: [{userId}, {tombstoned: null}]}}) === 0) {
      errors.push({id: ERR.author, msg: 'no author'})
    }
    if (await Book.scope('complete').count({where: {userId}}) === 0) {
      errors.push({id: ERR.book, msg: 'no book'})
    }
    const badSub = await Subscription.scope('unconfigured').findOne({
      where: {userId},
    })
    if (badSub) {
      errors.push({id: ERR.subscription, msg: 'bookless subscription', subscription: badSub})
    }
    res.status(200).send(errors)
  })

  app.post('/account/reset-password', async (req, res) => {
    if (!req.body.token) {
      // start recovery
      const email = req.body.email || ''
      const user = await User.findOne({where: {
        email: {[Op.iLike]: email},
        tombstoned: {[Op.is]: null},
      }})
      if (!user) {
        log.warn('password reset attempt for unknown email:', email)
        res.status(400).send({error: 'unknown email address'})
        return
      }
      await libmail.add('Password Recovery', user, {
        token: await crypto.randomBytes(32).toString('hex'),
      })
      res.status(200).send({email})
      return
    }
    // perform reset if token is valid
    const msg = await Notification.findOne({
      where: {
        key: {[Op.startsWith]: 'Password Recovery'},
        url: {[Op.endsWith]: `token=${req.body.token}`},
      },
      include: [User],
    })
    if (!msg) {
      res.status(400).send({error: 'token expired'})
      return
    }
    const user = msg.user
    const salt = await pass.salt()
    user.password = `${salt}:${await pass.hash(req.body.password, salt)}`
    await user.save()
    await libmail.add('Password Reset', user, {})
    req.login(user, () => {
      res.status(200).send({email: user.email})
    })
  })

  app.post('/signup', require('cookie-parser')(), async (req, res) => {
    const dup = await User.findOne({
      where: {
        email: {[Op.iLike]: req.body.email},
      },
    })
    if (dup) {
      res.status(400).send({error: {email: 'address already on existing account or unavailable'}})
      return
    }
    const product = await Product.findByPk(req.body.productId)
    let coupon = req.cookies?.ssoffer?.trim()
    if (coupon) {
      try {
        const xxx = await stripe.coupons.retrieve(coupon)
        if (!xxx.valid) {
          log.warn('attempted use of invalid coupon:', coupon)
          coupon = null
        }
      } catch (err) {
        log.warn('attempted use of unknown coupon:', coupon)
        coupon = null
      }
    }

    let stripeSub = null
    try {
      stripeSub = await libstripe.newSubscription({
        coupon,
        user: {
          stripeId: req.body.customerId,
          name: req.body.fullname,
          email: req.body.email,
        },
        cardId: req.body.cardId,
        paymentIntentId: req.body.paymentIntentId,
        priceId: product.stripeId,
        productId: product.id,
      })
    } catch (err) {
      res.status(400).send(libstripe.userErrMsg(err, req.body.email, 'failed signup'))
      return
    }
    const salt = await pass.salt()
    const password = await pass.salt()
    const user = await User.create({
      fullname: req.body.fullname,
      nickname: req.body.nickname,
      email: req.body.email,
      password: `${salt}:${await pass.hash(password, salt)}`,
      stripeId: stripeSub.customer,
    })

    const subscription = await Subscription.create({
      userId: user.id,
      stripeId: stripeSub.id,
      productId: product.id,
      cardId: req.body.cardId,
      status: stripeSub.status,
      renews: new Date(1000 * stripeSub.current_period_end),
    })

    // NOTE: Unhandled exceptions after this point can be dealt with manually
    // after the fact.  More important to return success to the new customer
    // so that they have a good first impression.

    try {
      await Affiliate.create({
        userId: user.id,
        code: user.affiliateCode(),
      })
    } catch (err) {
      log.error(err, 'failed to setup affiliate for new signup:', user.id, user.email)
    }
    let affiliate = null
    const shareCode = req.cookies?.share_code
    if (shareCode) {
      try {
        affiliate = await Affiliate.findOne({
          where: {code: {[Op.iLike]: shareCode}},
          include: [User],
        })
        if (!affiliate) {
          log.warn({id: String(user.id)}, 'new signup used unknown affiliate code:', shareCode)
        } else {
          const referral = await Referral.create({
            affiliateId: affiliate.id,
            subscriptionId: subscription.id,
            paid: stripeSub.latest_invoice.amount_paid / 100,
            status: 'pending',
          })
          if (referral.paid > 0) {
            await libmail.add('New Referral', affiliate.user, {
              referral,
              payout: payout(affiliate, referral),
            })
          }
        }
      } catch (err) {
        log.error(err, 'failed to record referral for new signup:', user.id, user.email, shareCode)
      }
    }

    try {
      let partner = await model.settingsForDomain(req.get('origin'))
      await UserTree.create({
        depth: 0,
        ancestorId: user.id,
        descendantId: user.id,
      })
      if (!partner) {
        log.error({id: String(user.id)}, 'signup from unknown site:', req.get('origin'))
        partner = await Partner.findByPk(2)
      }
      let parent = {id: partner.userId}
      let depth = 1
      while (parent) {
        await UserTree.create({
          depth,
          ancestorId: parent.id,
          descendantId: user.id,
        })
        parent = await model.parentUser(parent.id)
        depth += 1
      }
    } catch (err) {
      log.error(err, 'failed to add new signup to user tree:', user.id, user.email)
    }

    try {
      await libmail.add('New Signup', user, {
        plan: product.name,
      })
    } catch (err) {
      log.error(err, 'failed to send new signup notification for user:', user.id, user.email)
    }
    try {
      await libmail.add('New User', await model.rootUser(), {
        coupon,
        affiliate: affiliate?.user,
        customer: user,
        plan: product.name,
      })
    } catch (err) {
      log.error(err, 'failed to send new account notification:', user.email, shareCode)
    }
    try {
      await libmail.subscribe({affiliate: shareCode, ...user.toJSON()})
    } catch (err) {
      if (!err.message.startsWith('Member Exists')) {
        log.error(err, 'failed to subscribe new signup:', user.id, user.email)
      }
    }
    try {
      await libmail.updateTags(libmail.SERVICE_STATUS.ADDING, {
        email: user.email,
        userId: user.id,
        newProductId: product.id,
      })
    } catch (err) {
      log.error(err, 'failed to update mailchimp tags:', user.id, user.email)
    }

    req.login(user, () => {
      res.status(200).send({subscribed: subscription.id})
    })
  })

  app.put('/account/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', User, id)
    if (req.body.email) {
      const dup = await User.findOne({
        where: {
          email: req.body.email,
          id: {[Op.not]: id},
        }
      })
      if (dup) {
        res.status(400).send({error: 'email address already on existing account or unavailable'})
        return
      }
    }
    const user = await User.findByPk(id)
    const oldEmail = user.email
    for (const field of ['email', 'fullname', 'nickname', 'verbosity', 'newMatchNotification']) {
      if (typeof req.body[field] !== 'undefined') {
        user[field] = req.body[field]
      }
    }
    if (req.body.password) {
      const salt = await pass.salt()
      user.password = `${salt}:${await pass.hash(req.body.password, salt)}`
    }
    await user.save()
    if (req.body.email && (oldEmail !== req.body.email)) {
      try {
        if (user.stripeId) {
          await stripe.customers.update(user.stripeId, {
            email: req.body.email
          })
        }
      } catch (err) {
        log.error(err, 'failed to change the stripe email for user: ', user.id, oldEmail)
      }
      try {
        await libmail.changeSubscriber(oldEmail, req.body.email)
      } catch (err) {
        log.error(err, 'failed to change subscriber:', user.id, oldEmail)
      }
    }
    res.status(200).send({id})
  })

  app.post('/account/:id/partnerize', async (req, res) => {
    const id = parseInt(req.params.id)
    if (!req.user.isSA()) {
      throw new model.AccessError(req.user.id, 'update', 'user', id)
    }
    const subscriptions = await Subscription.count({where: {
      userId: id,
      status: 'active',
    }})
    if (subscriptions) {
      res.status(400).send({error: 'still has active subscriptions'})
      return
    }
    const user = await User.findByPk(id)
    await UserTree.destroy({
      where: {
        descendantId: user.id,
        ancestorId: 1,
      }
    })
    await UserTree.update({ancestorId: 1}, {
      where: {
        descendantId: user.id,
        depth: 1,
      }
    })
    await Partner.create({
      userId: user.id,
      business: user.fullname,
      domain: `partner-${user.id}.awardmatch.com`,
      theme: {primary: '#42b3ff'},
      products: DEFAULT_PRODUCTS,
      emails: {support: 'team@bookawardpro.com'},
      urls: {pricing: ''},
      logo: '/assets/img/bap-logo.png',
    })
    res.status(200).send({id})
  })


  app.get('/billing/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('read', User, id)
    const user = await User.findByPk(id)
    res.status(200).send(await xforms.billing(user))
  })

  app.put('/billing/:id', async (req, res) => { /* eslint-disable camelcase */
    const id = parseInt(req.params.id)
    await req.user.can('update', User, id)
    const user = await User.findByPk(id)

    const customer = await libstripe.customer(user.stripeId, {
      expand: ['invoice_settings', 'tax_ids'],
    })
    const payload = {
      tax_exempt: 'reverse',
      invoice_settings: {},
    }
    if (req.user.isAM() && req.body.credit && req.body.credit >= 0) {
      payload.balance = -100 * req.body.credit
    }
    if (req.body.address) {
      payload.address = req.body.address
    }
    if (req.body.taxId?.type) {
      let exists = false
      for (const taxId of customer.tax_ids.data) {
        if (taxId.type === req.body.taxId.type && taxId.value === req.body.taxId.value) {
          // await stripe.customers.deleteTaxId(user.stripeId, taxId.id)
          exists = true
        }
      }
      if (!exists) {
        await stripe.customers.createTaxId(user.stripeId, req.body.taxId)
      }
    }
    if (req.body.cardId) {
      payload.invoice_settings.default_payment_method = req.body.cardId
    }
    await stripe.customers.update(user.stripeId, payload)
    // libstripe.customer.cache.delete(user.stripeId)
    // libstripe.defaultCard.cache.delete(user.stripeId)
    res.status(200).send(await xforms.billing(user))
  })

  app.get('/invoice-items', async (req, res) => {
    let id = req.user.id
    if (req.query.scope) {
      id = parseInt(req.query.scope)
    }
    await req.user.can('read', User, id)
    const user = await User.findByPk(id)
    if (!user.stripeId) {
      res.status(400).send({error: 'no stripe account for user'})
      return
    }

    const payments = await stripe.paymentIntents.list({
      customer: user.stripeId,
      limit: 100,
      created: {
        gt: new Date(req.query.start),
        lte: new Date(req.query.end),
      },
    })
    if (payments.data.length === 100) {
      // TODO: I punted on paging when there are more than the limit of 100
      // https://stripe.com/docs/api/payment_intents/list#list_payment_intents-starting_after
      log.error({id: String(user.id)}, 'hit paymentIntents endpoint limit for stripe user:', user.stripeId)
    }
    const l = []
    for (const pmt of payments.data.reverse()) {
      const obj = xforms.invoiceItem(pmt)
      if (obj) {
        let sub = null
        if (pmt.metadata.subscription) {
          sub = await Subscription.findByPk(pmt.metadata.subscription, {
            include: [Product, {model: Book, required: false}],
          })
          if (sub) {
            obj.description += ` for ${sub.book?.title || 'NO BOOK ASSIGNED'}`
          } else {
            log.warn({id: pmt.id}, 'subscription not found for payment:', pmt.metadata.subscription)
          }
        } else if (pmt.invoice) {
          const inv = await stripe.invoices.retrieve(pmt.invoice)
          sub = await Subscription.findOne({
            where: {stripeId: inv.subscription},
            include: [Product, {model: Book, required: false}],
          })
          if (sub) {
            obj.description = `${sub.product.name} for ${sub.book?.title || 'NO BOOK ASSIGNED'}`
          } else {
            log.warn({id: inv.id}, 'subscription not found for invoice:', inv.subscription)
          }
        }
        l.push(obj)
      }
    }
    res.status(200).send(l)
  })
}
