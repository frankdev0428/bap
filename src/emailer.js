
const date = require('date-fns')
const {Op} = require('sequelize')

// process-level state of mailer jobs
const MAILER = {
  checking: false,
}

module.exports = ({log, sequelize}) => {
  const {User, Notification, Partner, ...model} = require('@bap/cotton/model')(sequelize)
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})

  function bcc(...partners) {
    return partners.map(p => {
      return p.bcc ? p.emails?.support : null
    }).filter(i => i).join(',')
  }

  async function check() {
    if (MAILER.checking) {
      log.warn('waiting for prior emailer run to finish')
      return
    }
    try {
      MAILER.checking = true
      log.debug('checking for unsent notifications')
      const root = await model.settingsForUser(1)
      const unsent = await Notification.findAll({
        where: {processed: {[Op.is]: null}},
        include: [User],
      })
      for (const msg of unsent) {
        try {
          if (msg.level >= msg.user.verbosity) {
            log.info({id: String(msg.id)}, 'sending notification:', msg.user.email, ':', msg.subject)
            let settings = null
            if (msg.settingsId) {
              settings = await Partner.findByPk(msg.settingsId)
            } else {
              settings = await model.settingsForUser(msg.user.id)
            }
            settings.bcc = msg.internal ? '' : bcc(root, settings)
            settings.plain = msg.plain
            await libmail.send(msg.user.email, msg.subject, msg.body, settings)
          }
        } catch (err) {
          log.error(err, 'unable to process notification')
        }
        // TODO: try to close the gap twix sending & here
        // marked as processed even if there was an error (see peggy#226)
        msg.processed = new Date()
        await msg.save()
      }
    } catch (err) {
      log.error(err, 'unhandled error')
    } finally {
      MAILER.checking = false // eslint-disable-line require-atomic-updates
    }
  }

  async function gc() {
    log.debug('garbage collecting old notifications')
    const old = await Notification.findAll({
      where: {processed: {[Op.not]: null}},
    })
    const now = new Date()
    for (const msg of old) {
      if (msg.processed < date.sub(now, {seconds: msg.ttl})) {
        try {
          await msg.destroy()
          log.info({id: String(msg.id)}, 'notification deleted:', msg.subject)
        } catch (err) {
          log.error(err, 'unable to gc notification')
        }
      }
    }
  }

  if (!process.env.MAILER_DISABLED && !MAILER.intervals) {
    check()
    gc()
    MAILER.intervals = {
      check: setInterval(check, 60 * 1000),
      gc: setInterval(gc, 600 * 1000),
    }
  }

  return {}
}
