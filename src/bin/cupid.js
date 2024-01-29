#! /usr/bin/env node

const USAGE = `
Match up books to awards and Target as needed.

Usage: COMMAND [options] [<subscription>]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: warn]
  -n, --dry-run
    Only print matches & targets
  -m, --matching KIND
    none: do not perform matching
    force: match even if not enough time since last one
  -t, --targeting KIND
    none: do not perform targeting
    force-submit: target for submission even if not enough time since last one
    force-target: target without submission even if not enough time since last one
    webhook: used when called from stripe webhook on successful renewal
  -d, --day NUM
    Days from now to consider "today", useful for backfilling or testing [default: 0]
`

const _ = require('lodash')
const date = require('date-fns')
const {Sequelize, Op} = require('sequelize')
const {randitem} = require('@bap/cotton/lib')

const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
  today: date.add(new Date(), {days: parseInt(argv['--day'])}),
  subscription: parseInt(argv['<subscription>']),
  matching: argv['--matching'],
  targeting: argv['--targeting'],
}

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
})

const {plan} = require('@bap/cotton/lib/schedule')(log, {
  today: parseInt(argv['--day']),
})
const sequelize = new Sequelize({
  logging: false,
  dialect: 'postgres',
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGNAME,
  username: process.env.PGUSER,
  password: process.env.PASSWORD,
})
const libcupid = require('@bap/cotton/lib/cupid')({log, sequelize, TODAY: config.today})

const {targetable, newCandidates, filteredScore} = require('@bap/cotton/lib/awards')({log, sequelize, TODAY: config.today})

const {User, Award, Subscription, Boost, Product, Book, Author, Match, MatchState, ...model} = require('@bap/cotton/model')(sequelize)
const libmail = require('@bap/cotton/lib/mail')({log, sequelize})

async function processCandidateTargets() {
  log.info('processing candidate targets')
  const candidates = await Match.findAll({
    where: {
      targeting: 'candidate',
      targeted: {[Op.lte]: date.sub(config.today, {days: 5})},
    },
    include: [
      Book,
      Award,
      {model: Subscription, include: [User, Product]},
    ],
  })
  for (const target of candidates) {
    log.info({id: String(target.subscriptionId), match: target.id, reason: target.reason}, 'candidate ready:', target.award.name)
    if (!config.dryrun) {
      await libcupid.presentTargetToUser(target)
    }
  }
}

async function processPresentedTargets() {
  // notify AM's to perform submission for:
  // - boosts with user-chosen target
  // - targets that have completed candidate phase
  // - targets that have yet to be submitted
  log.info('processing presented targets')
  const targets = await Match.findAll({
    where: {
      status: 'targeted', // to avoid processing already submitted
      targeting: {[Op.in]: ['presented', 'complete']},
      submitBy: {[Op.lte]: config.today},
    },
    include: [
      Book,
      Award,
      {model: Subscription, include: [User, Product]},
    ],
  })
  const root = await model.rootUser()
  for (const target of targets) {
    log.info({id: String(target.subscriptionId), match: target.id}, 'prepare submission:', target.book.title, 'for', target.award.name)
    if (!config.dryrun) {
      let plan = target.subscription.product.name // eslint-disable-line no-shadow
      if (target.boostId) {
        const boost = await Boost.findByPk(target.boostId, {include: [Product]})
        plan = boost.product.name
      }
      const notified = await libmail.add('New Submission', root, {
        target,
        plan,
        customer: target.subscription.user,
        book: target.book,
        award: target.award,
      })
      if (notified) {
        log.info({id: String(target.subscriptionId), match: target.id}, 'awards masters notified:', target.book.title, 'for', target.award.name)
      }
      if (target.targeting === 'presented') {
        // mark as completed so that user will not be allowed to reject
        target.targeting = 'complete'
        await target.save()
      }
    }
  }
}

