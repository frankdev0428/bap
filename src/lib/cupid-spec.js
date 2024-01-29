
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
  shouldMatch,
  shouldTarget,
} = require('@bap/cotton/lib/cupid')({log, sequelize, testing: true})

describe('cupid', () => {

  const sub = (renewed, features = ['match', 'target']) => {
    return {
      product: {features},
      renewed: date.sub(new Date(), renewed),
    }
  }
  const prior = created => ({
    created: date.sub(new Date(), created),
    targeted: date.sub(new Date(), created),
  })

  it('never targets when asked not to', () => {
    expect(shouldTarget(sub({days: 2}), null, 'none')).toBeFalsy()
  })
  it('always targets when forced', () => {
    expect(shouldTarget(sub({days: 2}), null, 'force-target')).toStrictEqual('force-target')
  })
  it('does not target subscriptions without target feature', () => {
    expect(shouldTarget(sub({days: 2}, ['match']))).toBeFalsy()
  })
  it('will target if never targeted before', () => {
    expect(shouldTarget(sub({days: -1}))).toStrictEqual('first target')
  })
  it('will not target if already targeted since renewal', () => {
    expect(shouldTarget(sub({days: 3}), prior({days: 2}))).toBeFalsy()
    expect(shouldTarget(sub({days: 0}), prior({days: 0}))).toBeFalsy()
    expect(shouldTarget(sub({days: 33}), prior({days: 33}))).toBeFalsy()
  })
  it('will avoid race condition with webhook', () => {
    expect(shouldTarget(sub({days: 0}), prior({days: 1}))).toBeFalsy()
    const toosoon = sub({minutes: 30})
    expect(shouldTarget(toosoon, prior({days: 1}))).toBeFalsy()
    expect(shouldTarget(sub({minutes: 33}), prior({days: 1}))).toStrictEqual('scheduled renewal')
    expect(shouldTarget(toosoon, prior({days: 1}), 'webhook')).toStrictEqual('webhook renewal')
  })

  it('never matches when asked not to', () => {
    expect(shouldMatch(sub(2), prior({days: 0}), 'none')).toBeFalsy()
  })
  it('always matches when forced', () => {
    expect(shouldMatch(sub(2), prior({days: 0}), 'force')).toStrictEqual('forced')
  })
  it('does not match subscriptions without match feature', () => {
    expect(shouldMatch(sub(2, []), prior({days: 0}))).toBeFalsy()
  })
  it('will always match if no prior match', () => {
    expect(shouldMatch(sub(22))).toStrictEqual('first match')
  })
  it('will match if more than a few days since prior match', () => {
    expect(shouldMatch(sub(22), prior({days: 0}))).toBeFalsy()
    expect(shouldMatch(sub(22), prior({days: 3}))).toStrictEqual('enough time')
  })

})
