
const _ = require('lodash')
const {Op} = require('sequelize')
const date = require('date-fns')

module.exports = ({log, sequelize}) => {

  const {Match, MatchState, Award, ...model} = require('@bap/cotton/model')(sequelize)
  const libstripe = require('@bap/cotton/lib/stripe')({log, sequelize})
  const {targetable} = require('@bap/cotton/lib/awards')({log, sequelize})

  function author(obj) {
    if (!obj) {
      return null
    }
    const data = obj.toJSON()
    if (data.photo) {
      data.photo = data.photo.replace(/^.*digitaloceanspaces.com/u, '/assets')
    }
    return data
  }

  function award(obj, {isAM = false} = {}) {
    const data = _.pick(obj, ['id', 'name', 'category', 'allowsDigital', 'fee', 'currency', 'dueDate', 'resultsDate', 'website', 'description', 'restrictions', 'sponsor'])
    if (isAM) {
      data.bapFee = obj.bapFee
    }
    data.targetable = targetable(obj, {isAM})
    return data
  }

  function book(obj) {
    const data = obj.toJSON()
    if (data.cover) {
      data.cover = data.cover.replace(/^.*digitaloceanspaces.com/u, '/assets')
    }
    if (obj.pubDate) {
      // cuz javascript wants to render based on user timezone
      // picking a time that should make sense for most users
      data.pubDate += 'T12:00:00Z'
    }
    if (obj.subscriptions) {
      if (obj.subscriptions.length === 1) {
        data.subscription = obj.subscriptions[0]
      } else {
        // choose "best" one: active, newest
        const active = obj.subscriptions.filter(i => i.status === 'active')
        if (active.length > 1) {
          data.subscription = _.last(_.sortBy(active, 'created'))
        } else {
          data.subscription = active[0]
        }
      }
    }
    data.isInUse = data.subscription?.enabled || data.subscription?.status === 'unpaid'
    return data
  }

  async function getProduct(userId, id) {
    // NOTE: this might need some optimization (eg memoization) love some day
    const xxx = await model.settingsForUser(userId)
    return Object.values(xxx.products).find(i => i.id === id)
  }

  function landscapeCandidate(obj, {isAM = false} = {}) {
    const candidate = _.pick(obj, ['id', 'name', 'category', 'allowsDigital', 'fee', 'currency', 'dueDate', 'resultsDate', 'website', 'description', 'restrictions', 'sponsor', 'score'])
    if (isAM) {
      candidate.bapFee = obj.bapFee
    }
    candidate.targetable = targetable(obj, {isAM})
    return candidate
  }

  function match(match, {isAM = false} = {}) { // eslint-disable-line no-shadow
    let freebie = match.subscription.product.features.includes('free')
    const states = {}
    _.each(match.match_states, state => {
      const managed = match.subscription.userId !== state.userId
      if (managed) {
        freebie = false
      }
      states[state.name] = {
        managed,
        name: state.name,
        ts: state.created,
        user: state.user?.email,
      }
    })
    states.created = {
      name: 'created',
      ts: match.created,
      managed: true,
    }
    states.candidate = {
      name: 'candidate',
      ts: match.targeted,
      managed: true,
    }
    let status = match.status
    if (match.targeting === 'rejected' && match.status === 'targeted') {
      // could be marked as won or submitted by the user
      status = 'rejected'
    }
    return {
      states,
      status,
      freebie,
      boostable: match.boostable() && match.award.boostable(), // don't let this get in the way: match.book.boostable(),
      prepareBy: match.prepareBy(),
      id: match.id,
      userId: match.userId,
      subscriptionId: match.subscriptionId,
      award: award(match.award, {isAM}),
      book: match.book,
      managed: match.managed,
      targeting: match.targeting,
      reason: match.reason,
      score: match.score,
    }
  }

  function target(match) { // eslint-disable-line no-shadow
    const states = {}
    _.each(match.match_states, state => {
      states[state.name] = {
        name: state.name,
        ts: state.created,
        user: state.user?.email,
        managed: match.subscription.userId !== state.userId,
      }
    })
    states.created = {
      name: 'created',
      ts: match.created,
      managed: true,
    }
    // no longer needed but keeping just in case
    // states.candidate = {
    //   name: 'candidate',
    //   ts: match.targeted,
    //   managed: true,
    // }
    // if (match.boost) {
    //   states.boosted = {
    //     name: 'boosted',
    //     ts: match.boost.created,
    //     managed: true,
    //   }
    // }
    return {
      states,
      retargetable: match.targeting !== 'rejected' && !['submitted', 'won'].includes(match.status),
      submittable: match.submitBy != null,
      boostable: match.boostable() && match.award.boostable(), // don't let this get in the way: match.book.boostable(),
      targetBy: match.targetBy(),
      prepareBy: match.prepareBy(),
      id: match.id,
      subscriptionId: match.subscriptionId,
      award: award(match.award),
      book: match.book,
      boost: match.boost,
      managed: match.managed,
      status: match.status,
      targeting: match.targeting,
      reason: match.reason,
      score: match.score,
    }
  }

  // https://stripe.com/docs/api/payment_methods
  async function card(obj, {checkIsDefault = true} = {}) {
    if (!obj) {
      return null
    }
    const data = {
      id: obj.id,
      brand: obj.card.brand,
      last4: obj.card.last4,
      expires: {
        year: obj.card.exp_year,
        month: obj.card.exp_month,
      },
      billing: {
        name: obj.billing_details.name,
      },
    }
    if (checkIsDefault) {
      const defcard = await libstripe.defaultCard(obj.customer)
      data.isDefault = defcard ? obj.id === defcard.id : false
    }
    return data
  }

  // https://stripe.com/docs/api/prices/object
  function product(price, filters) {
    if (filters?.type) {
      if (price.product.metadata.type !== filters.type) {
        return false
      }
    }
    return {
      id: price.id,
      amount: price.unit_amount,
      name: price.product.name,
      type: price.product.metadata.type,
      recurring: price.type === 'recurring',
      interval: price.recurring.interval,
    }
  }

  function affiliate(obj) {
    return _.pick(obj, ['id', 'url', 'code', 'userId'])
  }

  function referral(obj) {
    return _.pick(obj, ['id', 'status', 'subscriptionId', 'userId', 'initialSubPayment', 'latestSubPayment'])
  }

  // https://stripe.com/docs/api/subscriptions
  async function subscription(obj) {
    const features = {
      free: obj.product.features.includes('free'),
      match: obj.product.features.includes('match'),
      target: obj.product.features.includes('target'),
      submit: obj.product.features.includes('submit'),
    }
    const numMatches = await Match.count({
      where: {
        subscriptionId: obj.id,
        targeting: {[Op.or]: [
          {[Op.is]: null},
          {[Op.not]: 'candidate'},
        ]},
        created: {[Op.gt]: date.subDays(new Date(), 60)},
      },
      include: [
        {model: Award, where: {
          dueDate: {[Op.or]: [
            {[Op.is]: null}, // including awards with no due date for now
            {[Op.gt]: date.subDays(new Date(), 10)},
          ]},
        }},
      ],
    })
    const status = {
      overall: obj.status,
      match: {
        enabled: features.match,
        count: numMatches,
      },
      target: {
        enabled: features.target,
      },
      submit: {
        enabled: features.submit,
      },
    }

    // if there are multiple targets, pick the one that is:
    // a) newest according to status, or if all the same then
    // b) newest by targeted timestamp
    const target = await Match.findOne({ // eslint-disable-line no-shadow
      where: {
        subscriptionId: obj.id,
        targeted: {[Op.not]: null},
        targeting: {[Op.not]: 'rejected'},
        reason: {[Op.not]: 'extra-target'},
      },
      include: [MatchState],
      order: [
        // taking advantage of postgres ENUM's having non-alpha order
        // have to sort by targeting first since targeting=candidate has status=null
        ['targeting', 'ASC'],
        ['status', 'ASC'],
        ['targeted', 'DESC'],
      ],
      limit: 1,
    })
    if (target) {
      if (target.boostId) {
        // helps use more approprriate verbiage in the app
        status.target.boosted = true
        status.submit.boosted = true
      }
      // calculate timestamps for the customer perspective (eg "targeted" is when presented)
      status.target.eta = target.targetBy()
      status.submit.eta = target.prepareBy()
      const targetedOn = target.match_states.find(i => i.name === 'targeted')?.created
      if (targetedOn) {
        status.target.done = targetedOn
      }
      const submittedOn = target.match_states.find(i => i.name === 'submitted')?.created
      if (submittedOn) {
        status.submit.done = submittedOn
      }
    }

    const product = await getProduct(obj.userId, obj.product.id) // eslint-disable-line no-shadow
    return {
      status,
      features,
      id: obj.id,
      userId: obj.userId,
      book: obj.book,
      stripeId: obj.stripeId,
      // better to let name & price be empty than to fail completely
      name: product?.name,
      realPlanName: obj.product.name,
      price: product?.price?.toString(),
      recurs: obj.product.recurs,
      months: obj.product.months,
      enabled: obj.enabled,
      card: obj.cardId ? await card(await libstripe.getCard(obj.cardId), {checkIsDefault: false}) : null,
      renews: obj.renews,
      renewed: obj.renewed,
      end: obj.end,
      boostable: Boolean(obj.bookId), // don't let this get in the way: obj.book?.boostable(),
    }
  }

  function subacct(obj) {
    return {
      id: obj.id,
      enabled: !obj.tombstoned,
      email: obj.email,
      avatar: obj.avatar,
      verbosity: obj.verbosity,
      fullname: obj.fullname,
      nickname: obj.nickname,
      lastActive: obj.lastActive,
      created: obj.created,
      isPartner: obj.isPartner,
      isAM: obj.isAM(),
    }
  }

  async function request(obj) { /* eslint-disable no-shadow */
    const product = _.pick(await getProduct(obj.userId, obj.product.id), ['id', 'code', 'kind', 'name', 'price'])
    const requestor = _.pick(await obj.getRequestor(), ['id', 'email', 'fullname', 'avatar'])
    let subscription = null
    let book = null
    let bookId = obj.data.book
    if (obj.data.subscription) {
      subscription = (await model.Subscription.findByPk(obj.data.subscription, {
        attributes: ['id', 'userId', 'productId', 'bookId', 'status'],
      })).toJSON()
      subscription.product = _.pick(getProduct(subscription.userId, subscription.productId), ['code', 'name'])
      bookId = subscription.bookId
    }
    if (bookId) {
      book = await model.Book.findByPk(bookId, {
        attributes: ['id', 'title', 'cover', 'thumbnail'],
        include: [{model: model.Author, attributes: ['id', 'fullname']}],
      })
      if (book) {
        book = book.toJSON()
      }
    }
    let status = 'Pending'
    let ts = obj.created
    if (obj.approved != null) {
      status = obj.approved ? 'Approved' : 'Denied'
      ts = obj.modified
    }
    return {
      status,
      ts,
      requestor,
      subscription,
      product,
      book,
      id: obj.id,
      userId: obj.userId,
      approved: obj.approved,
      created: obj.created,
    }
  }

  function settings(obj) {
    return _.pick(obj, ['thumbnail', 'powered', 'business', 'domain', 'theme', 'bcc', 'products', 'emails', 'urls', 'logo', 'enterprise'])
  }


  async function billing(user) {
    if (!user.stripeId) {
      return {id: user.id}
    }
    const customer = await libstripe.customer(user.stripeId, {
      expand: ['tax_ids'],
    })
    let credit = customer.balance / -100
    if (customer.balance > 0) {
      log.warn({id: customer.id}, 'stripe customer with non-negative balance:', customer.balance)
      credit = 0
    }
    return {
      credit,
      id: user.id,
      // null or {} for address causes client validation issues
      // eslint-disable-next-line no-undefined
      address: customer.address || undefined,
      taxId: _.get(customer, 'tax_ids.data[0]'),
    }
  }

  function invoiceItem(obj) {
    if (obj.status !== 'succeeded') {
      return null
    }
    return {
      id: obj.id,
      status: obj.status,
      description: obj.description,
      amount: obj.amount_received,
      created: new Date(obj.created * 1000),
    }
  }

  function announcement(obj) {
    const data = obj.toJSON()
    data.award = obj.award.name
    data.cycle = obj.award.openDate
    data.sponsor = obj.award.sponsor.name
    return data
  }

  return {
    affiliate,
    announcement,
    author,
    award,
    billing,
    book,
    card,
    invoiceItem,
    match,
    landscapeCandidate,
    target,
    product,
    referral,
    request,
    settings,
    subacct,
    subscription,
  }
}