async function priorMatches(subscription) {
  // NOTE: leaving here in case re-scoring is too problematic (see peggy#263)
  // SELECT
  // m.id AS "matchId"
  // , m.subscription_id AS "subscriptionId"
  // , s.user_id AS "userId"
  // , m.award_id AS "awardId"
  // , m.book_id AS "bookId"
  // , m.score
  // , a.name
  // , a.category
  // , COALESCE(a.bap_fee, a.fee) as "fee"
  // , a.allows_digital AS "allowsDigital"
  // , EXTRACT(days FROM a.due_date - now()) AS "days"
  // FROM matches m, awards a, subscriptions s
  // WHERE
  // m.subscription_id = :subscriptionId
  // AND
  // m.award_id = a.id
  // AND
  // m.subscription_id = s.id
  // AND
  // m.targeting IS NULL
  // AND
  // (m.status IS NULL OR m.status NOT IN ('submitted', 'won'))
  // AND
  // (a.due_date IS NULL OR a.due_date > CURRENT_TIMESTAMP + '10 days')
  // AND
  // a.allows_digital
  // AND
  // COALESCE(a.bap_fee, a.fee) <= 100
  // const matches = await sequelize.query(QRY.targetablePriorMatches, {
  //   replacements: {subscriptionId},
  //   type: QueryTypes.SELECT,
  // })
  const matches = await Match.findAll({
    where: {
      subscriptionId: subscription.id,
      targeting: {[Op.is]: null},
      status: {[Op.or]: [
        {[Op.is]: null},
        {[Op.notIn]: ['submitted', 'won']},
      ]},
    },
    include: [Award, {model: Book, include: [Author]}],
  })
  const result = []
  for (const match of matches) {
    if (targetable(match.award)) {
      const scores = await filteredScore(match.book, match.award)
      if (scores) {
        result.push({ // needs to be same shape as newCandidates
          scores,
          subscriptionId: subscription.id,
          matchId: match.id,
          userId: match.book.userId,
          bookId: match.book.id,
          awardId: match.award.id,
          score: scores.total,
          name: match.award.name,
          category: match.award.category,
          allowsDigital: match.award.allowsDigital,
          fee: match.award.fee,
          dueDate: match.award.dueDate,
          days: date.differenceInDays(match.award.dueDate, new Date()),
          doSubmission: subscription.product.features.includes('submit'),
        })
      }
    }
  }
  return result
}

function debugMsg(match, candidates) {
  const x = {
    candidates,
    id: String(match.subscriptionId),
    match: match.matchId,
    award: match.awardId,
    score: match.score,
    days: match.days,
  }
  if (config.verbosity === 'debug') {
    x.scores = match.scores
  }
  return x
}

async function dotarget(candidate, {boost} = {}) {
  // single best match for all open awards:
  const msg = debugMsg(candidate) // , matches.length)
  if (!config.dryrun) {
    let target = null
    let submitBy = null
    let reason = 'renewal'
    if (boost) {
      reason = 'boost'
      submitBy = date.addDays(config.today, 9)
    } else if (config.targeting === 'force-target') {
      reason = 'extra-target'
    } else if (config.targeting === 'force-submit' || candidate.doSubmission) {
      submitBy = date.addDays(config.today, 9)
    }
    if (candidate.matchId) {
      target = await Match.findByPk(candidate.matchId, {
        include: [{model: Subscription, include: [User, Product]}, Book, Award],
      })
      target.targeting = 'candidate'
      target.managed = true
      target.targeted = config.today
      target.boostId = boost?.id
      target.reason = reason
      target.submitBy = submitBy
      await target.save()
    } else {
      target = await Match.create({
        ...candidate,
        reason,
        submitBy,
        targeting: 'candidate',
        managed: true,
        targeted: config.today,
        boostId: boost?.id,
      })
      await target.reload({
        include: [{model: Subscription, include: [User, Product]}, Book, Award],
      })
    }
    msg.match = target.id
    await libmail.add('Candidate Targeted', await model.rootUser(), {
      target,
      customer: target.subscription.user,
      plan: target.subscription.product.name,
      book: target.book,
      award: target.award,
    })
  }
  log.info(msg, 'targeted:', candidate.name)
}

