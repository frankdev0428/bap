#! /usr/bin/env node

/* eslint-disable no-unused-vars */

// to run locally: shut down local api, edit .env, add DO ca to trusted certs:
//
// NODE_EXTRA_CA_CERTS=ca.crt node -r dotenv/config src/bin/bogo.js MATCH_ID "Category 1" "Category 2" -n | bunyan -o short

const USAGE = `
Add extra submissions for a match.

Usage: COMMAND [options] <matchId> [<categories>...]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: info]
  -n, --dry-run
    Only report, do not insert
`
const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
  matchId: parseInt(argv['<matchId>']),
  categories: argv['<categories>'],
}

const _ = require('lodash')
const date = require('date-fns')
const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
})
const {Sequelize, QueryTypes, Op} = require('sequelize')
const sequelize = new Sequelize({
  logging: false,
  dialect: 'postgres',
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGNAME,
  username: process.env.PGUSER,
  password: process.env.PASSWORD,
})
const {User, Match, Book, Award, MatchState, ...model} = require('@bap/cotton/model')(sequelize)

async function main() {
  const match = await Match.findByPk(config.matchId, {
    include: [
      Book,
      Award,
      MatchState,
    ],
  })
  log.info({award: match.awardId}, 'match:', match.book.title, match.status, match.award.name)
  for (const category of config.categories) {
    const award = await Award.findOne({where: {
      name: match.award.name,
      sponsorId: match.award.sponsorId,
      openDate: match.award.openDate,
      category,
    }})
    log.info({award: award.id}, 'extra award:', award.category)
    if (!config.dryrun) {
      const extra = await Match.create({
        awardId: award.id,
        subscriptionId: match.subscriptionId,
        boostId: match.boostId,
        bookId: match.bookId,
        score: match.score,
        status: 'submitted',
        managed: true,
        targeting: 'complete',
        created: match.created,
        modified: match.modified,
        reason: 'am-match',
      })
      log.warn({match: extra.id}, 'added extra match')
      const states = match.match_states
      for (const state of states) {
        if (['targeted', 'submitted'].includes(state.name)) {
          const es = await MatchState.create({
            matchId: extra.id,
            name: state.name,
            created: state.created,
            modified: state.modified,
          })
          log.warn({state: es.id}, 'added state:', state.name)
        }
      }
    }
  }
  sequelize.close()
}

main()
