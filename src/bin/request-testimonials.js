#! /usr/bin/env node

const USAGE = `
Match up books to awards and Target as needed.

Usage: COMMAND [options]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: warn]
  -n, --dry-run
    Only print the requests that would be made
  -d, --day NUM
    How many days since won [default: 3]
`

const date = require('date-fns')
const {Sequelize, Op} = require('sequelize')

const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
  day: date.subDays(date.startOfDay(new Date()), parseInt(argv['--day'])),
}

const bunyan = require('bunyan')
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
const model = require('@bap/cotton/model')(sequelize)
const {User, Testimonial, Match, MatchState, Subscription} = model
const libmail = require('@bap/cotton/lib/mail')({log, sequelize})

async function main() {
  // NOTE: it's ok to ask Plus customers that submitted on their own for a testimonial
  const winners = await Match.findAll({
    where: {
      managed: true,
      status: 'won',
    },
    include: [
      model.Book,
      {
        model: MatchState,
        where: {
          created: {[Op.between]: [config.day, date.addDays(config.day, 1)]},
        },
      },
      {
        model: Subscription,
        include: [
          {
            model: User,
            include: [Testimonial],
          }
        ],
      },
    ],
  })
  for (const match of winners) {
    const user = match.subscription.user
    const partner = await model.settingsForUser(user.id)
    if (partner.enterprise) {
      continue
    }
    let testimonial = user.testimonial
    if (testimonial) {
      if (testimonial.response) {
        log.info({id: String(user.id)}, 'customer already testified')
        continue
      }
      if (testimonial.attempt > 2) {
        log.info({id: String(user.id)}, 'request limit reached')
        continue
      }
      if (testimonial.created > date.subDays(new Date(), 30)) {
        log.info({id: String(user.id)}, 'need more time before next request')
        continue
      }
      testimonial.attempt += 1
      testimonial.set('created', new Date(), {raw: true})
      testimonial.changed('created', true)
    } else if (config.dryrun) {
      testimonial = {id: -1, userId: user.id, attempt: 1}
    } else {
      testimonial = await Testimonial.create({
        userId: user.id,
        attempt: 1,
      })
    }
    if (config.dryrun) {
      log.warn({id: String(user.id)}, 'user ready for a testimonial request:', user.email)
    } else {
      await libmail.add('Testimonial Request', user, {
        testimonial,
        book: match.book,
      })
      log.warn({id: String(user.id)}, 'request for testimonial sent:', user.email)
      await testimonial.save()
    }
  }
  sequelize.close()
}

main()
