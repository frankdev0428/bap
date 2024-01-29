
module.exports = ({app, log, sequelize, s3, uploads}) => {

  const {User, Book, Author, NotFoundError} = require('@bap/cotton/model')(sequelize)
  const asset = require('@bap/cotton/s3')({log, sequelize, s3})
  const xforms = require('@bap/cotton/xforms')({log, sequelize})

  app.get('/authors', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('read', User, userId)
    }
    const authors = await Author.scope('active').findAll({
      where: {userId},
      include: [{model: Book.scope('active'), required: false}],
      order: [['id', 'DESC']],
    })
    res.status(200).send(authors.map(xforms.author))
  })

  app.get('/authors/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const author = await Author.findByPk(id)
    await req.user.can('read', Author, id)
    if (author.tombstoned) {
      throw new NotFoundError('author', id)
    }
    const data = xforms.author(author)
    data.numActiveBooks = await Book.scope('active').count({
      where: {
        authorId: author.id,
      },
    })
    res.status(200).send(data)
  })

  app.post('/authors', async (req, res) => {
    let userId = req.user.id
    if (req.query.scope) {
      userId = parseInt(req.query.scope)
      await req.user.can('create', User, userId)
    }
    const author = await Author.create({userId, ...req.body})
    res.status(200).send(xforms.author(author))
  })

  app.put('/authors/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const author = await Author.findByPk(id)
    await req.user.can('update', Author, id)
    for (const field in author.rawAttributes) {
      if (typeof req.body[field] !== 'undefined') {
        author[field] = req.body[field]
      }
    }
    await author.save()
    res.status(200).send(xforms.author(author))
  })

  app.put('/authors/:id/photo', uploads.single('photo'), async (req, res) => {
    if (!req.file) {
      res.status(400).send({error: 'photo missing'})
      return
    }
    const id = parseInt(req.params.id)
    const author = await Author.findByPk(id)
    await req.user.can('update', Author, id)
    author.photo = await asset.uploadAuthorPhoto(author, req.file.path)
    await author.save()
    res.status(200).send({id: author.id, photo: author.photo})
  })

  app.delete('/authors/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    const author = await Author.findByPk(id)
    await req.user.can('delete', Author, id)
    author.tombstoned = new Date()
    await author.save()
    // const old = asset.curKey('author-photos', author.photo)
    // await author.destroy()
    // await asset.safeDeleteUpload(old, old + '-thumb')
    res.status(200).send(xforms.author(author))
  })
}
