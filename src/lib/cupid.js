
const date = require('date-fns')
const path = require('path')
const util = require('util')
const cp = require('child_process')
const execFile = util.promisify(cp.execFile)
const {randitem} = require('.')

const HOME = path.dirname(__dirname)

module.exports = ({log, sequelize, TODAY}) => { // eslint-disable-line no-unused-vars
  // const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const {MatchState} = require('@bap/cotton/model')(sequelize)

  function shouldMatch(subscription, prior, mode) {
    // we always want that first primed set of matches (see peggy#293)
    if (!prior) {
      return 'first match'
    }
    if (mode === 'none') {
      return false
    }
    if (mode === 'force') {
      return 'forced'
    }
    if (!subscription.product.features.includes('match')) {
      return false
    }
    const days = date.differenceInDays(TODAY || new Date(), prior.created)
    const gap = randitem([1, 1, 1, 1, 2, 2, 3]) // shooting for 3-4 times per week (see peggy#265)
    if (days >= gap) {
      return 'enough time'
    }
    log.debug({days, gap, id: String(subscription.id)}, 'needs more time since last match:', prior.created.getDate())
    return false
  }

  function shouldTarget(subscription, prior, mode) {
    if (mode === 'none') {
      return false
    }
    if (mode === 'force-target' || mode === 'force-submit') {
      return mode
    }
    if (!subscription.product.features.includes('target')) {
      return false
    }
    if (!prior) {
      return 'first target'
    }
    if (prior.targeted >= subscription.renewed) {
      // avoid duplicate renewal targets
      return false
    }
    if (mode === 'webhook') {
      // this mode is used to reduce latency twix renewal & new service,
      // minimizes windows for shenanigans such as:
      // 1. service renewed
      // 2. user switches plans
      // 3. we target
      return 'webhook renewal'
    }
    if (date.differenceInMinutes(TODAY || new Date(), subscription.renewed) >= 33) {
      // choosing tens of minutes to avoid race condition with two cupid
      // processes trying to start a new target: one from the webhook and one
      // from the hourly job
      return 'scheduled renewal'
    }
    return false
  }

  async function run(subscriptionId, opts = {}) {
    const args = [
      '-r', 'dotenv/config',
      './bin/cupid.js',
      '-v', 'info',
    ]
    if (opts.matching) {
      args.push('--matching')
      args.push(opts.matching)
    }
    if (opts.targeting) {
      args.push('--targeting')
      args.push(opts.targeting)
    }
    args.push(subscriptionId)
    return await execFile('node', args, {cwd: HOME})
  }

  async function presentTargetToUser(target) {
    // NOTE: assumes the following relationships included:
    //   Book,
    //   Award,
    //   {model: Subscription, include: [User, Product]},
    target.status = 'targeted'
    target.managed = true
    target.targeting = 'complete'
    if (target.submitBy) {
      target.targeting = 'presented'
      target.submitBy = date.addDays(TODAY || new Date(), 4)
    }
    await target.save()
    await MatchState.create({
      matchId: target.id,
      name: 'targeted',
    })
    // Commented out for enabling in the future
    // await libmail.add('Targeting Complete', target.subscription.user, {
    //   target,
    // })
  }

  return {
    // onNewTargetDay,
    presentTargetToUser,
    run,
    shouldMatch,
    shouldTarget,
  }
}