const getPlannedMatches = async (awards, subscription) => {
  const matches = await plan(_.sortBy(awards, 'score').slice(-500)).map(match => ({ // TODO: codify this shape as Candidate
    userId: subscription.userId,
    awardId: match.awardId,
    subscriptionId: subscription.id,
    bookId: subscription.bookId,
    name: match.name,
    category: match.category,
    dueDate: new Date(match.dueDate),
    allowsDigital: match.allowsDigital,
    score: match.score,
    scores: match.scores,
    fee: match.fee,
    days: match.days,
    doSubmission: subscription.product.features.includes('submit'),
  }))
  // useful to show first N matches from the planner
  // log.warn('PLAN:\n ', matches.map(m => `${m.days} : ${m.score} : ${m.name}`).slice(0, 20).join('\n  '))
  return matches
}

const processTarget = async (subscription, should, boosts, matches) => {
  const targeted = {}
  if (should.target || boosts.length) {
    const candidates = _.sortBy(_.uniqBy(matches.filter(targetable).concat(await priorMatches(subscription)), i => i.awardId), 'score')
    for (const boost of boosts) {
      log.info({id: String(boost.subscriptionId)}, 'target analysis: boost')
      if (boost.awards.length === 0) {
        if (boost.product.features.includes('fast')) {
          // fast track is simply dotarget() 5 times for now
          for (let i = 0; i < 5; i++) {
            const target = candidates.pop()
            await dotarget(target, {boost})
            targeted[target.awardId] = true
          }
        } else {
          const target = candidates.pop()
          await dotarget(target, {boost})
          targeted[target.awardId] = true
        }
      } else {
        for (const awardId of boost.awards) {
          const target = await Match.findOne({
            where: {
              awardId,
              subscriptionId: boost.subscriptionId,
            },
            include: [
              {model: Subscription, include: [Product, User]},
              Book,
              Award,
            ]
          })
          targeted[target.awardId] = true
          log.info(debugMsg(target), 'targeted:', target.award.name)
          if (!config.dryrun) {
            target.status = 'targeted'
            target.managed = true
            target.targeting = 'presented'
            target.targeted = boost.created
            target.boostId = boost.id
            target.reason = 'boost'
            target.submitBy = config.today
            await target.save()
            await MatchState.create({
              matchId: target.id,
              name: 'targeted',
            })
          }
        }
      }
      if (!config.dryrun) {
        boost.processed = new Date()
        await boost.save()
      }
    }
    if (should.target) {
      log.info({id: String(subscription.id)}, 'target analysis:', should.target)
      const target = candidates.pop()
      await dotarget(target)
      targeted[target.awardId] = true
    }
  }
  return targeted
}

const processMatches = async params => {
  const [should, awards, matches, prior, targeted, extra] = params
  const awardSuffix = !extra ? ' (Book-Award)' : ' (Extra-Award)'
  const defaultCount = !extra ? 6 : 3
  const priorMatch = !extra ? prior.match : prior.extraMatch
  const chosen = {}

  if ((should.match && !extra) || (should.extraMatch && extra)) {
    // Assuming the planner scheduled 1-2 matches per day, pick the highest
    // scored, but only from the first N days to respect the scheduler/planner:
    // - prime the pump more quickly: 6 matches from first 5 days (see peggy#265)
    // - plenty of matches: 2 matches from first 2 days
    // - fewer matches: 1-2 matches from first 2 days
    const best = _.sortBy(matches.filter(i => !targeted[i.awardId]).slice(0, priorMatch ? 4 : 10), 'score')
    let count = randitem([0, 0, 1, 1])
    if (!priorMatch) {
      count = defaultCount
    } else if (awards.length > 125) {
      count = 2
    } else if (awards.length > 100) {
      count = randitem([1, 2, 2])
    } else if (awards.length > 50) {
      count = randitem([1, 1, 2])
    } else if (awards.length > 25) {
      count = randitem([1, 1, 1, 2])
    } else if (awards.length > 15) {
      count = randitem([0, 1, 1, 1])
    }

    while (count && best.length) {
      const match = best.pop()
      if (chosen[match.name + awardSuffix]) { // do not choose from same award (see peggy#265)
        continue
      }
      chosen[match.name + awardSuffix] = match
      count--
      const msg = debugMsg(match, matches.length)
      if (!config.dryrun) {
        const m = await Match.create({
          ...match,
          reason: 'cupid-match',
          created: config.today,
        })
        msg.match = m.id
      }
      log.info(msg, 'matched:', match.name + awardSuffix)
    }
  }
  return chosen
}

