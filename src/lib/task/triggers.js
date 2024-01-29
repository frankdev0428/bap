
const _ = require('lodash')
const date = require('date-fns')
const {Op, QueryTypes} = require('sequelize')

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  maxNetworkRetries: 3,
})

const QRY = {}

QRY.booksByUser = `
SELECT
  user_id AS "userId"
, array_agg(book_id) AS "books"
FROM
  subscriptions
WHERE
  enabled
AND
  status = 'active'
AND
  book_id is not null
GROUP BY user_id;
`

QRY.dupSubmissions = `
SELECT s.id AS subscription, array_agg(m.id) AS matches
FROM matches m, subscriptions s
WHERE s.id = m.subscription_id
AND m.targeting IN ('presented','complete')
AND s.enabled
AND reason = 'renewal'
AND m.targeted > s.renewed
GROUP BY 1 HAVING count(*) > 1
;`

QRY.matchedAfterCanceled = `
SELECT m.id AS match
FROM matches m, subscriptions s, products p
WHERE s.id = m.subscription_id
AND p.id = s.product_id
AND p.features ? 'submit'
AND s."end" < m.created
AND m.targeting IS NOT NULL
AND m.boost_id IS NULL
AND m.created > '2021-09-01'
;`

QRY.didNotRenew = `
SELECT id AS subscription
FROM subscriptions
WHERE enabled
AND stripe_id IS NOT NULL
AND renews < now() + '-12 hours'
;`

QRY.didNotSubmit = `
SELECT m.id AS match
FROM matches m, subscriptions s, products p
WHERE s.id = m.subscription_id
AND p.id = s.product_id
AND m.status NOT IN ('submitted', 'won')
AND AGE(m.targeted) > '13 days'
AND m.submit_by IS NOT NULL
AND m.targeting != 'rejected'
;`

QRY.matchedAlreadyWon = `
SELECT m.id, m.subscription_id, m.status, m.created, m.award_id, n.id, n.subscription_id, n.status, n.created, n.award_id
FROM awards a1, awards a2
,    matches m left join match_states ms on ms.match_id = m.id
,    matches n left join match_states ns on ns.match_id = n.id
WHERE n.status = 'won'
AND m.book_id = n.book_id
AND m.id != n.id
AND a1.id = m.award_id
AND a2.id = n.award_id
AND a1.name = a2.name
AND a1.category = a2.category
AND a1.sponsor_id = a2.sponsor_id
AND a1.tombstoned IS NULL
AND a2.tombstoned IS NULL
AND (ms.id IS NULL OR (ms.name = 'won' AND ms.user_id IS NULL))
AND (ns.id IS NULL OR (ns.name='won' AND ns.user_id IS NULL))
;`

