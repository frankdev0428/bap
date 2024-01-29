
module.exports = ({app, log, sequelize}) => {

  const {User, Referral, Subscription} = require('@bap/cotton/model')(sequelize)
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  app.get('/referrals', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    }
    const referrals = await Referral.findAll({
      where: {userId},
      include: [{model: Subscription, required: false}],
      order: [['id', 'DESC']],
    })
    res.status(200).send(referrals.map(xforms.referral))
  })
}
