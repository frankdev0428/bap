
const _ = require('lodash')
const date = require('date-fns')
const {randomInt} = require('crypto')
const {readPdfText} = require('pdf-text-reader')
const ISBN = require('isbn3')

// use `middleware` unless route is one of `paths`
// consider https://www.npmjs.com/package/express-unless
function unless(middleware, ...paths) {
  return function(req, res, next) {
    // console.log('AUTH:', req.path, paths)
    if (paths.some(path => path === req.path)) {
      return next()
    }
    return middleware(req, res, next)
  }
}

const xmarkdown2html = _.memoize(async () => {
  const {unified} = await import('unified')
  const {default: parser} = await import('remark-parse')
  const {default: gfm} = await import('remark-gfm')
  const {default: rehype} = await import('remark-rehype')
  const {default: document} = await import('rehype-document')
  const {default: format} = await import('rehype-format')
  const {default: stringify} = await import('rehype-stringify')
  const x = await unified()
  return x.use(parser).use(gfm).use(rehype).use(document).use(format).use(stringify)
})

async function markdown2html(text) {
  const x = await xmarkdown2html(text)
  return await x.process(text)
}

function assetUrl(url) { /* eslint-disable no-param-reassign */
  if (!url) {
    // if this fails, email could have a bad time
    return 'https://app.bookawardpro.com/assets/img/pixel.png'
  }
  if (url.startsWith('/')) {
    if (!url.startsWith('/assets')) {
      url = `/assets${url}`
    }
    if (process.env.NODE_ENV === 'development') {
      url = `http://localhost:3000${url}`
    } else if (process.env.NODE_ENV === 'test') {
      url = `https://test.awardmatch.com${url}`
    } else {
      url = `https://app.bookawardpro.com${url}`
    }
  }
  return url
}

function strftime(d, format, {or = 'Open', dateonly = false} = {}) { /* eslint-disable no-param-reassign */
  if (!d) {
    return or
  }
  if (typeof d === 'string') {
    d = new Date(d)
  }
  if (dateonly) {
    d = new Date(d.valueOf() + (60 * d.getTimezoneOffset() * 1000))
  }
  if (typeof format === 'string') {
    return date.format(d, format)
  }
  // support date addition as well
  if (format.add) {
    d = date.add(d, format.add) // eslint-disable-line no-param-reassign
    delete format.add
  }
  // assume an object for relative formatting
  if (format.other) {
    const other = format.other
    delete format.other
    return date.formatDistanceStrict(d, other, format)
  }
  return date.formatDistanceToNowStrict(d, format)
}

function randitem(l) {
  return l[randomInt(l.length)]
}

function DateOnly(d) {
  if (typeof d === 'string') {
    d = new Date(d) // eslint-disable-line no-param-reassign
  }
  return new Date(d.valueOf() + d.getTimezoneOffset() * 60 * 1000) // eslint-disable-line no-mixed-operators
}

const extractISBNFromText = text => text.match(/((978[--– ])?[0-9][0-9\--– ]{10}[--– ][0-9xX])|((978)?[0-9]{9}[0-9Xx])/gmu)

const isValidISBN = isbn => ISBN.audit(isbn).validIsbn

async function extractISBNFromPdf(filePath) {
  try {
    const pages = await readPdfText(filePath)
    if (!pages) {
      return null
    }
    for (let i = 0; i < pages.length && i < 10; i++) {
      for (const line of pages[i]?.lines) {
        let isbns = extractISBNFromText(line)
        if (!isbns) {
          continue
        }
        if (!Array.isArray(isbns)) {
          isbns = [isbns]
        }
        for (const isbn of isbns) {
          if (isValidISBN(isbn)) {
            return isbn
          }
        }
      }
    }
    return null
  } catch {
    return null
  }
}

const DEFAULT_PRODUCTS = {
  'plan:submit': {
    id: 1,
    code: 'plan:submit',
    kind: 'plan',
    name: 'Pro',
    price: 199,
    features: ['match', 'target', 'submit']
  },
  'plan:target': {
    id: 2,
    code: 'plan:target',
    kind: 'plan',
    name: 'Plus',
    price: 69,
    features: ['match', 'target']
  },
  'plan:match': {
    id: 3,
    code: 'plan:match',
    kind: 'plan',
    name: 'Essentials',
    price: 15,
    features: ['match']
  },
  'plan:free': {
    id: 8,
    code: 'plan:free',
    kind: 'plan',
    name: 'Free',
    price: 0,
    features: ['free', 'match']
  },
  'boost:fast': {
    id: 4,
    code: 'boost:fast',
    kind: 'boost',
    name: 'Fast Track Boost',
    price: 999,
    features: ['match', 'target', 'submit', 'fast']
  },
  'boost:submit': {
    id: 5,
    code: 'boost:submit',
    kind: 'boost',
    name: 'Submit Boost',
    price: 199,
    features: ['match', 'target', 'submit']
  }
}

module.exports = {
  DEFAULT_PRODUCTS,
  assetUrl,
  DateOnly,
  markdown2html,
  unless,
  randitem,
  strftime,
  extractISBNFromPdf,
}
