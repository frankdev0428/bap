
// const _ = require('lodash')
// const fs = require('fs').promises
const date = require('date-fns')
const {Op} = require('sequelize')
const os = require('os')

// TODO: a better way to work a job queue?
// https://spin.atomicobject.com/2021/02/04/redis-postgresql/

// process-level state of task jobs
const TASKER = {
  worker: os.hostname().split('.').shift(),
  checking: false,
}

module.exports = ({log, sequelize, s3}) => {
  const model = require('@bap/cotton/model')(sequelize)
  const {Task} = model
  const asset = require('@bap/cotton/s3')({log, sequelize, s3})
  const libtask = require('@bap/cotton/lib/task')({log, sequelize})
  const triggers = require('@bap/cotton/lib/task/triggers')({log, sequelize})

  async function check() {
    if (TASKER.checking) {
      log.warn('waiting for prior tasker run to finish')
      return
    }
    try {
      TASKER.checking = true
      log.debug('checking for unprocessed tasks')
      const undone = await Task.findAll({
        where: {
          processed: {[Op.is]: null},
        },
        order: [['created', 'ASC']],
      })
      // running in series intentionally to help avoid out-of-order processing
      for (const task of undone) {
        try {
          const seconds = (new Date() - task.modified) / 1000
          if (task.worker && task.timeout > seconds) {
            continue
          }
          if (task.worker) {
            log.warn({id: String(task.id)}, 'considering worker dead:', task.worker, task.key)
          }
          // TODO: need a fresher check here to avoid race condition with other workers
          task.worker = TASKER.worker
          await task.save()
          log.info({id: String(task.id), retries: task.retries}, 'processing task:', task.key)
          task.results = await libtask.run({task, log, model, asset})
          task.processed = new Date()
          await task.save()
        } catch (err) {
          err.id = task.id
          log.error(err, 'unable to process task:', task.key)
          const spec = libtask.spec(task.name)
          if (task.retries < spec.retries) {
            // leaving worker as-is so that timeout can act as a throttle
            task.retries += 1
          } else {
            task.results = {
              failed: `retry limit reached: ${task.retries}`,
              msg: err.toString(),
            }
            task.changed('results', true)
            task.processed = new Date()
          }
          await task.save()
        }
      }
    } catch (err) {
      log.error(err, 'unhandled error')
    } finally {
      TASKER.checking = false // eslint-disable-line require-atomic-updates
    }
  }

  async function trigger() {
    const today = new Date()
    if (today.getDate() === 1) { // the 1st of the month
      if (today.getMonth() % 6 === 5) { // Jun, Dec
        await triggers.bookUpdateReminders()
      }
    }
    await triggers.handleNonStripeSubscriptions()
    await triggers.publishedBooks()
    await triggers.unconfiguredSubscriptions()
    await triggers.expiringSubscriptions()
    await triggers.pendingRequests()
    await triggers.sanityChecks()
    await triggers.cleanupStripe()
    await triggers.howDidYouHear()
  }

  async function gc() {
    log.info('garbage collecting old tasks')
    const old = await Task.findAll({
      where: {processed: {[Op.not]: null}},
    })
    const now = new Date()
    for (const task of old) {
      if (task.processed < date.sub(now, {seconds: task.ttl})) {
        try {
          await task.destroy()
          log.info({id: String(task.id)}, 'task deleted:', task.key)
        } catch (err) {
          log.error(err, 'unable to gc task')
        }
      }
    }
    // reserving this until we really need it:
    // log.info({customers: libstripe.customer.cache.size, cards: libstripe.defaultCard.cache.size}, 'clearing stripe caches')
    // libstripe.customer.cache.clear()
    // libstripe.defaultCard.cache.clear()
  }

  if (!process.env.TASKER_DISABLED && !TASKER.intervals) {
    trigger()
    check()
    gc()
    TASKER.intervals = {
      check: setInterval(check, 60 * 1000),
      trigger: setInterval(trigger, 3600 * 1000),
      gc: setInterval(gc, 600 * 1000),
    }
  }

  return {}
}
