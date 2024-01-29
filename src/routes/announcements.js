
const _ = require('lodash')
const {Op, QueryTypes} = require('sequelize')
const date = require('date-fns')
const axios = require('axios').create({
  validateStatus: null,
  maxContentLength: 9999999,
  poll: {
    maxSockets: 500,
  },
  timeout: 10000,
})

const QRY = {}
QRY.awards = `
SELECT DISTINCT
  a.name AS "name"
, s.name AS "sponsor.name"
, MAX(a.id) AS "id"
, ARRAY_AGG(DISTINCT a.open_date::text || ',' || COALESCE(a.due_date::text, '') || ',' || COALESCE(a.results_date::text, '')) AS dates
FROM
  awards a
, sponsors s
WHERE
  s.id = a.sponsor_id
AND
  a.tombstoned IS NULL
AND
  a.open_date IS NOT NULL
-- AND
--   a.name LIKE 'Book of the Year%'
GROUP BY 1,2
ORDER BY name
;`

module.exports = ({app, log, sequelize, s3, uploads}) => {

  const model = require('@bap/cotton/model')(sequelize)
  const {User, Book, Author, Announcement, Match, MatchState, Award, Sponsor} = model
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  // const libtask = require('@bap/cotton/lib/task')({log, sequelize})
  const asset = require('@bap/cotton/s3')({log, sequelize, s3})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})
  const {updateCousins} = require('@bap/cotton/lib/awards')({log, sequelize})

  const INCLUDE = [
    {
      model: Award,
      include: [{model: Sponsor, attributes: ['name']}],
      attributes: ['name', 'email', 'openDate'],
    },
  ]

  app.get('/announcements', async (req, res) => {
    const isAM = req.user.isAM()
    if (!isAM) {
      throw new model.AccessError(req.user.id, 'create', 'announcement', null)
    }
    const anns = await Announcement.findAll({
      include: INCLUDE,
      order: [['created', 'DESC']],
      limit: 500,
    })
    res.status(200).send(anns.map(xforms.announcement))
  })

  app.post('/announcements', async (req, res) => {
    const isAM = req.user.isAM()
    if (!isAM) {
      throw new model.AccessError(req.user.id, 'create', 'announcement', null)
    }
    const award = await Award.findOne({
      where: {
        name: req.body.award,
        openDate: req.body.cycle,
      },
      include: [
        {
          model: Sponsor,
          attributes: ['name'],
        },
      ],
    })
    const ann = await Announcement.create({...req.body, awardId: award.id})
    ann.award = award
    res.status(200).send(xforms.announcement(ann))
  })

  app.put('/announcements/:id/upload', uploads.array('files', 3), async (req, res) => {
    if (!req.files) {
      res.status(400).send({error: 'files missing'})
      return
    }
    const id = parseInt(req.params.id)
    const ann = await Announcement.findByPk(id, {include: INCLUDE})
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'update', 'announcement', id)
    }
    const old = []
    const slot = req.body.slot
    for (const file of req.files) {
      if (ann.files[slot]) {
        old.push(asset.curKey('announcements', ann.files[slot]))
      }
      ann.files[slot] = await asset.uploadAnnouncementFile(ann, file)
    }
    ann.changed('files', true) // changes in json objects not auto-detected cuz {} != {}
    await ann.save()
    await asset.safeDeleteUpload(...old)
    res.status(200).send(xforms.announcement(ann))
  })

  app.get('/announcements/:id', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'read', 'announcement', null)
    }
    const id = parseInt(req.params.id)
    const ann = await Announcement.findByPk(id, {include: INCLUDE})
    if (!ann) {
      // our client library needs something, so giving a dummy null object
      res.status(200).send({id: 0, cycle: new Date(), created: new Date(), files: {}})
      return
    }
    res.status(200).send(xforms.announcement(ann))
  })

  app.get('/announcements/for-match/:id', async (req, res) => {
    // TODO: worth trying to short-circuit if match status < submitted?
    const anns = await Announcement.findAll({
      where: {
        matches: {[Op.contains]: parseInt(req.params.id)},
      },
      include: INCLUDE,
      order: [['created', 'DESC']],
    })
    res.status(200).send(anns.map(xforms.announcement))
  })

  app.delete('/announcements/:id', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'delete', 'announcement', null)
    }
    const id = parseInt(req.params.id)
    await Announcement.destroy({where: {id}})
    res.status(200).send({id})
  })

  app.post('/announcements/:id/validate', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'read', 'announcement', null)
    }
    const id = parseInt(req.params.id)
    const ann = await Announcement.findByPk(id, {include: INCLUDE})
    if (!ann) {
      throw model.NotFoundError('announcement', id)
    }
    const errors = {}
    if (ann.url) {
      let text = ''
      try {
        const r = await axios.get(ann.url)
        if (r.status < 300) {
          text = r.data.replace(/\W/ug, '').toLowerCase()
        }
      } catch (err) {
        log.warn(err, 'failed to scrape winner url:', ann.url)
      }
      if (text) {
        const matches = await Match.findAll({
          where: {
            id: {[Op.in]: req.body.all},
          },
          include: [
            {model: model.Subscription, include: [User]},
            {model: Book, include: [Author]},
          ],
        })
        for (const match of matches) {
          const selected = req.body.selected.indexOf(match.id) !== -1
          const found = text.indexOf(match.book.author.fullname.replace(/\W/ug, '').toLowerCase()) !== -1
          if (found) {
            if (!selected) {
              errors[match.id] = 'not-selected'
            }
          } else if (selected) {
            errors[match.id] = 'not-found'
          }
        }
      }
    }
    res.status(200).send({errors})
  })

  app.post('/announcements/:id/publish', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'read', 'announcement', null)
    }
    const ann = await Announcement.findByPk(parseInt(req.params.id), {include: INCLUDE})
    const award = ann.award
    const matches = new Set(ann.matches)
    const partners = {}
    for (const id of req.body.matches) {
      const match = await Match.findByPk(id, {
        include: [
          {model: model.Subscription, include: [User]},
          {model: Award, include: [Sponsor]},
          {model: Book, include: [Author]},
        ],
      })
      const user = match.subscription.user
      const parent = await model.parentUser(user.id)
      const partner = await model.Partner.findOne({where: {userId: parent.id}})
      if (!ann.notice) {
        await model.MatchState.create({
          matchId: match.id,
          name: 'won',
          userId: req.user.id,
        })
        match.status = 'won'
        await match.save()

        // update sibling scores
        await updateCousins(match)
      }
      await libmail.add(`Author Award ${ann.notice ? 'Update' : 'Winner'}`, user, {
        match,
        ann,
      })
      matches.add(id)
      if (!partners[partner.id]) {
        partners[partner.id] = {user: parent, users: {}}
      }
      if (!partners[partner.id].users[user.id]) {
        partners[partner.id].users[user.id] = {
          id: user.id,
          email: user.email,
          fullname: user.fullname,
          book: {
            title: match.book.title,
            cover: match.book.cover,
          },
          author: {
            email: match.book.author.email,
            fullname: match.book.author.fullname,
            address: match.book.author.address,
          },
          subscriptionId: match.subscriptionId,
        }
      }
    }
    ann.matches = [...matches].sort()
    await ann.save()
    for (const partner of Object.values(partners)) {
      await libmail.add(`Partner Award ${ann.notice ? 'Update' : 'Winners'}`, partner.user, {
        ann,
        award,
        users: Object.values(partner.users),
      })
    }
    if (!ann.notice && award.email) {
      const users = _.flatten(Object.values(partners).map(p => Object.values(p.users)))
      const bap = (await model.Partner.findByPk(2)).toJSON()
      bap.emails.support = 'submissions@bookawardpro.com'
      bap.bcc = 'submissions@bookawardpro.com'
      const body = await libmail.catalog['Contact Info for Winners'].body({award, users, settings: bap})
      await libmail.send(award.email, 'Contact Info for Winners', body, bap)
    }
    res.status(200).send(xforms.announcement(ann))
  })

  app.get('/announceable', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'read', 'award', null)
    }
    const awards = await sequelize.query(QRY.awards, {
      type: QueryTypes.SELECT,
      raw: true,
      nest: true,
    })
    const f = obj => {
      obj.sponsor = obj.sponsor.name
      obj.cycles = obj.dates.map(s => {
        const l = s.split(',').map(i => (i ? new Date(i) : null))
        return {
          openDate: l[0],
          dueDate: l[1],
          resultsDate: l[2],
        }
      })
      return obj
    }
    res.status(200).send(awards.map(f))
  })

  app.get('/submissions', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'read', 'submission', null)
    }
    const id = parseInt(req.query.announcement)
    const ann = await Announcement.findByPk(id, {include: [Award]})
    const submissions = await Match.findAll({
      where: {
        status: 'submitted',
        managed: true,
        id: {[Op.notIn]: ann.matches},
      },
      include: [
        {model: Book, include: [Author]},
        {
          model: model.Subscription,
          attributes: [],
        },
        {
          model: MatchState,
          where: {
            [Op.and]: [
              {name: 'submitted'},
              sequelize.literal('match_states.user_id != subscription.user_id'),
            ],
          },
        },
        {
          model: Award,
          attributes: ['name', 'category'],
          where: {
            name: ann.award.name,
            openDate: ann.award.openDate,
          },
        },
      ],
      order: [['bookId', 'ASC']],
      // logging: qry => log.warn('QRY:', qry),
    })
    const l = []
    for (const match of submissions) {
      const obj = match.toJSON()
      obj.eta = date.endOfDay(match.submitBy)
      l.push(obj)
    }
    res.status(200).send(l)
  })

}
