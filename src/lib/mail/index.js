
const _ = require('lodash')
const crypto = require('crypto')
const fs = require('fs').promises
const {Op} = require('sequelize')
const catalog = require('./catalog')
const {assetUrl} = require('@bap/cotton/lib')

const axios = require('axios').create({
  validateStatus: null,
  maxContentLength: 99999,
  poll: {
    maxSockets: 500,
  },
  timeout: 5000,
})

const POWERED = `
  <a href="https://bookawardpro.com" class="f-fallback sub align-center" style="font-size: 13px; line-height: 1.625; text-align: right; color: #A8AAAF; text-decoration: none;">
    powered by
    <br/>
    <img src="${assetUrl('/img/logos/bap.png')}" width="180" height="25" />
  </a>
`
const TAGS = {
  FREE: 'App - Plan - Free',
  ESSENTIALS: 'App - Plan - Essentials',
  PLUS: 'App - Plan - Plus',
  PRO: 'App - Plan - Pro',
}

const SERVICE_STATUS = {
  ADDING: 'ADDING',
  CANCELING: 'CANCELING',
  CHANGING: 'CHANGING',
}

const wlbody = async (text, {logo, business, powered, plain}) => { /* eslint-disable require-atomic-updates */
  if (plain) {
    return text
  }
  if (!wlbody.html) {
    wlbody.html = (await fs.readFile('src/templates/email.html')).toString()
  }
  if (!wlbody.css) {
    wlbody.css = (await fs.readFile('src/templates/email.css')).toString()
  }

  return wlbody.html.replace('{{CSS}}', wlbody.css).
    replace('{{BODY}}', text).
    replace('{{LOGO}}', assetUrl(logo)).
    replace('{{POWERED}}', powered ? POWERED : '').
    replace('{{BUSINESS}}', business)
}

const postmark = _.memoize(key => {
  const {ServerClient} = require('postmark')
  return new ServerClient(key)
})

async function send(to, subject, text, settings) {
  const key = process.env[`POSTMARK_KEY${settings.id}`]
  const client = await postmark(key || process.env.POSTMARK_KEY)
  let from = 'notifications@awardmatch.com'
  if (key && settings.emails?.support) {
    from = settings.emails.support
  }
  if (subject.match(/^\[(Submit|Target)\]/u)) {
    // support AM's getting what they need until we can turn off bcc
    to = 'award-masters@bookawardpro.com' // eslint-disable-line no-param-reassign
  } else if (subject.match(/(New Award Match|Awards Setup Needed)/u)) {
    // exclude these from Bcc - NOTE: this affects all partners
    settings.bcc = ''
  }
  const payload = {
    From: `${settings.business} <${from}>`,
    ReplyTo: `${settings.business} <${settings.emails.support}>`,
    To: process.env.MAIL_SHUNT || to,
    Bcc: process.env.MAIL_SHUNT ? '' : settings.bcc,
    Subject: subject,
    MessageStream: 'outbound',
  }
  payload[settings.plain ? 'TextBody' : 'HtmlBody'] = await wlbody(text, settings)
  return await client.sendEmail(payload)
}

module.exports = ({sequelize}) => {
  const {Notification, ...model} = require('@bap/cotton/model')(sequelize)

  async function add(name, user, idata = {}) {
    const event = catalog[name]
    if (!event) {
      throw new Error(`notification type not in catalog: ${name}`)
    }
    const data = {
      ...idata,
      user,
    }
    // use the settings for the customer instead of the user being delivered to
    data.settings = await model.settingsForUser(event.customerId ? event.customerId(data) : user.id)
    data.url = event.url(data)
    const key = event.key(data)

    const existing = await Notification.count({
      where: {
        key,
        userId: user.id,
      }
    })
    if (existing) {
      return false
    }
    const subject = event.subject(data)
    const body = await event.body(data)
    await Notification.create({
      key, subject, body,
      userId: user.id,
      partnerId: data.settings.id,
      internal: Boolean(event.isInternal),
      level: event.level,
      ttl: event.ttl,
      url: data.url,
      plain: event.plain,
    })
    return true
  }

  async function test(name, idata) {
    const event = catalog[name]
    const data = {
      ...idata,
      settings: {
        id: 2,
        business: 'BAP Gun',
        domain: 'test.bookawardpro.com',
        emails: {
          support: 'nerds@bookawardpro.com',
        },
        bcc: '',
        powered: 1,
        theme: {
          primary: '#42b3ff',
        },
        logo: assetUrl('/img/logos/bap.png'),
        plain: event.plain,
      },
      user: {
        fullname: 'Test Client',
        nickname: 'tester',
        email: 'test@bookawardpro.com',
      },
    }
    data.url = event.url(data)
    await send(process.env.MAIL_SHUNT, event.subject(data), await event.body(data), data.settings)
  }

  // API Reference: https://mailchimp.com/developer/marketing/api/list-members/
  async function subscribe(user) {
    const subscriberHash = crypto.createHash('md5').update(user.email.toLowerCase()).digest("hex")
    const r = await axios.put(`https://us20.api.mailchimp.com/3.0/lists/18883ab54d/members/${subscriberHash}`, {/* eslint-disable camelcase */
      email_address: user.email,
      status_if_new: 'subscribed',
      merge_fields: {
        FNAME: user.nickname,
        APPNEWSLTR: user.id,
        AFFILIATE: user.affiliate,
      },
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

  async function unsubscribe(user) {
    const r = await axios.delete(`https://us20.api.mailchimp.com/3.0/lists/18883ab54d/members/${user.email}`, {
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

  async function changeSubscriber(oldEmail, newEmail) {
    const oldEmailHash = crypto.createHash('md5').update(oldEmail.toLowerCase()).digest("hex")
    const r = await axios.patch(`https://us20.api.mailchimp.com/3.0/lists/18883ab54d/members/${oldEmailHash}`, {
      email_address: newEmail
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

  const extractPlan = planName => planName.split(' ')[0].toUpperCase()

  async function checkService(userId, productId) {
    const subscription = await model.Subscription.findOne({
      where: {
        userId,
        productId,
        status: {[Op.not]: ['canceled', 'expired']},
        tombstoned: {[Op.is]: null},
      }
    })
    return subscription
  }

  // eslint-disable-next-line max-params
  async function updateTags(serviceStatus, {email, userId, oldProductId = null, newProductId = null}) {
    const tags = []
    const oldProduct = await model.Product.findByPk(oldProductId)
    const newProduct = await model.Product.findByPk(newProductId)

    if (serviceStatus === SERVICE_STATUS.CHANGING || serviceStatus === SERVICE_STATUS.CANCELING) {
      if (!await checkService(userId, oldProductId)) {
        tags.push({name: TAGS[extractPlan(oldProduct.name)], status: 'inactive'})
      }
    }
    if (serviceStatus === SERVICE_STATUS.CHANGING || serviceStatus === SERVICE_STATUS.ADDING) {
      if (await checkService(userId, newProductId)) {
        tags.push({name: TAGS[extractPlan(newProduct.name)], status: 'active'})
      }
    }
    if (!tags.length) {
      return true
    }
    const emailHash = crypto.createHash('md5').update(email.toLowerCase()).digest("hex")
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

  return {
    catalog,
    SERVICE_STATUS,
    send,
    add,
    test,
    subscribe,
    unsubscribe,
    changeSubscriber,
    updateTags,
  }
}
