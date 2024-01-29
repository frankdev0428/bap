
const date = require('date-fns')
const log = {
  debug: () => null,
  info: console.debug,
  warn: console.debug,
  error: console.debug,
}
const {Sequelize} = require('sequelize')
const sequelize = new Sequelize('sqlite::memory:')
const {
  payout,
  unpayable,
} = require('@bap/cotton/lib/affiliate')({log, sequelize, testing: true})

describe('affiliate', () => {

  it('will not pay on inactive subscriptions', () => {
    const created = date.subDays(new Date(), 34)
    expect(unpayable({}, {created, status: 'canceled'})).toStrictEqual('canceled')
    expect(unpayable({}, {created, status: 'unpaid'})).toStrictEqual('unpaid')
    expect(unpayable({}, {created, status: 'active'})).toBeNull()
  })

  it('will not pay on subscriptions that have not renewed', () => {
    const status = 'active'
    expect(unpayable({}, {status, created: date.subDays(new Date(), 32)})).toStrictEqual('too soon')
    expect(unpayable({}, {status, created: date.subDays(new Date(), 34)})).toBeNull()
  })

  it('pays double for service credit', () => {
    expect(payout({percentage: 16.5, method: 'paypal'}, {paid: 100})).toStrictEqual(16.5)
    expect(payout({percentage: 16.5, method: 'credit'}, {paid: 100})).toStrictEqual(33)
  })

})
