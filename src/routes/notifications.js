
const _ = require('lodash')

// TODO: use levels from mail.js
const EMAIL = {
  info: 1,
  notice: 2,
  warn: 3,
  request: 4,
  error: 5,
}

module.exports = ({app, log, sequelize}) => { // eslint-disable-line no-unused-vars

  const {User, Notification} = require('@bap/cotton/model')(sequelize)

  app.get('/notifications', async (req, res) => {
    if (!req.user) {
      // TODO: working around client requesting even though not logged in
      res.status(200).send([])
      return
    }
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    }
    const view = req.query.view
    const order = [['created', 'DESC']]
    const where = {userId}
    const limit = req.query.limit || 50
    if (view === 'Unread') {
      where.read = false
    } else if (view === 'Requests') {
      where.level = 4
    }
    const msgs = await Notification.findAll({
      where,
      order,
      limit,
    })
    res.status(200).send(msgs)
  })

  app.put('/notifications/:id/read', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('read', Notification, id)
    await Notification.update({read: true}, {where: {id}})
    res.status(200).send({id})
  })

  app.get('/notifications/stats', async (req, res) => {
    if (!req.user) {
      res.status(200).send({id: 0})
      return
    }
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    }
    const all = await Notification.findAll({
      where: {userId},
    })
    const grouped = {
      info: all.filter(i => i.level === EMAIL.info),
      notice: all.filter(i => i.level === EMAIL.notice),
      warn: all.filter(i => i.level === EMAIL.warn),
      request: all.filter(i => i.level === EMAIL.request),
    }
    const unread = i => !i.read
    const stats = {
      id: req.user?.id || 0,
      groups: [
        {
          name: 'Info',
          total: grouped.info.length,
          unread: grouped.info.filter(unread).length,
        },
        {
          name: 'Notice',
          total: grouped.notice.length,
          unread: grouped.notice.filter(unread).length,
        },
        {
          name: 'Warning',
          total: grouped.warn.length,
          unread: grouped.warn.filter(unread).length,
        },
        {
          name: 'Requests',
          total: grouped.request.length,
          unread: grouped.request.filter(unread).length,
        },
      ],
    }
    stats.unread = _.sumBy(stats.groups, 'unread')
    res.status(200).send(stats)
  })

}
