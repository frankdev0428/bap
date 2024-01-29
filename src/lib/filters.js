const date = require('date-fns')


const AGING = { // number of days to age off targets & matches
  DUE: 10,
  OPEN: 60,
}

function daysOld(ts) {
  return date.differenceInDays(new Date(), new Date(ts))
}

const matchDueFilter = match => {
  const due = match.award.dueDate
  if (due) {
    if (daysOld(due) > AGING.DUE) {
      return false
    }
  } else if (daysOld(match.created) > AGING.OPEN) {
    return false
  }
  return true
}

const targetDueFilter = match => {
  const due = match.award.dueDate
  if (due) {
    if (daysOld(due) > AGING.DUE) {
      return false
    }
  } else if (daysOld(match.targeted) > AGING.OPEN) {
    return false
  }
  return true
}

const submittedFilter = match => {
  if (match.status !== 'submitted') {
    return false
  }
  if (match.award.resultDate !== null && daysOld(match.award.resultDate) > 0) {
    return false
  }
  return true
}

const F = { // filters
  target(match) {
    if (match.boostId && match.status === 'targeted') {
      // make sure these stick until fulfilled
      return true
    }
    return targetDueFilter(match)
  },

  match(match) {
    if (['submitted', 'won'].includes(match.status)) {
      // matches that have submitted or won do not age off
      return true
    }
    return matchDueFilter(match)
  },

  awardMatches(match) {
    if (['submitted', 'won', 'targeted'].includes(match.status)) {
      return false
    }
    return matchDueFilter(match)
  },

  recentAwardTarget(match) {
    if (match.status !== 'targeted') {
      return false
    }
    if (match.targeting === 'candidate') {
      return false
    }
    return targetDueFilter(match)
  },

  awardSubmission(match) {
    return submittedFilter(match)
  },

  recentAwardSubmission(match) {
    if (daysOld(match.modified) > 45) {
      return false
    }
    return submittedFilter(match)
  },

  awardWin(match) {
    if (match.status !== 'won') {
      return false
    }
    return true
  },

  thirtyDays(match) {
    if (daysOld(match.created) > 30) {
      return false
    }
    return true
  }
}

module.exports = {
  F
}
