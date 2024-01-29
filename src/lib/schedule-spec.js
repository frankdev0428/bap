
/* eslint-disable jest/no-commented-out-tests */

const _ = require('lodash')
const log = {
  debug: () => null,
  info: console.debug,
  warn: console.debug,
  error: console.debug,
}
const {
  busyDayCost,
  // nearestNeighbor,
  plan,
} = require('@bap/cotton/lib/schedule')(log, {testing: true})

function M(awardId, {name = 'a', category = '1', score = 99, days = 15} = {}) {
  return {awardId, name, category, score, days}
}

describe('schedule', () => {

  it('penalizes busier days', () => {
    const s1 = [
      {day: 2, matches: [M(1), M(2)]},
      {day: 6, matches: [M(3)]},
      {day: 10, matches: [M(6), M(7), M(8)]},
    ]
    expect(busyDayCost(s1[0])).toStrictEqual(0)
    expect(busyDayCost(s1[1])).toStrictEqual(100)
    expect(busyDayCost(s1[2])).toStrictEqual(100)
  })

  // it('does not get stuck when no neighbor', () => {
  //   const s1 = [{day: -16, matches: [M(6), M(7), M(8)]}]
  //   const [neighbor, mover] = nearestNeighbor(s1[0], s1, 0, -1)
  //   expect(neighbor).toBeNull()
  //   expect(mover).toBeNull()
  // })

  it('can handle few matches', () => {
    expect(plan([])).toHaveLength(0)
    expect(plan([M(1)])).toHaveLength(1)
    expect(plan([M(1), M(2)])).toHaveLength(2)
    expect(plan([M(1), M(2), M(3)])).toHaveLength(3)
  })

  it('higher rated siblings scheduled sooner', () => {
    const matches = [M(1), M(2), M(3, {days: 16, score: 100})]
    const best = plan(matches)
    expect(best).toHaveLength(3)
    expect(_.map(best, 'awardId')).toContain(3)
  })

  it('higher rated siblings scheduled sooner - multiple', () => {
    const matches = [M(1), M(2, {name: 'b'}), M(3, {days: 16, score: 100}), M(4, {name: 'b', score: 100})]
    const best = plan(matches)
    expect(best).toHaveLength(4)
    expect(_.map(best, 'awardId')).toContain(3)
    expect(_.map(best, 'awardId')).toContain(4)
  })

})
