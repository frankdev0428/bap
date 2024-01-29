#! /usr/bin/env node

const USAGE = `
Update MailChimp members' tags.

Usage: COMMAND [options]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: warn]
  -n, --dry-run
    Only print updating MailChimp members' tags
`

const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
}

const crypto = require('crypto')

const axios = require('axios').create({
  validateStatus: null,
  maxContentLength: 99999,
  poll: {
    maxSockets: 500,
  },
  timeout: 5000,
})

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
})

const {Sequelize, Op} = require('sequelize')
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
const {User, Subscription, Product} = model

const TAGS = {
  FREE: 'App - Plan - Free',
  ESSENTIALS: 'App - Plan - Essentials',
  PLUS: 'App - Plan - Plus',
  PRO: 'App - Plan - Pro',
}

const PLANS = {
  FREE: 'Free Plan',
  ESSENTIALS: 'Essentials Plan',
  PLUS: 'Plus Plan',
  PRO: 'Pro Plan',
}

const DELAY_TIME = 3000

const sleep = ms => {
  // eslint-disable-next-line no-promise-executor-return
  return new Promise(resolve => setTimeout(resolve, ms))
}

const updateTags = async (email, tags) => {
  const emailHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex')
  const r = await axios.post(`https://us20.api.mailchimp.com/3.0/lists/18883ab54d/members/${emailHash}/tags`, {
    tags
  }, {
    auth: {
      username: 'bap',
      password: process.env.MAILCHIMP_KEY,
    },
  })
  if (r.status >= 300) {
    throw new Error([r.data.title, r.data.detail, r.data.message].filter(i => i).join(' : '))
  }
  return r.data
}

const main = async () => {
  log.info('Started adding tags')
  const users = await User.findAll({
    attributes: ['id', 'email'],
  })
  for (const user of users) {
    const subscriptions = await Subscription.findAll({
      where: {
        userId: user.id,
        status: {[Op.not]: ['canceled', 'expired']},
        tombstoned: {[Op.is]: null},
        stripeId: {[Op.not]: null},
      },
      include: [
        {model: User},
        {model: Product},
      ]
    })
    if (!subscriptions) {
      continue
    }
    const tagsMap = {}
    for (const subscription of subscriptions) {
      if (subscription.product.name === PLANS.FREE) {
        tagsMap.FREE = true
      } else if (subscription.product.name === PLANS.ESSENTIALS) {
        tagsMap.ESSENTIALS = true
      } else if (subscription.product.name === PLANS.PLUS) {
        tagsMap.PLUS = true
      } else if (subscription.product.name === PLANS.PRO) {
        tagsMap.PRO = true
      }
    }
    const tags = Object.keys(tagsMap).map(key => ({name: TAGS[key], status: 'active'}))
    if (!tags.length) {
      continue
    }
    try {
      if (!config.dryrun) {
        await updateTags(user.email, tags)
        await sleep(DELAY_TIME)
      }
      log.info('succeed to add tags of ', user.email, tags)
    } catch (err) {
      log.error(err, 'failed to update Mailchimp member tags of', user.email)
    }
  }
  log.info('Ended adding tags')
}

main()
