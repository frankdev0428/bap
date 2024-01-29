
const _ = require('lodash')
const date = require('date-fns')
const crypto = require('crypto')
const {Op} = require('sequelize')

module.exports = ({app, log, sequelize}) => { // eslint-disable-line no-unused-vars

  const model = require('@bap/cotton/model')(sequelize)
  const {User, UserTree, Affiliate, Testimonial, Subscription} = model
  const xforms = require('@bap/cotton/xforms')({log, sequelize})
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})

  app.get('/sub-accounts', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    } else if (req.user.isAM()) {
      userId = (await model.parentUser(userId)).id
    }
    const l = []
    for (const child of await model.children(userId)) {
      if (child.tombstoned) {
        continue
      }
      child.search = _.flatten(_.values(_.pick(child, ['id', 'email', 'fullname', 'nickname', 'authors', 'books'])).join(' ').toLowerCase().split(' ')).join(' ')
      child.authors = _.filter(child.authors).length
      child.books = _.filter(child.books).length
      l.push(child)
    }
    res.status(200).send(l)
  })

  app.get('/sub-accounts/:id', async (req, res) => {
    const userId = parseInt(req.params.id)
    await req.user.can('read', User, userId)
    const user = await User.findByPk(userId)
    res.status(200).send(user ? xforms.subacct(user) : {id: userId})
  })

  // TODO: factor this & accounts.js version
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

  app.post('/sub-accounts', async (req, res) => {
    let partnerId = req.user.id
    if (req.query.scope) {
      partnerId = parseInt(req.query.scope)
      await req.user.can('create', User, partnerId)
    }
    const dup = await User.findOne({
      where: {email: req.body.email}
    })
    if (dup) {
      res.status(400).send({error: 'email address already on existing account or unavailable'})
      return
    }
    const salt = await pass.salt()
    const user = await User.create({
      email: req.body.email,
      password: `${salt}:${await pass.hash(req.body.password || await pass.salt(), salt)}`,
      fullname: req.body.fullname,
      nickname: req.body.nickname,
    })
    await Affiliate.create({
      userId: user.id,
      code: user.affiliateCode(),
    })
    await UserTree.create({
      depth: 0,
      ancestorId: user.id,
      descendantId: user.id,
    })
    await UserTree.create({
      depth: 1,
      ancestorId: partnerId,
      descendantId: user.id,
    })
    if (partnerId !== 1) {
      // TODO: do not assume 2-level partner heirarchy
      await UserTree.create({
        depth: 2,
        ancestorId: 1,
        descendantId: user.id,
      })
    }
    let product = {}
    if (req.body.productId) {
      product = await model.Product.findByPk(req.body.productId)
      const endsOrRenews = date.add(new Date(), {months: product.months})
      await model.Subscription.create({
        userId: user.id,
        productId: product.id,
        status: 'active',
        renews: product.recurs ? endsOrRenews : null,
        end: product.recurs ? null : endsOrRenews,
      })
    }
    try {
      await libmail.add('New User', await model.rootUser(), {
        customer: user,
        plan: product.name,
      })
    } catch (err) {
      log.error(err, 'failed to send new account notification:', user.email)
    }
    const partner = await model.settingsForUser(user.id)
    if (!partner.enterprise) {
      try {
        await libmail.subscribe(user)
      } catch (err) {
        if (err.message !== 'Member Exists') {
          log.error(err, 'failed to subscribe new signup:', user.id, user.email)
        }
      }
    }
    res.status(200).send(xforms.subacct(user))
  })

  app.put('/sub-accounts/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', User, id)
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
    const user = await User.findByPk(id)
    const oldEmail = user.email
    user.email = req.body.email
    user.fullname = req.body.fullname
    user.nickname = req.body.nickname
    if (req.body.password) {
      const salt = await pass.salt()
      user.password = `${salt}:${await pass.hash(req.body.password, salt)}`
    }
    await user.save()
    if (req.body.email && (oldEmail !== req.body.email)) {
      try {
        libmail.changeSubscriber(oldEmail, req.body.email)
      } catch (err) {
        log.error(err, 'failed to change subscriber:', user.id, oldEmail)
      }
    }
    res.status(200).send(xforms.subacct(user))
  })

  app.delete('/sub-accounts/:id', async (req, res) => {
    // TODO: delete any active sessions
    const id = parseInt(req.params.id)
    await req.user.can('delete', User, id)
    const user = await User.findByPk(id)
    const children = await UserTree.count({where: {
      depth: {[Op.gt]: 0},
      ancestorId: id,
    }})
    if (children) {
      res.status(400).send({error: 'cannot remove a partner'})
      return
    }
    const subscriptions = await Subscription.count({where: {
      userId: user.id,
      status: 'active',
    }})
    if (subscriptions) {
      res.status(400).send({error: 'still has active subscriptions'})
      return
    }
    await user.destroy()
    try {
      await libmail.unsubscribe(user)
    } catch (err) {
      log.warn({id: String(user.id), err: err.message}, 'failed to unsubscribe deleted user:', user.email)
    }
    user.email += `-DELETED-${user.id}`
    await user.save()
    res.status(200).send({id})
  })

  app.get('/testimonial/:id', async (req, res) => {
    const userId = parseInt(req.params.id)
    const testimonial = await Testimonial.findOne({where: {userId}})
    if (!testimonial) {
      res.status(200).send({id: userId})
      return
    }
    await req.user.can('read', Testimonial, testimonial.id)
    res.status(200).send(testimonial.toJSON())
  })

  app.put('/testimonial/:id', async (req, res) => {
    const userId = parseInt(req.params.id)
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'update', 'testimonial', userId)
    }
    let testimonial = await Testimonial.findOne({where: {userId}})
    if (testimonial) {
      testimonial.response = req.body.response
      await testimonial.save()
    } else {
      testimonial = await Testimonial.create({
        userId,
        attempt: 0,
        response: req.body.response,
      })
    }
    res.status(200).send(testimonial.toJSON())
  })
}
