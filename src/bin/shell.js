#! /usr/bin/env node

/* eslint-disable no-unused-vars */

const _ = require('lodash')
const date = require('date-fns')

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: 'api-shell',
  level: process.env.LOG_LEVEL || 'INFO',
})

const {Sequelize, QueryTypes, Op} = require('sequelize')
const sequelize = new Sequelize({
  logging: false,
  dialect: 'postgres',
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGNAME,
  username: process.env.PGUSER,
  password: process.env.PASSWORD,
})
const model = require('@bap/cotton/model')(sequelize)
const {User} = model

const stripe = require('stripe')(process.env.STRIPE_KEY, {
  apiVersion: '2020-08-27',
  maxNetworkRetries: 3,
})
