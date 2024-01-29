
const _ = require('lodash')
const {Op, QueryTypes} = require('sequelize')
const date = require('date-fns')

const QRY = {}
QRY.upcoming = `
SELECT
  a.name AS "name"
, s.name AS "sponsor.name"
, a.website AS "website"
, a.finals_date AS "finalsDate"
, a.results_date AS "resultsDate"
, a.open_date AS "openDate"
, MAX(a.id) AS "id"
, COUNT(m.id) AS "submissions"
FROM
  awards a
, sponsors s
, matches m
WHERE
  s.id = a.sponsor_id
AND
  a.id = m.award_id
AND
  m.managed
AND
  m.status = 'submitted'
AND
  a.tombstoned IS NULL
AND (
    a.finals_date BETWEEN now() + '-10 days' AND now() + '20 days'
  OR
    a.results_date BETWEEN now() + '-10 days' AND now() + '20 days'
  OR (
    a.finals_date IS NULL AND a.results_date IS NULL AND
    a.open_date BETWEEN now() + '-210 days' AND now() + '-180 days'
  )
)
GROUP BY 1,2,3,4,5,6
ORDER BY "resultsDate"
;`

module.exports = ({app, log, sequelize}) => {

  const {User, Book, Author, Subscription, Product, Match, MatchState, Boost, Award, Sponsor, ...model} = require('@bap/cotton/model')(sequelize)
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const libcupid = require('@bap/cotton/lib/cupid')({log, sequelize})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})
  const {awardLandscape, filteredScore, updateCousins} = require('@bap/cotton/lib/awards')({log, sequelize})
  const {F} = require('@bap/cotton/lib/filters')

  app.put('/matches/:id', async (req, res) => {
    if (!req.body.status) {
      res.status(400).send({error: 'missing status'})
      return
    }
    if (req.body.status === 'targeted') {
      res.status(400).send({error: 'only system can mark as targeted'})
    }
    const id = parseInt(req.params.id)
    await req.user.can('update', Match, id)
    const match = await Match.findByPk(id, {
      include: [
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Book, include: [User, Author]},
      ],
    })
    const isAM = req.user.isAM()
    if (match.status !== req.body.status) {
      if (!isAM && match.prepareBy()) { // see peggy#297
        res.status(400).send({error: 'cannot update status of in-progress submission'})
        return
      }
      const user = match.book.user
      if (!match.managed) {
        // once managed, always managed
        match.managed = isAM
      }
      match.status = req.body.status
      if (match.status === 'submitted') {
        if (isAM) {
          // TODO: missing MatchState.targeted
          match.targeting = 'complete' // in case was expedited
          // only notify when manager marks it as submitted
          await libmail.add('Submission Complete', user, {match})
        }
      }
      await match.save()

      // update sibling scores
      if (match.status === 'submitted' || match.status === 'won') {
        await updateCousins(match)
      }

      match.match_states.push(await MatchState.create({
        userId: req.user.id,
        matchId: match.id,
        name: req.body.status,
      }))
    }
    res.status(200).send(xforms.match(match, {isAM}))
  })

  app.get('/matches/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    if (id === 0) {
      // support api client lib needing to call this endpoint when no id defined yet
      res.status(200).send({id: 0})
      return
    }
    await req.user.can('read', Match, id)
    const isAM = req.user.isAM()
    const match = await Match.findByPk(id, {
      include: [
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Book, include: [User, Author]},
      ],
    })
    res.status(200).send(xforms.match(match, {isAM}))
  })

  app.get('/matches', async (req, res) => {
    const view = req.query.view
    let order = [['created', 'DESC']]
    const where = {
      subscriptionId: parseInt(req.query.subscription),
      targeting: {[Op.or]: [
        {[Op.is]: null},
        {[Op.not]: 'candidate'},
      ]},
    }
    await req.user.can('read', Subscription, where.subscriptionId)
    const isAM = req.user.isAM()
    // NOTE:
    // - Award must be the first include cuz of view specific clauses below
    // - F.match() filters out 10 days after due date
    const include = [
      {model: Award, include: [Sponsor], where: {}},
      {model: Subscription, include: [Product]},
      {model: Book, include: [Author]},
      {model: MatchState, order: [['created', 'DESC']], include: [User]},
      // `seperate` executed as a sub-query for each row
      // {model: MatchState, where: {}, separate: true, limit: 1, order: [['created', 'DESC']]},
    ]
    if (req.query.isExtraAward) {
      include[0].where.nonContentTypes = {[Op.not]: null}
    } else {
      include[0].where.nonContentTypes = {[Op.is]: null}
    }
    if (view === 'Targeting') {
      where.targeting = {[Op.not]: null}
    } else if (view === 'Lowest Entry Fee') {
      // all awards, NOT in a status of submitted or won, sorted by entry fee
      order = [[Award, 'fee']]
    } else if (view === 'Due Soon') {
      // all awards due within 30 days, sorted by due date
      include[0].where.dueDate = {
        [Op.lte]: date.add(new Date(), {days: 30}),
        [Op.gt]: date.sub(new Date(), {days: 1}),
      }
      order = [[Award, 'dueDate']]
    } else if (view === 'Announcing Soon') {
      include[0].where.resultsDate = {[Op.lte]: date.add(new Date(), {days: 30})}
      order = [[Award, 'resultsDate']]
    } else if (view === 'All Submitted') {
      // all awards that have been submitted, sorted by matched on date
      where.status = {[Op.in]: ['submitted', 'won']}
    } else if (view === 'Automate Submissions') {
      // all awards eligible for Submit Boost, NOT in a status of submitted or won, sort by due date
      include[0].where.allowsDigital = true
      include[0].where.dueDate = {[Op.or]: [
        {[Op.is]: null},
        {[Op.gt]: date.sub(new Date(), {days: 1})},
      ]}
      where.status = {[Op.or]: [
        {[Op.is]: null},
        {[Op.notIn]: ['submitted', 'won']},
      ]}
      order = [[Award, 'dueDate']]
    } else if (view === 'Interested') {
      // all awards where status is interested, sorted by matched on date
      where.status = 'liked'
    }
    const matches = await Match.findAll({
      where,
      order,
      include,
    })
    res.status(200).send(matches.filter(F.match).map(i => xforms.match(i, {isAM})))
  })

  // use case: AM forcing a match so they target, perform buy-1-get-3, etc
  app.post('/matches', async (req, res) => {
    const isAM = req.user.isAM()
    if (!isAM) {
      throw new model.AccessError(req.user.id, 'read', 'award', req.body.awardId)
    }
    const award = await Award.findByPk(req.body.awardId)
    const subscription = await Subscription.findByPk(req.body.subscriptionId)
    const match = await Match.create({
      awardId: award.id,
      subscriptionId: subscription.id,
      bookId: subscription.bookId,
      score: req.body.score,
      reason: 'am-match',
    })
    await match.reload({
      include: [
        {model: Boost},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: Book, include: [Author]},
      ],
    })
    res.status(200).send(xforms.match(match, {isAM}))
  })

  // use case: SA's to delete a target or match without bugging dev
  app.delete('/matches/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    if (!req.user.isSA()) {
      throw new model.AccessError(req.user.id, 'delete', 'match', id)
    }
    const match = await Match.findByPk(id, {
      include: [Boost],
    })
    if (match.boost) {
      log.warn({id: String(match.boost.id)}, 'deleting boost of match:', id)
      await match.boost.destroy()
    }
    await match.destroy()
    res.status(200).send({id})
  })

  app.get('/targets', async (req, res) => {
    const subscriptionId = parseInt(req.query.subscription)
    if (!subscriptionId) {
      res.status(400).send({error: 'missing subscription'})
      return
    }
    const order = [['targeted', 'DESC']]
    await req.user.can('read', Subscription, subscriptionId)
    const matches = await Match.findAll({
      where: {
        subscriptionId,
        targeting: {[Op.and]: [
          {[Op.not]: null},
          {[Op.not]: 'rejected'},
        ]},
      },
      order,
      include: [
        {model: Boost},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: Book, include: [Author]},
      ],
    })
    res.status(200).send(matches.filter(F.target).map(m => xforms.target(m)))
  })

  app.get('/targets/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    if (id === 0) {
      res.status(200).send({id: 0})
      return
    }
    await req.user.can('read', Match, id)
    const match = await Match.findByPk(id, {
      include: [
        {model: Boost},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: Book, include: [Author]},
      ],
    })
    res.status(200).send(xforms.target(match))
  })

  // use case: AM expediting the target
  app.post('/targets/:id/approve', async (req, res) => { // aka expedite
    const id = parseInt(req.params.id)
    await req.user.can('update', Match, id)
    const target = await Match.findByPk(id, {
      include: [
        {model: Boost},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product, User]},
        {model: Book, include: [Author]},
      ]
    })
    await libcupid.presentTargetToUser(target)
    res.status(200).send(xforms.target(target))
  })

  // use case: user rejecting the target, not "new/fresh target"
  app.post('/targets/:id/retarget', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('update', Match, id)
    const match = await Match.findByPk(id, {
      include: [
        {model: Boost},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: Book, include: [Author]},
      ],
    })
    const opts = {
      matching: 'none',
      targeting: `force-${match.submitBy ? 'submit' : 'target'}`,
    }
    // NOTE: not setting status to targeted so that rejected candidates show as normal matches to users,
    // but rejected targets that have been presented will stay status=targeted
    // NOTE: the app does not allow retargeting of candidate targets, they would get reassigned by AM.
    match.targeting = 'rejected'
    match.submitBy = null
    match.save()
    if (match.boost) {
      // reset the boost so we can find another target
      match.boost.processed = null
      await match.boost.save()
      // cupid will automatically target to satisfy unprocessed boost
      delete opts.targeting
    }
    log.info({id: String(match.subscriptionId)}, 'target rejected for subscription:', match.id)
    try {
      const {stdout, stderr} = await libcupid.run(match.subscriptionId, opts)
      process.stdout.write(stdout)
      if (stderr) {
        process.stderr.write(stderr)
      }
    } catch (err) {
      err.id = match.subscriptionId
      log.error(err, 'failed to run cupid for retargeted match:', match.id)
    }
    res.status(200).send(xforms.target(match))
  })

  // use case: AM's overriding the current target
  app.post('/targets/:id/assign', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('delete', Match, id)
    const target = await Match.findByPk(id)
    let match = null // this replace the current target
    // NOTE: using old target's timestamp cuz want to stay in the normal service delivery timing
    if (req.body.matchId) {
      // assigning from a prior match
      await Match.update({
        // status: null,
        managed: true,
        targeting: 'candidate',
        reason: target.reason,
        boostId: target.boostId,
        targeted: target.targeted,
        submitBy: target.submitBy,
      }, {
        where: {id: parseInt(req.body.matchId)},
      })
      match = target
    } else {
      // assigning from award landscape
      match = await Match.create({
        awardId: parseInt(req.body.awardId),
        subscriptionId: target.subscriptionId,
        bookId: target.bookId,
        boostId: target.boostId,
        managed: true,
        targeting: 'candidate',
        reason: target.reason,
        score: req.body.score,
        targeted: target.targeted,
        submitBy: target.submitBy,
      })
    }
    await match.reload({
      include: [
        {model: Boost},
        {model: MatchState, order: [['created', 'DESC']], include: [User]},
        {model: Award, include: [Sponsor]},
        {model: Subscription, include: [Product]},
        {model: Book, include: [Author]},
      ],
    })
    // NOTE: deleting so has an opportunity to get matched again
    await target.destroy()
    res.status(200).send(xforms.target(match))
  })

  app.get('/awards/landscape', async (req, res) => {
    const id = parseInt(req.query.subscription)
    const isAM = req.user.isAM()
    if (!isAM) {
      throw new model.AccessError(req.user.id, 'landscape', 'subscription', id)
    }
    const subscription = await Subscription.findByPk(id, {
      include: [{model: Book, include: [Author]}],
    })
    if (!subscription.book) {
      log.warn({id}, 'trying to view awards for bookless subscription')
      res.status(200).send([])
      return
    }
    const candidates = []
    const data = await awardLandscape(subscription.book)
    data.forEach(candidate => {
      candidates.push(xforms.landscapeCandidate(candidate, {isAM}))
    })
    res.status(200).send(_.sortBy(candidates, i => -i.score))
  })

  app.get('/awards/upcoming', async (req, res) => {
    const isAM = req.user.isAM()
    if (!isAM) {
      throw new model.AccessError(req.user.id, 'read', 'upcoming awards', 0)
    }
    const awards = await sequelize.query(QRY.upcoming, {
      type: QueryTypes.SELECT,
      raw: true,
      nest: true,
    })
    res.status(200).send(awards)
  })

  app.get('/awards/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const isAM = req.user.isAM()
    if (!isAM) {
      throw new model.AccessError(req.user.id, 'read', 'award', id)
    }
    const award = await Award.findByPk(id, {
      include: [Sponsor],
    })
    res.status(200).send(xforms.award(award, {isAM}))
  })

  app.get('/awards/:id/score/:book', async (req, res) => {
    const id = parseInt(req.params.id)
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, 'read', 'award', id)
    }
    const award = await Award.findByPk(id, {
      include: [Sponsor],
    })
    const book = await Book.findByPk(parseInt(req.params.book), {
      include: [Author],
    })
    const reply = {id}
    reply.scores = await filteredScore(book, award, {always: true})
    if (reply.scores) {
      reply.total = reply.scores.total
      delete reply.scores.total
    }
    res.status(200).send(reply)
  })

  app.get('/submits', async (req, res) => {
    if (!req.user.isAM()) {
      throw new model.AccessError(req.user.id, '/am/todo', 'submission', 0)
    }
    const where = {
      status: {[Op.or]: [
        {[Op.is]: null},
        {[Op.notIn]: ['submitted', 'won']},
      ]},
      submitBy: {[Op.not]: null},
    }
    if (req.query.date) {
      where.submitBy = {[Op.and]: [
        {[Op.gte]: req.query.date},
        {[Op.lt]: date.endOfDay(new Date(req.query.date))},
      ]}
    }

    const submissions = await Match.findAll({
      where,
      include: [
        MatchState,
        {model: Award, attributes: ['name', 'category', 'submitNotes']},
        {model: Book, include: [Author]},
        {
          model: Subscription,
          where: {enabled: true},
          include: [Product],
        },
        Boost,
      ],
      order: [['targeted', 'ASC']],
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
