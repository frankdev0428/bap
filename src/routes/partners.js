
const date = require('date-fns')
const {Op} = require('sequelize')
const fsp = require('fs').promises

module.exports = ({app, log, sequelize, s3, uploads}) => {

  const {NotFoundError, User, Partner, ...model} = require('@bap/cotton/model')(sequelize)
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const libcupid = require('@bap/cotton/lib/cupid')({log})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})
  const asset = require('@bap/cotton/s3')({log, sequelize, s3})

  app.get('/partners/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId)
    await req.user.can('read', User, userId)
    res.status(200).send(await model.settingsForUser(userId))
  })

  app.put('/partners/:userId', async (req, res) => {
    const userId = parseInt(req.params.userId)
    await req.user.can('update', User, userId)
    const partner = await Partner.findOne({where: {userId}})
    delete req.body.thumbnail
    for (const field in partner.rawAttributes) {
      if (typeof req.body[field] !== 'undefined') {
        if (field === 'theme') {
          // preserve settings that are not managed in the ui (eg seal)
          Object.assign(partner.theme, req.body.theme)
          partner.changed('theme', true) // changes in json objects not auto-detected cuz {} != {}
        } else {
          partner[field] = req.body[field]
        }
      }
    }
    const product = req.body.product
    if (product) {
      partner.changed('products', true) // changes in json objects not auto-detected cuz {} != {}
      partner.products[product.code].name = product.name
      partner.products[product.code].price = product.price
    }
    await partner.save()
    res.status(200).send(partner)
  })

  app.put('/partners/:userId/logo', uploads.single('logo'), async (req, res) => {
    if (!req.file) {
      res.status(400).send({error: 'logo missing'})
      return
    }
    const userId = parseInt(req.params.userId)
    await req.user.can('update', User, userId)
    const partner = await Partner.findOne({where: {userId}})
    if (!partner) {
      throw NotFoundError(Partner.name, userId)
    }
    const old = asset.curKey('logos', partner.logo)
    const key = asset.newKey('logos', partner.id)
    const upload = await asset.uploadImage(req.file.mimetype, req.file.path, key, 'nogo')
    await asset.uploadImage(req.file.mimetype, req.file.path, `${key}-thumb`, 'x60')
    await fsp.unlink(req.file.path)
    partner.logo = upload.url
    await partner.save()
    await asset.safeDeleteUpload(old, old + '-thumb')
    res.status(200).send({id: partner.id, logo: partner.logo})
  })

  app.get('/requests', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    }
    const where = {userId}
    if (req.query.view === 'Pending') {
      where.approved = {[Op.is]: null}
    } else if (req.query.view === 'Approved') {
      where.approved = true
    } else if (req.query.view === 'Denied') {
      where.approved = false
    }
    const requests = await model.Request.findAll({
      where,
      include: [model.Product],
      order: [['created', 'DESC']],
    })
    const xformed = []
    for (const request of requests) {
      xformed.push(await xforms.request(request))
    }
    res.status(200).send(xformed)
  })

  app.get('/requests/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('read', model.Request, id)
    const request = await model.Request.findByPk(id, {include: [model.Product]})
    res.status(200).send(await xforms.request(request))
  })

  app.put('/requests/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const approved = req.body.approved
    if (approved == null) {
      res.status(400).send({error: 'verdict missing'})
      return
    }
    await req.user.can('update', model.Request, id)
    const request = await model.Request.findByPk(id, {include: [model.Product]})
    // let response = {id: request.id}
    if (request.approved == null) {
      const user = await request.getRequestor()
      const product = await request.getProduct()
      let subscription = null
      let book = null
      if (request.data.book) {
        book = await model.Book.findByPk(request.data.book)
      }
      if (request.data.subscription) {
        subscription = await model.Subscription.findByPk(request.data.subscription, {include: [model.Book]})
        book = subscription.book
      }
      if (approved) {
        if (product.kind === 'plan') {
          const endsOrRenews = date.add(new Date(), {months: product.months})
          subscription = await model.Subscription.create({
            userId: user.id,
            bookId: book.id,
            productId: product.id,
            status: 'active',
            renews: product.recurs ? endsOrRenews : null,
            end: product.recurs ? null : endsOrRenews,
          })
        } else if (product.kind === 'boost') {
          const boost = await model.Boost.create({
            subscriptionId: subscription.id,
            productId: product.id,
            awards: request.data.awards,
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
            log.error(err, 'failed to run cupid for approved subscription:', subscription.id)
          }
        } else {
          res.status(400).send({error: `unknown product kind: ${product.kind}`})
          return
        }
      }
      request.approved = approved
      await request.save()
      libmail.add(`Request ${approved ? 'Approved' : 'Denied'}`, user, {
        request,
        subscription,
        book,
        plan: product.name,
      })
    }
    res.status(200).send({id: request.id})
  })

}
