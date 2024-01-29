#! /usr/bin/env node

const USAGE = `
Settle pending referrals to pay affiliate commissions.

Usage: COMMAND [options]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: info]
  -n, --dry-run
    Only report, do not pay referrals.
`
const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
}

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
})
const date = require('date-fns')
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
const {User, Subscription, Affiliate, Referral} = model
const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
const {payout} = require('@bap/cotton/lib/affiliate')({log, sequelize})

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  maxNetworkRetries: 3,
})

async function main() {
  // TODO: use unpayable()?
  const referrals = await Referral.findAll({
    where: {
      processed: {[Op.is]: null},
    },
    include: [
      {
        model: Affiliate,
        include: [User],
      },
      {
        model: Subscription,
        where: {
          enabled: true,
          created: {[Op.lt]: date.subDays(new Date(), 31)},
          renews: {[Op.gt]: sequelize.literal("subscription.created + '31 days'")},
        },
      },
    ],
  })
  const payouts = {}
  for (const referral of referrals) {
    const aff = referral.affiliate
    const id = referral.subscriptionId
    const dollars = payout(aff, referral)
    let failed = false
    if (aff.method === 'credit' && referral.paid > 0) {
      if (!config.dryrun) {
        try {
          await stripe.customers.createBalanceTransaction(aff.user.stripeId, {
            amount: -100 * dollars,
            currency: 'USD',
            description: `referral credit for subscription: ${id}`,
          })
        } catch (err) {
          log.error(err, 'failed to pay referral:', referral.id)
          failed = true
        }
      }
    }
    if (!failed) {
      if (referral.paid > 0) {
        if (!payouts[aff.id]) {
          payouts[aff.id] = {
            method: aff.method,
            email: aff.user.email,
            name: aff.user.fullname,
            stripeId: aff.user.stripeId,
            total: 0,
            count: 0,
          }
        }
        payouts[aff.id].total += dollars
        payouts[aff.id].count += 1
      }
      if (!config.dryrun) {
        referral.earned = dollars
        referral.processed = new Date()
        await referral.save()
        log.warn({id}, 'settled referral:', referral.id, aff.method, dollars)
      }
    }
  }
  const l = Object.values(payouts)
  if (config.dryrun) {
    for (const i of l) {
      log.info(i, 'would pay')
    }
  } else if (l.length > 0) {
    const paypal = l.filter(i => i.method === 'paypal')
    const credits = l.filter(i => i.method === 'credit')
    await libmail.add('Referral Payouts', await User.findByPk(2), { // TODO: don't hard-code to BAP partner user id
      paypal,
      credits,
    })
  } else {
    log.warn('no referrals to settle')
  }
  sequelize.close()
}

main()
