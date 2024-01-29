
const _ = require('lodash')
const {randitem} = require('.')

// schduling goals:
//  - matches will happen when they're 5-20 days due
//  - 3-4 per week (see peggy#265)
//  - 2 matches per day
//  - no matches from same award on same day
//  - no matches from same award on consecutive days
//
// some of these rules are addressed during the initial schedule, some during
// optimization, and some afterwards with scoring.

module.exports = (log, config = {}) => {
  // to support back-filling
  if (!config.today) {
    config.today = 0
  }
  // to give users & award master enough time to submit
  if (config.leadDays == null) {
    config.leadDays = 1
  }
  // how far to plan ahead
  if (config.days == null) {
    config.days = 30
  }

  function initial(matches) {
    // spread out based on number of matches
    let nextDayRolls = [1, 1, 1, 1, 2, 2, 3]
    if (matches.length < 15) {
      nextDayRolls = [2, 2, 3, 3, 4]
    } else if (matches.length < 30) {
      nextDayRolls = [1, 2, 2, 2, 3, 3, 4]
    }
    const days = []
    const slots = {}
    _.each(_.groupBy(matches, 'name'), (l, name) => {
      // assume first match is representative
      const match = l[0]
      // avoid too many from an award that is due soon
      if (match.days < 6) {
        slots[name] = 3
      } else if (match.days < 12) {
        slots[name] = 4
      } else {
        slots[name] = 6
      }
      // schedule a day with enough lead time for each award
      const day = Math.min(config.days, match.days - config.leadDays)
      const idx = _.findKey(days, {day})
      if (idx == null) {
        days.push({day, matches: []})
      }
    })
    days.sort((x, y) => {
      return x.day < y.day ? -1 : 1
    })

    // schedule days to fill spaces between lead time days that were allocated first
    _.each(days, (v, n) => {
      const rolls = []
      let cur = (days[n - 1]?.day || config.today) + randitem([1, 2, 3])
      while (cur < v.day - config.leadDays) {
        days.push({day: cur, matches: []})
        rolls.push(randitem(nextDayRolls))
        cur += _.last(rolls)
      }
    })
    days.sort((x, y) => {
      return x.day < y.day ? -1 : 1
    })

    // only enough to fill the calendar to minimize the chance of lower-scored matches being included
    let count = days.length * 4
    while (count && matches.length) {
      // matches are sorted from lowest rated to highest, so popping to make
      // sure they fill slots earlier
      const match = matches.pop()
      if (slots[match.name]) {
        // put this match in random day that is before its due date -
        // not worried about optimal choice for this initial solution
        const day = randitem(days.filter(i => i.day <= match.days)).day
        const idx = _.findKey(days, {day})
        days[idx].matches.push(match)
        slots[match.name]--
        count--
      }
    }
    return days
  }

  function siblingCost(match, neighbor, weight) {
    // spread out matches from same award
    if (!neighbor) {
      return 0
    }
    return weight * neighbor.matches.filter(i => i.awardId !== match.awardId && i.name === match.name).length
  }

  function dueDateCost(day) {
    // favor matches that will be due in 5-20 days
    let sum = 0
    for (const match of day.matches) {
      const daysUntilDue = match.days - day.day
      if (daysUntilDue < 3) {
        sum += 200
      } else if (daysUntilDue < 5) {
        sum += 20
      } else if (daysUntilDue > 20) {
        sum += 50
      } else if (daysUntilDue > 30) {
        sum += 150
      }
    }
    return sum
  }

  function busyDayCost(day) {
    // aim for 2 matches per day
    return 100 * Math.abs(day.matches.length - 2)
  }

  // function frequentAwardCost(day, match) {
  //   // favor matches with lower frequency in days 1-10
  //   if (day < 11 && match.cyclesPerYear > 3) {
  //     return Math.max(0, 11 - day) * match.cyclesPerYear
  //   }
  //   return 0
  // }

  function cost(days) {
    // return costs individually to aid in the evaluation of tweaks
    const costs = {
      due: 0,
      busy: 0,
      same: 0,
      sibling: 0,
    }
    for (let i = 0; i < days.length; i++) {
      const day = days[i]
      costs.due += dueDateCost(day)
      costs.busy += busyDayCost(day)
      for (const match of day.matches) {
        // try to keep siblings from being scheduled on the same day (see peggy#265)
        costs.same += siblingCost(match, days[i], 200)
        // or consecutive days
        costs.sibling += siblingCost(match, days[i - 1], 100)
        costs.sibling += siblingCost(match, days[i + 1], 100)
        // handling frequent awards via scoring, but leaving the code in case want to revisit
        // sum += frequentAwardCost(day.day, match)
      }
    }
    costs.total = _.sum(Object.values(costs))
    return costs
  }

  // function nearestNeighbor(busiest, days, i, direction, attempt = 1) {
  //   let neighbor = days[i + (direction * attempt)] || days[i + (-direction * attempt)]
  //   if (!neighbor) {
  //     return [null, null]
  //   }
  //   let moveable = busiest.matches.filter(m => neighbor.day < m.days - config.leadDays)
  //   if (moveable.length === 0) {
  //     // no available neighbors in this direction so try other direction
  //     neighbor = days[Math.max(0, Math.min(days.length - 1, i + (-direction * attempt)))]
  //     moveable = busiest.matches.filter(m => neighbor.day < m.days - config.leadDays)
  //   }
  //   if (moveable.length === 0) {
  //     // still none, so try an extra step out
  //     return nearestNeighbor(busiest, days, i, direction, attempt + 1)
  //   }
  //   return [neighbor, randitem(moveable)] // _.sortBy(moveable, m => m.days - neighbor.day).pop()]
  // }

  function transition(days) {
    // move a match from a random day to another day
    // NOTES:
    // - There could be a pathological case where there is no possible transition.
    //   If possible, but didn't find in time, will try next iteration.
    // - We want a random transition so that we don't get stuck in local minima.
    for (let attempts = 0; attempts < 100; attempts++) {
      const d1 = randitem(days)
      const d2 = randitem(days)
      for (let i = 0; i < d2.matches.length; i++) {
        if (d2.matches[i].days - config.leadDays > d1.day) {
          // don't violate due date constraint
          d1.matches.push(_.pullAt(d2.matches, [i])[0])
          return days
        }
      }
    }
    return days
  }

  // function transition(days) {
  //   // move a match from a random day to another day
  //   // NOTES:
  //   // - There could be a pathological case where there is no possible transition.
  //   //   If possible, but didn't find in time, will try next iteration.
  //   // - We want a random transition so that we don't get stuck in local minima.
  //   const d1 = days[0]
  //   for (let attempts = 0; attempts < 100; attempts++) {
  //     const d2 = randitem(days)
  //     for (let i = 0; i < d2.matches.length; i++) {
  //       if (d2.matches[i].days - config.leadDays > d1.day) {
  //         // don't violate due date constraint
  //         d1.matches.push(_.pullAt(d2.matches, [i])[0])
  //         if (d1.matches.length > 1) {
  //           d2.matches.push(d1.matches.shift())
  //         }
  //         return days
  //       }
  //     }
  //   }
  //   return days
  // }

  function anneal(initial) { // eslint-disable-line no-shadow
    // https://en.wikipedia.org/wiki/Simulated_annealing
    // NOTES on superparameters:
    //  - don't know how Boltzmann's constant is special, but it makes a difference
    //  - even though transition() chooses a random state, commenting out jumps makes a difference
    //  - "break if not improving" only make it through 2-3 cooling rounds
    //  - experimented with lots of step values and 100x100 seems to yield good results
    const COOLING_STEPS = 100
    const COOLING_FRACTION = 0.95
    const STEPS_PER_TEMP = 100
    const BOLTZMANNS = 1.3806485279e-23

    let curSolution = initial
    let curCost = cost(curSolution)
    let bestSolution = _.cloneDeep(curSolution)
    let bestCost = _.cloneDeep(curCost)
    let jumps = 0
    let iterations = 0
    for (let step = 0; step < COOLING_STEPS; step++) {
      // const startCost = bestCost.total
      for (let j = 0; j < STEPS_PER_TEMP; j++) {
        const newSolution = transition(_.cloneDeep(curSolution))
        const newCost = cost(newSolution)
        if (newCost.total < bestCost.total) {
          bestCost = _.cloneDeep(newCost)
          bestSolution = _.cloneDeep(newSolution)
        }
        const merit = Math.exp((curCost.total - newCost.total) / BOLTZMANNS / step * COOLING_FRACTION)
        if (merit > Math.random()) {
          jumps++
          curCost = newCost
          curSolution = newSolution
        }
        iterations++
      }
      // if (startCost === bestCost.total) {
      //   // exit if we're not improving after an entire cooling step
      //   break
      // }
      // temperature *= COOLING_FRACTION
    }
    // log.warn({jumps, iterations, start: cost(initial), end: bestCost}, 'schedule stats')
    log.debug({jumps, iterations, start: cost(initial).total, end: bestCost.total}, 'schedule stats')
    return bestSolution
  }

  function plan(matches) {
    if (matches.length < 3) {
      // short-circuit if nothing to optimize
      return matches
    }
    // optimize
    const days = anneal(initial([...matches]))
    // TODO: consider a cost for lower rated in the early days which might
    //       obviate the need this sibling switcharoo stuff
    // put higher rated siblings in front of lower rated siblings (swap days)
    const siblings = {}
    // order the siblings by score, recording their location in `days`
    _.each(days, (day, i) => {
      _.each(day.matches, (match, j) => {
        const name = match.name
        if (!siblings[name]) {
          siblings[name] = [{match, i, j}]
        } else {
          // put highest rated at front of the list
          const first = siblings[name][0].match
          if (match.score > first.score) {
            siblings[name].unshift({match, i, j})
          } else {
            siblings[name].push({match, i, j})
          }
        }
      })
    })
    // update `days` by swapping highest rated with first
    _.each(siblings, l => {
      if (l.length > 1) {
        const highest = l.shift()
        const first = _.sortBy(l, x => [x.i, x.j]).shift()
        // will pick highest rated overall later, so only handle when days differ
        if (highest.i > first.i) {
          days[first.i].matches[first.j] = highest.match
          days[highest.i].matches[highest.j] = first.match
        }
      }
    })
    // for (const day of days) {
    //   console.log('DAY:', day.day, day.matches.map(m => `${m.days - day.day} : ${m.score} : ${m.name}`))
    // }
    return _.flatten(_.map(days, 'matches'))
  }

  return {
    anneal,
    busyDayCost,
    // nearestNeighbor,
    plan,
    transition,
  }
}
