
const _ = require('lodash')
const axios = require('axios').create({
  validateStatus: null,
  maxContentLength: 99999,
  poll: {
    maxSockets: 500,
  },
  timeout: 5000,
})

const FORMATS = {
  hardback: 'Hardback',
  hardcover: 'Hardback',
  paperback: 'Paperback',
  ebook: 'Ebook',
  audiobook: 'Audiobook',
  manuscript: 'Manuscript',
  advance: 'Manuscript',
  arc: 'Manuscript',
}

const normalized = {

  openlib: data => {
    // reference: https://openlibrary.org/dev/docs/api/books
    const pubDate = new Date(data.publish_date)
    let asin = null
    _.each(data.source_records, rec => {
      const [tag, ...val] = rec.toLowerCase().split(':')
      if (tag === 'amazon') {
        asin = val.join(':')
      }
    })
    const formats = []
    const format = data.physical_format?.toLowerCase()
    if (format) {
      if (FORMATS[format]) {
        formats.push(FORMATS[format])
      } else {
        console.warn('UNKNOWN FORMAT:', format)
      }
    }
    if (!_.isEmpty(data.ebooks)) {
      formats.push('ebook')
    }
    const covers = data.covers || {}
    return {
      asin,
      formats,
      pubDate,
      title: data.title,
      subtitle: data.subtitle,
      isbn: _.find(_.flatten([data.isbn_13, data.isbn_10])),
      pubName: _.first(data.publishers),
      website: `https://openlibrary.org${data.key}`,
      cover: covers.large || covers.medium || covers.small,
      pageCount: data.number_of_pages,
      extra: {
        classifications: data.classifications,
        subjects: data.subjects,
        subjectPlaces: data.subject_places,
        subjectPeople: data.subject_people,
        subjectTimes: data.subject_times,
        pubPlaces: data.publish_places,
      },
    }
  },

  isbndb: data => {
    // reference: https://isbndb.com/apidocs/v2
    const pubDate = new Date(data.date_published)
    const formats = []
    const format = data.binding?.toLowerCase()
    if (format) {
      if (FORMATS[format]) {
        formats.push(FORMATS[format])
      } else {
        console.warn('UNKNOWN FORMAT:', format)
      }
    }
    if (!_.isEmpty(data.ebooks)) {
      formats.push('ebook')
    }
    let author = null
    if (data.author) {
      const [last, ...first] = data.author.split(',')
      author = `${first.join(',')} ${last}`
    }
    return {
      author,
      formats,
      pubDate,
      title: data.title,
      isbn: _.find([data.isbn13, data.isbn]),
      description: data.overview,
      cover: data.image,
      pageCount: data.pages,
      extra: {
        subjects: data.subjects,
        excerpt: data.excerpt,
        synopsys: data.synopsys,
        dimensions: data.dimensions,
      },
    }
  },

  google: data => {
    const covers = data.imageLinks || {}
    let isbn = null
    if (data.industryIdentifiers) {
      for (const id of data.industryIdentifiers) {
        if (id.type === 'ISBN_13') {
          isbn = id.identifier
          break // prefer the 13-digit version
        } else if (id.type === 'ISBN_10') {
          isbn = id.identifier
        }
      }
    }
    return {
      isbn,
      author: _.first(data.authors),
      title: data.title,
      subtitle: data.subtitle,
      pubDate: data.publishedDate,
      description: data.description,
      cover: covers.thumbnail || covers.smallThumbnail,
      pageCount: data.pageCount,
    }
  }
}

module.exports = ({app, log}) => {

  async function openlib(id, retried) {
    let data = {}
    const url = `https://openlibrary.org/isbn/${id}.json`
    try {
      const r = await axios.get(url)
      log.debug({id, status: r.status}, 'isbn openlib response')
      if (r.status < 300) {
        data = normalized.openlib(r.data || {})
      }
    } catch (err) {
      log.warn(err, 'failed isbn:openlib request')
    }
    if (_.isEmpty(data) && !retried) {
      log.info({id}, 'retrying openlib')
      // this source seems to suffer from false negatives or cold caches, so try again
      return new Promise(resolve => {
        setTimeout(async () => resolve(await openlib(id, true)), 3000)
      })
    }
    return data
  }

  async function isbndb(id) {
    let data = {}
    const url = `https://api2.isbndb.com/book/${id}`
    try {
      const r = await axios.get(url, {
        headers: {
          Authorization: process.env.ISBNDB_KEY,
        },
      })
      log.debug({id, status: r.status}, 'isbn isbndb response')
      if (r.status < 300) {
        if (r.data.errorMessage) {
          throw new Error(r.data.errorMessage)
        }
        data = normalized.isbndb(_.get(r.data, 'book', {}))
      }
    } catch (err) {
      log.warn(err, 'failed isbn:isbndb request')
    }
    return data
  }

  async function google(id) {
    let data = {}
    const url = 'https://www.googleapis.com/books/v1/volumes'
    try {
      const r = await axios.get(url, {
        params: {
          q: `isbn:${id}`,
        },
      })
      log.debug({id, status: r.status}, 'isbn google response')
      if (r.status < 300) {
        data = normalized.google(_.get(r.data, 'items[0].volumeInfo', {}))
      }
    } catch (err) {
      log.warn(err, 'failed isbn:google request')
    }
    delete data.cover
    return data
  }

  const prefs = {
    title: ['openlib', 'google', 'isbndb'],
    subtitle: ['openlib', 'google', 'isbndb'],
    author: ['google', 'isbndb', 'openlib'],
    pubDate: ['isbndb', 'openlib', 'google'],
    description: ['google', 'openlib', 'isbndb'],
    cover: ['isbndb', 'openlib', 'google'],
    website: ['openlib', 'google', 'isbndb'],
    formats: 'merge',
  }

  // TODO: make fetchers configurable process.env.ISBN_SOURCES='isbndb,google'
  async function fetch(id) {
    const all = {
      openlib: {},
      isbndb: {},
      google: {},
    }
    await Promise.allSettled([
      isbndb(id),
      google(id),
      openlib(id),
    ]).then(results => {
      const errors = results.map(i => i.reason).filter(i => i)
      if (!_.isEmpty(errors)) {
        log.error({id, errors}, 'isbn fetch errors')
      }
      all.isbndb = results[0].value
      all.google = results[1].value
      all.openlib = results[2].value
    })
    // prefer openlib values except where specified in `prefs`
    const data = {...all.google, ...all.isbndb, ...all.openlib}
    _.each(prefs, (order, name) => {
      if (order === 'merge') {
        data[name] = _.union(...Object.keys(all).map(src => all[src][name]))
      } else {
        data[name] = _.find(order.map(src => all[src][name]))
      }
    })
    data.all = all
    return data
  }

  app.get('/isbn/:id', async (req, res) => {
    const data = await fetch(req.params.id)
    data.id = req.params.id // satisfy client library's "missing usable primary key"
    res.status(200).send(data)
  })
}
