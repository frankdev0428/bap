#! /usr/bin/env node

const USAGE = `
Create new match email notifications.

Usage: COMMAND [options]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: warn]
  -n, --dry-run
    Only print new match email notifications
`
const date = require('date-fns')
const {Sequelize, Op} = require('sequelize')
const bunyan = require('bunyan')

const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
}

const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
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

const {User, Subscription, Book, Match, Notification, Award} = require('@bap/cotton/model')(sequelize)
const libmail = require('@bap/cotton/lib/mail')({log, sequelize})

const FREQUENCY = {
  AS_THEY_HAPPEN: 'As they happen',
  ONCE_WEEKLY: 'Once weekly',
  TWICE_MONTHLY: 'Twice monthly',
  NEVER: 'Never',
}

const FREQUENCY_DAYS = {
  [FREQUENCY.AS_THEY_HAPPEN]: 1,
  [FREQUENCY.ONCE_WEEKLY]: 7,
  [FREQUENCY.TWICE_MONTHLY]: 14,
}

const prevNotificationTime = frequency => {
  if (frequency === FREQUENCY.NEVER) {
    return null
  }
  return date.set(date.subDays(new Date(), FREQUENCY_DAYS[frequency]), {hours: 0, minutes: 0, seconds: 0})
}

async function main() {
  log.info('Started creating new match email notifications')
  const subscriptions = await Subscription.findAll({
    where: {
      enabled: true,
    },
    include: [
      User,
      Book,
    ],
  })
  for (const subscription of subscriptions) {
    const frequency = subscription.user.newMatchNotification
    const prevNotifiTime = prevNotificationTime(frequency)

    if (!prevNotifiTime || !subscription.book) {
      continue
    }
    if (frequency !== FREQUENCY.AS_THEY_HAPPEN) {
      const prevNotification = await Notification.findOne({
        where: {
          userId: subscription.user.id,
          key: {[Op.startsWith]: 'New Award Match'},
          created: {[Op.gte]: prevNotifiTime}
        },
        orderBy: {
          created: 'desc',
        }
      })
      if (prevNotification) {
        continue
      }
    }
    const newMatches = await Match.findAll({
      where: {
        subscriptionId: subscription.id,
        bookId: subscription.book.id,
        reason: 'cupid-match',
        created: {
          [Op.gte]: prevNotifiTime,
        }
      },
      include: [Award],
    })
    if (!newMatches.length) {
      continue
    }
    try {
      if (!config.dryrun) {
        await libmail.add('New Award Match', subscription.user, {
          book: subscription.book,
          subscriptionId: subscription.id,
          matches: newMatches.map(m => {
            return {
              ...m,
              name: m.award.name,
              category: m.award.category,
              dueDate: m.award.dueDate,
            }
          }),
        })
      }
      log.info(`created an email notification of ${subscription.user.email}'s ${subscription.book.title} with ${newMatches.length} matches`)
    } catch (err) {
      log.error(`failed to add an email notification of ${subscription.user.email}'s ${subscription.book.title} with ${newMatches.length} matches`)
    }
  }
  sequelize.close()
  log.info('Ended creating new match email notifications')
}

main()