async function processOne(subscription) {
  if (!subscription.book) {
    log.debug({id: String(subscription.id)}, 'subscription without book')
    return
  }
  const prior = {
    match: await Match.findOne({
      where: {
        subscriptionId: subscription.id,
      },
      order: [['created', 'DESC']],
      include: {
        model: Award,
        attributes: ['nonContentTypes'],
        where: {
          nonContentTypes: {[Op.is]: null}
        }
      }
    }),
    extraMatch: await Match.findOne({
      where: {
        subscriptionId: subscription.id,
      },
      order: [['created', 'DESC']],
      include: {
        model: Award,
        attributes: ['nonContentTypes'],
        where: {
          nonContentTypes: {[Op.not]: null}
        }
      }
    }),
    target: await Match.findOne({
      where: {
        subscriptionId: subscription.id,
        reason: 'renewal',
        targeting: {[Op.not]: 'rejected'},
      },
      order: [['targeted', 'DESC']],
    })
  }

  const should = {
    match: libcupid.shouldMatch(subscription, prior.match, config.matching),
    extraMatch: libcupid.shouldMatch(subscription, prior.extraMatch, config.matching),
    target: libcupid.shouldTarget(subscription, prior.target, config.targeting),
  }
  const boosts = await Boost.findAll({
    where: {
      subscriptionId: subscription.id,
      processed: {[Op.is]: null},
    },
    include: [Product],
  })
  if (!should.target && !should.match && !should.extraMatch && !boosts.length) {
    return // short-circuit to avoid unnecessary work
  }

  const awards = await newCandidates(subscription.book)
  // split candidates into 'bookAwards' (non_content_types = null) and 'extraAwards' (non_content_types NOT NULL)
  const [bookAwards, extraAwards] = _.partition(awards, ['nonContentTypes', null])
  const subType = subscription.product.id
  const extraPlans = [1, 2, 6]

  // check for candidates
  if (!extraPlans.includes(subType) ? bookAwards.length === 0 : awards.length === 0) {
    log.error({id: String(subscription.id)}, 'zero matches for subscription')
    if (should.target) {
      // do not try to match, but do attempt to target from a prior match
      should.match = false
      should.extraMatch = false
    } else {
      return
    }
  } else if (!extraPlans.includes(subType) ? bookAwards.length < 10 : awards.length < 10) {
    log.warn({id: String(subscription.id), count: !extraPlans.includes(subType) ? bookAwards.length : awards.length}, 'few matches for subscription')
  }

  // process targeting. if not plus/pro/pro-non-recur then only use bookAwards for targeting/matching
  let matches = await getPlannedMatches(!extraPlans.includes(subType) ? bookAwards : awards, subscription)
  const targeted = await processTarget(subscription, should, boosts, matches) // track so that we don't match them later

  // process matches, with 'chosen' going to email
  if (should.match || should.extraMatch) {
    let chosen = {}
    if (!extraPlans.includes(subType)) {
      chosen = await processMatches([should, bookAwards, matches, prior, targeted, false])
    } else {
      for (const [i, awds] of [bookAwards, extraAwards].entries()) {
        matches = await getPlannedMatches(awds, subscription)
        chosen = {...chosen, ...await processMatches([should, awds, matches, prior, targeted, i])}
      }
    }

    // Commeted out for enabling in the future
    // if (!_.isEmpty(chosen) && !config.dryrun) {
    //   await libmail.add('New Award Match', subscription.user, {
    //     book: subscription.book,
    //     subscriptionId: subscription.id,
    //     matches: Object.values(chosen),
    //   })
    // }
  }
}

async function main() {
  const where = {enabled: true}
  if (config.subscription) {
    where.id = config.subscription
  }
  const subscriptions = await Subscription.findAll({
    where,
    include: [
      User,
      {model: Book, include: [Author]},
      Product,
    ],
  })
  for (const subscription of subscriptions) {
    await processOne(subscription)
  }
  if (!config.subscription) {
    // not needed when running for a specific subscription
    await processCandidateTargets()
    await processPresentedTargets()
  }
  sequelize.close()
}

main()