module.exports = ({log, sequelize}) => {
  const model = require('@bap/cotton/model')(sequelize)
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})

  async function publishedBooks() {
    const qry = model.Book.findAll({
      where: {
        pubDate: {[Op.and]: [
          {[Op.gte]: date.add(new Date(), {days: 5})},
          {[Op.lt]: date.add(new Date(), {days: 6})},
        ]},
      },
      include: [
        {
          model: model.User,
          where: {tombstoned: null},
        }
      ],
    })
    for (const book of await qry) {
      libmail.add('Published Book', book.user, {
        book,
      })
    }
  }

  async function unconfiguredSubscriptions() {
    const qry = model.Subscription.scope('unconfigured').findAll({
      where: {
        created: {[Op.lt]: date.subDays(new Date(), 10)},
      },
    })
    for (const subscription of await qry) {
      if (subscription.created > date.subDays(new Date(), 50)) {
        libmail.add('Unconfigured Subscription', subscription.user, {
          subscription,
          plan: subscription.product.name,
        })
      } else {
        log.warn({id: String(subscription.id)}, 'tombstoning unconfigured subscription')
        if (process.env.NODE_ENV === 'production') {
          if (subscription.stripeId) {
            await stripe.subscriptions.del(subscription.stripeId)
          }
          subscription.status = 'canceled'
          subscription.end = new Date()
          subscription.renews = null
          subscription.enabled = false
          await subscription.save()
          await subscription.destroy()
        }
      }
    }
  }

  async function expiringSubscriptions() {
    const subscriptions = await model.Subscription.findAll({
      where: {
        enabled: true,
        renews: {[Op.is]: null},
        end: {[Op.lt]: date.add(new Date(), {days: 30})},
      },
      include: [model.User, model.Book, {model: model.Product, where: {recurs: false}}],
    })
    for (const subscription of subscriptions) {
      const partner = await model.parentUser(subscription.userId)
      libmail.add('Subscription Expiring', partner, {
        subscription,
        plan: subscription.product.name,
        customer: subscription.user,
        book: subscription.book,
      })
    }
  }

  async function handleNonStripeSubscriptions() {
    // disable those that have expired
    const expiring = await model.Subscription.findAll({
      where: {
        enabled: true,
        stripeId: {[Op.is]: null},
        // NOTE: comparing to end of today to disable expiring before renewing them below
        end: {[Op.lte]: date.endOfToday()},
      },
    })
    for (const subscription of expiring) {
      log.warn({id: String(subscription.id)}, 'disabling expired, non-stripe subscription')
      subscription.enabled = false
      subscription.status = 'expired'
      await subscription.save()
    }
    // renew those that are due
    const renewing = await model.Subscription.findAll({
      where: {
        enabled: true,
        stripeId: {[Op.is]: null},
        // NOTE: comparing to beginning of tomorrow to handle cases where DayOfMonth(renewed) > DayOfMonth(today)
        renewed: {[Op.or]: [
          {[Op.is]: null},
          {[Op.lte]: date.subMonths(date.startOfTomorrow(), 1)},
        ]},
      },
    })
    for (const subscription of renewing) {
      // NOTE: assumes these are non-recurring - need to update `renews` if we want to lose that assumption
      log.info({id: String(subscription.id)}, 'renewing non-stripe subscription')
      subscription.renewed = new Date()
      await subscription.save()
    }
  }

  async function pendingRequests() {
    const requests = await model.Request.findAll({
      where: {
        approved: {[Op.is]: null},
        created: {[Op.lt]: date.subDays(new Date(), 5)},
      },
      include: [
        model.User,
        model.Product,
        {model: model.User, as: 'requestor'},
      ],
    })
    const partners = _.groupBy(requests, r => r.userId)
    _.each(partners, requests => { // eslint-disable-line no-shadow
      libmail.add('Pending Requests', requests[0].user, {requests})
    })
  }

  async function bookUpdateReminders() {
    const users = await sequelize.query(QRY.booksByUser, {
      raw: true,
      type: QueryTypes.SELECT,
    })
    for (const row of users) {
      const user = await model.User.findByPk(row.userId)
      const books = await model.Book.findAll({
        where: {
          id: {[Op.in]: row.books},
          modified: {[Op.lt]: date.subMonths(new Date(), 1)},
        },
        include: [model.Author],
      })
      libmail.add('Book Update Reminder', user, {
        books,
      })
    }
  }

  async function sanityChecks() {
    const checks = [
      'dupSubmissions',
      'matchedAfterCanceled',
      'didNotRenew',
      'didNotSubmit',
      'matchedAlreadyWon',
    ]
    for (const check of checks) {
      const rows = await sequelize.query(QRY[check], {
        raw: true,
        type: QueryTypes.SELECT,
      })
      if (rows.length) {
        log.fatal({rows}, 'failed sanity check:', check)
      }
    }
  }

  async function cleanupStripe() {
    // remove stripe subscriptions left incomplete (eg failed SCA)
    const gt = date.subHours(new Date(), 2)
    const stripeSubs = await stripe.subscriptions.list({
      status: 'incomplete',
      created: {gt},
    })
    for (const stripeSub of stripeSubs.data) {
      const stripeId = stripeSub.id
      const sub = await model.Subscription.findOne({where: {stripeId}})
      if (sub) {
        log.error({id: sub.id}, 'bap subscription is stripe-incomplete:', stripeId)
      } else {
        await stripe.subscriptions.del(stripeId)
        log.warn({id: stripeId}, 'removed incomplete stripe subscription:', stripeId)
      }
    }
    // TODO: clean up new signup customers that fail SCA
  }

  async function howDidYouHear() {
    const users = await model.User.findAll({
      where: {
        created: {[Op.between]: [date.subHours(new Date(), 26), date.subHours(new Date(), 24)]},
        tombstoned: {[Op.is]: null},
      },
    })
    for (const user of users) {
      const partner = await model.settingsForUser(user.id)
      if (!partner.enterprise) {
        await libmail.add('How Did You Hear', user, {})
      }
    }
  }

  return {
    bookUpdateReminders,
    cleanupStripe,
    howDidYouHear,
    publishedBooks,
    unconfiguredSubscriptions,
    expiringSubscriptions,
    handleNonStripeSubscriptions,
    pendingRequests,
    sanityChecks,
  }
}
