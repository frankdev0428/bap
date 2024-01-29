
const {Op} = require('sequelize')

module.exports = ({app, log, sequelize}) => {

  const {Affiliate} = require('@bap/cotton/model')(sequelize)
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  app.get('/affiliates/referral/:id', async (req, res) => {
    const id = req.params.id
    if (id === '0') { // our web app makes this request when there is no affiliate code
      res.status(200).send({id})
      return
    }
    const affiliate = await Affiliate.findOne({where: {code: {[Op.iLike]: id}}})
    if (!affiliate) {
      log.warn({id}, 'invalid affiliate code:', id)
      res.status(200).send({id, url: 'https://bookawardpro.com'})
      return
    }
    res.status(200).send({id, url: affiliate.url})
  })

  app.get('/affiliates/:id', async (req, res) => {
    let userId = parseInt(req.params.id)
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
    }
    const affiliate = await Affiliate.findOne({where: {userId}})
    await req.user.can('read', Affiliate, affiliate.id)
    res.status(200).send(xforms.affiliate(affiliate))
  })

  // keeping in case we want an easy way to get csv
  //
  // app.get('/commissions/:method', async (req, res) => {
  //   if (!req.user.isAM()) {
  //     throw new model.AccessError(req.user.id, 'read', 'commission', 0)
  //   }
  //   const start = req.query.start ? new Date(req.query.start) : date.startOfMonth(new Date())
  //   const end = req.query.end ? new Date(req.query.end) : new Date()
  //   const payouts = await libaffiliate.commissions(req.params.method, start, end)
  //   // res.type('csv').status(200)
  //   res.set('content-type', 'text/plain').status(200)
  //   res.send(payouts.map(i => `${i.email},${i.amount},USD`).join('\n'))
  // })

}
