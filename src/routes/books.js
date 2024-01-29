
const fsp = require('fs').promises
const axios = require('axios').create({
  validateStatus: null,
  maxContentLength: 100 << 20, // eslint-disable-line no-bitwise
  poll: {
    maxSockets: 500,
  },
  timeout: 5000,
})

// TODO: consider worker_threads for pdf processing:
// - https://stackoverflow.com/questions/58628173/nodejs-and-express-use-res-send-from-a-worker-thread

module.exports = ({app, log, sequelize, s3, uploads}) => {

  const {User, Book, Author, Subscription, ...model} = require('@bap/cotton/model')(sequelize)
  const libtask = require('@bap/cotton/lib/task')({log, sequelize})
  const libcupid = require('@bap/cotton/lib/cupid')({log})
  const libspotlight = require('@bap/cotton/lib/spotlight')({log, sequelize})
  const asset = require('@bap/cotton/s3')({log, sequelize, s3})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  app.get('/books', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    }
    const unsubscribed = Boolean(req.query.unsubscribed) // TODO: rename to isInUse
    // TODO: incomplete books are showing up in SelectBook
    const books = await Book.scope('active').findAll({
      where: {userId},
      include: [
        Author,
        {model: Subscription, include: [model.Product]},
      ],
      order: [['title', 'ASC']],
    })
    const xformed = []
    for (const book of books) {
      const obj = xforms.book(book)
      if (!unsubscribed || !obj.isInUse) {
        // when asking for unsubscribed, only show books without a valid subscription (see peggy#176)
        xformed.push(obj)
      }
    }
    res.status(200).send(xformed)
  })

  app.get('/books/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('read', Book, id)
    const book = await Book.findByPk(id, {
      include: [
        {model: Author},
        {model: Subscription, include: [model.Product]},
      ]
    })
    if (!book || book.tombstoned) {
      throw new model.NotFoundError('books', id)
    }
    res.status(200).send(xforms.book(book))
  })

  app.post('/books', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('create', User, userId)
    }
    const book = await Book.create({userId, ...req.body})
    res.status(200).send(xforms.book(book))
  })

  app.put('/books/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const book = await Book.findByPk(id, {})
    await req.user.can('update', Book, id)
    if (req.body.cover === 'defined') {
      // will be coming from our image uploader
      delete req.body.cover
    }
    // ignore virtual read-only fields
    delete req.body.thumbnail
    for (const field in book.rawAttributes) {
      if (typeof req.body[field] !== 'undefined') {
        book[field] = req.body[field]
      }
    }
    if (book.cover && !book.cover.startsWith('/assets')) {
      log.warn('processing book cover:', book.cover)
      try {
        const reply = await axios.get(book.cover, {responseType: 'arraybuffer'})
        const path = `${process.env.UPLOADS_DIR}/${book.id}-cover`
        await fsp.writeFile(path, reply.data)
        book.cover = await asset.uploadBookCover(book, path)
      } catch (err) {
        log.error(err, 'failed to process book cover:', book.cover)
      }
    }
    await book.save()
    const bookless = await Subscription.scope('unconfigured').findOne({
      where: {
        userId: book.userId,
      },
    })
    if (bookless) {
      // handle users' first subscription
      if (req.body.keywords) {
        // on last step, so assign and run cupid
        bookless.bookId = book.id
        await bookless.save()
        log.info({id: String(bookless.id)}, 'subscription no longer bookless:', book.id)
        try {
          const {stdout, stderr} = await libcupid.run(bookless.id)
          process.stdout.write(stdout)
          if (stderr) {
            process.stderr.write(stderr)
          }
        } catch (err) {
          err.id = bookless.id
          log.error(err, 'failed to run cupid for new book:', bookless.id)
        }
      }
    }
    res.status(200).send(xforms.book(book))
  })

  app.put('/books/:id/cover', uploads.single('cover'), async (req, res) => {
    if (!req.file) {
      res.status(400).send({error: 'cover missing'})
      return
    }
    const id = parseInt(req.params.id)
    const book = await Book.findByPk(id)
    await req.user.can('update', Book, id)
    book.cover = await asset.uploadBookCover(book, req.file.path)
    await book.save()
    res.status(200).send({id: book.id, cover: book.cover})
  })

  app.put('/books/:id/copies', uploads.array('copies', 3), async (req, res) => {
    if (!req.files) {
      res.status(400).send({error: 'copies missing'})
      return
    }
    const id = parseInt(req.params.id)
    const book = await Book.findByPk(id)
    await req.user.can('update', Book, id)
    const old = []
    for (const file of req.files) {
      const ext = file.originalname.split('.').pop().toLowerCase()
      old.push(asset.curKey('book-copies', book.copies[ext]))
      const key = asset.newKey('book-copies', book.id) + '.' + ext
      const upload = await asset.uploadFile(file.path, key)
      book.copies[ext] = upload.url
      if (ext === 'pdf') {
        await libtask.add('Optimize PDF', {url: upload.url, bookId: book.id})
      }
    }
    book.changed('copies', true) // changes in json objects not auto-detected cuz {} != {}
    await book.save()
    await asset.safeDeleteUpload(...old)
    res.status(200).send({id: book.id, copies: book.copies})
  })

  app.delete('/books/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const book = await Book.findByPk(id)
    await req.user.can('delete', Book, id)
    book.tombstoned = new Date()
    await book.save()
    // const old = Object.values(book.copies || {}).map(i => asset.curKey('book-copies', i))
    // if (book.cover) {
    //   old.push(asset.curKey('book-covers', book.cover))
    //   old.push(asset.curKey('book-covers', book.cover + '-thumb'))
    // }
    // await book.destroy()
    // await asset.safeDeleteUpload(...old)
    res.status(200).send(xforms.book(book))
  })

  app.get('/books/social/:id', async (req, res) => {
    const bookId = parseInt(req.params.id)
    // if (id === 0) { // Support for web app api client library needing to make this request on initial load
    //   res.status(200).send({id, pubDate: id})
    //   return
    // }
    await req.user.can('read', Book, bookId)

    const activity = await libspotlight.randomMessage(bookId)

    res.status(200).send(activity)
  })

  app.get('/share/book/:id', async (req, res) => {
    const bookId = parseInt(libspotlight.decoded(req.params.id))
    const book = await Book.findByPk(bookId, {include: [Author]})
    if (!book) {
      log.warn({id: String(bookId)}, 'unknown book shared:', req.params.id)
      res.redirect('https://bookawardpro.com')
      return
    }
    const affiliate = await model.Affiliate.findOne({where: {userId: book.userId}})
    const affiliateUrl = `https://app.bookawardpro.com/?ssa=${affiliate.code}`
    const text = 'Book Award Pro is how authors become award-winning authors. Discover, target, and submit to your most promising book award opportunities.'
    const nonce = Math.floor(Math.random() * 999999)
    res.setHeader('Content-Type', 'text/html').set('Content-Security-Policy', `script-src 'nonce-${nonce}'`).status(200).send(`<!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <title>${book.title}</title>
          <meta property="og:title" content="${book.title}" />
          <meta property="og:site_name" content="Book Award Pro">
          <meta property="og:type" content="article" />
          <meta property="og:image" content="${book.cover}" />
          <meta property="og:locale" content="en_US">
          <meta property="og:url" content="${affiliateUrl}"/>
          <meta property="og:description" content="${text}" />
          <meta property="og:image:width" content="100">
          <meta property="og:image:height" content="150">
        </head>
        <body>
          <p>${text}</p>
          <img src="${book.cover}" alt="Book Cover"/>
          <script nonce="${nonce}">
            window.location.replace('${affiliateUrl}');
          </script>
        </body>
      </html>
    `)
  })

}
