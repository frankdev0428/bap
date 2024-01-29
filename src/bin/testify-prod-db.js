#! /usr/bin/env node

const USAGE = `
Make production records suitable for load in test env.

Usage: COMMAND [options]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: warn]
`
const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
}

// TODO: automate these as well:
//
// - alter table users drop constraint users_stripe_id_key;
// - update books set cover = regexp_replace(cover, '^/assets/', '/assets-prod/') where cover is not null;
// - update authors set photo = regexp_replace(photo, '^/assets/', '/assets-prod/') where photo is not null;

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
})

if (process.env.PGNAME.startsWith('prod')) {
  log.fatal('trying to run against a production db:', process.env.PGNAME)
  process.exit(1)
}

const {Op, Sequelize} = require('sequelize')
const sequelize = new Sequelize({
  logging(msg) {
    log.debug(msg)
  },
  dialect: 'postgres',
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGNAME,
  username: process.env.PGUSER,
  password: process.env.PASSWORD,
})
const model = require('@bap/cotton/model')(sequelize)
const {User, Partner, Product, Subscription} = model
const {randitem} = require('@bap/cotton/lib')

const CARDS = ['pm_1Lio1oADNtrRET4E53sRDVYq']

const SUBSCRIPTIONS = [
  'sub_1Lj8SqADNtrRET4EVjb4MDQi', // free
  'sub_1Lj8xXADNtrRET4Eacn5d75O', // plus
  'sub_1Lio1qADNtrRET4EHVY0Lgb1', // pro
]

const PRODUCTS = [
  {id: 1, stripeId: 'price_1Ikt1vADNtrRET4ETi7YynWU'}, // pro
  {id: 2, stripeId: 'price_1Ikt1kADNtrRET4E8yZJr1nU'}, // plus
  {id: 3, stripeId: 'price_1K4CiEADNtrRET4EOcM5xnMD'}, // essentials
  {id: 4, stripeId: 'price_1Ikt0IADNtrRET4EwIkKPflf'}, // fast-track boost
  {id: 5, stripeId: 'price_1KenI2ADNtrRET4Ef0w26iqr'}, // submit boost
  {id: 6, stripeId: 'price_1J2OBsADNtrRET4E9myTLbxs'}, // 6-month pro
  {id: 8, stripeId: 'price_1KCRiqADNtrRET4Ed3ufWxOU'}, // free
]

const PARTNERS = [
  {id: 1, domain: 'app.test.awardmatch.com'},
  {id: 2, domain: 'bap.test.awardmatch.com'},
  {id: 3, domain: 'af.test.awardmatch.com'},
  {id: 4, domain: 'booklaunchers.test.awardmatch.com'},
  {id: 5, domain: 'westwind.test.awardmatch.com'},
  {id: 6, domain: 'demo.test.awardmatch.com'},
  {id: 1001, domain: 'ams-pub.test.awardmatch.com'},
  {id: 1002, domain: 'samepage.test.awardmatch.com'},
  {id: 1003, domain: 'scribando.test.awardmatch.com'},
  {id: 1004, domain: 'archangel.test.awardmatch.com'},
  {id: 1005, domain: 'faithandfamily.test.awardmatch.com'},
  {id: 1007, domain: 'mysticquerose.test.awardmatch.com'},
  {id: 1008, domain: 'nyo.test.awardmatch.com'},
  {id: 1009, domain: 'pennypartner.test.awardmatch.com'},
  {id: 1010, domain: 'selfpubwithdale.test.awardmatch.com'},
]

async function main() {
  for (const {id, stripeId} of PRODUCTS) {
    await Product.update({stripeId}, {where: {id}})
  }

  for (const {id, domain} of PARTNERS) {
    await Partner.update({domain}, {where: {id}})
  }

  // point all bap users to a single stripe customer: erik+test-1@tfks.net
  await User.update({stripeId: 'cus_MRhQ27NwculF0T'}, {where: {stripeId: {[Op.not]: null}}})

  // assign subscriptions to a random stripe subscription & card of above customer
  const subs = await Subscription.findAll({
    where: {
      stripeId: {[Op.not]: null},
    },
  })
  for (const sub of subs) {
    sub.cardId = randitem(CARDS)
    sub.stripeId = randitem(SUBSCRIPTIONS)
    await sub.save()
  }

  sequelize.close()
}

main()
