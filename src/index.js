
const express = require('express')
const app = express()
const helmet = require('helmet')
const unless = require('express-unless')

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: 'cotton',
  level: process.env.LOG_LEVEL || 'INFO',
})

const {Sequelize} = require('sequelize')
const sequelize = new Sequelize({
  logging(msg) {
    log.trace(msg)
  },
  dialect: 'postgres',
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGNAME,
  username: process.env.PGUSER,
  password: process.env.PASSWORD,
})

app.use(unless(express.json(), {path: '/stripe/webhook'}))

// app.use((req, res, next) => {
//   // a simple access log
//   log.info(req.get('origin'), req.method, req.path, req.headers['bap-user'])
//   next()
// })

app.use(helmet())
// CORS access handled in our load balancer
if (process.env.FRONTEND?.match(/localhost/u)) {
  app.use(require('cors')({
    origin: [null, 'http://localhost:3000'],
    // methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Bap-User', 'Access-Control-Allow-Headers'],
    credentials: true,
  }))
}

// TODO: lock down the ACL for ./book-copies/
const aws = require('aws-sdk')
const s3 = new aws.S3({
  params: {
    Bucket: process.env.S3_BUCKET,
  },
  endpoint: process.env.S3_ENDPOINT,
  accessKeyId: process.env.S3_ACCESS_ID,
  secretAccessKey: process.env.S3_ACCESS_KEY,
})

// TODO: https://github.com/expressjs/multer#limits
const multer = require('multer')

const uploads = multer({
  dest: process.env.UPLOADS_DIR,
  limits: {
    files: 1,
    fileSize: 350 * 1024 * 1024,
  },
})

app.get('/', (req, res) => {
  res.status(200).send('Hello, Jabroney!')
})

// NOTE: account routes should be first since it does the app.use() for sessions & auth
require('@bap/cotton/routes/account')({app, log, sequelize})
require('@bap/cotton/routes/errors')({app, log})
require('@bap/cotton/routes/authors')({app, log, sequelize, s3, uploads})
require('@bap/cotton/routes/books')({app, log, sequelize, s3, uploads})
require('@bap/cotton/routes/notifications')({app, log, sequelize})
require('@bap/cotton/routes/isbn')({app, log})
require('@bap/cotton/routes/partners')({app, log, sequelize, s3, uploads})
require('@bap/cotton/routes/users')({app, log, sequelize})
require('@bap/cotton/routes/subscriptions')({app, log, sequelize})
require('@bap/cotton/routes/stripe')({app, log, sequelize})
require('@bap/cotton/routes/awards')({app, log, sequelize})
require('@bap/cotton/routes/nomination')({app, log, sequelize})
require('@bap/cotton/routes/affiliates')({app, log, sequelize})
require('@bap/cotton/routes/referrals')({app, log, sequelize})
require('@bap/cotton/routes/announcements')({app, log, sequelize, s3, uploads})

// TODO: these warrant worker threads?
// - https://blog.logrocket.com/node-js-multithreading-what-are-worker-threads-and-why-do-they-matter-48ab102f8b10/
require('@bap/cotton/emailer')({log, sequelize})
require('@bap/cotton/tasker')({log, sequelize, s3})

function onError(err, req, res, next) {
  let status = 500
  let message = err.message
  if (err.name === 'AccessError') {
    status = 403
    message = 'unauthorized'
  } else if (err.name === 'NotFoundError') {
    status = 404
    message = 'not found'
  } else {
    // only passing thru specific msgs above to not leak info
    message = 'service error - support team notified'
    err.user = req.user?.id
    err.url = {path: req.path}
    log.error(err, req.method, req.path, err.message)
  }
  // {id: 0} to satisfy "Missing usable resource key when normalizing response." from client library
  res.status(status)
  res.send({id: 0, error: message})
  return next()
}
app.use(onError)

app.listen(process.env.API_PORT, async () => {
  try {
    await sequelize.authenticate()
    log.info('connected to database')
    if (process.env.SYNC_SCHEMA) {
      log.warn('creating any missing tables...')
      await sequelize.sync()
    }
  } catch (err) {
    log.error(err, 'failed to connect to the database')
  }
  log.info(`running at http://localhost:${process.env.API_PORT}`)
})
