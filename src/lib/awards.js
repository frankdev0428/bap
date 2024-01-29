
const _ = require('lodash')
const date = require('date-fns')
const {QueryTypes} = require('sequelize')

const REGEX = {
  tooGeneric: new RegExp(/^(?:general|(?:non)?fiction|miscellaneous|crossgenre|wildcard|other|ebook|novel|generalinterest|audio(book|drama)s?|oftheyear)+$/u, 'u'),
}

const ALL_REGIONS = 'ANY/ALL REGIONS'

const PREFERRED_KEYWORD_BONUS = 16
const PREFERRED_KEYWORDS = {
  "Women's Chick Lit": PREFERRED_KEYWORD_BONUS,
  'Academic & School': PREFERRED_KEYWORD_BONUS,
  'Activity Book': PREFERRED_KEYWORD_BONUS,
  'Addiction & Recovery': PREFERRED_KEYWORD_BONUS,
  'Aliens & Space': PREFERRED_KEYWORD_BONUS,
  'Alternate & Parallel Reality': PREFERRED_KEYWORD_BONUS,
  'Architecture': PREFERRED_KEYWORD_BONUS,
  'Beauty & Fashion': PREFERRED_KEYWORD_BONUS,
  'Caregiving': PREFERRED_KEYWORD_BONUS,
  'Children & Young Adult (Age 0-4)': PREFERRED_KEYWORD_BONUS,
  'Children & Young Adult (Age 11-17)': PREFERRED_KEYWORD_BONUS,
  'Children & Young Adult (Age 18-26)': PREFERRED_KEYWORD_BONUS,
  'Children & Young Adult (Age 26+)': PREFERRED_KEYWORD_BONUS,
  'Children & Young Adult (Age 5-10)': PREFERRED_KEYWORD_BONUS,
  'Children & Young Adult': PREFERRED_KEYWORD_BONUS,
  'Coming of Age': PREFERRED_KEYWORD_BONUS,
  'Cooking & Food': PREFERRED_KEYWORD_BONUS,
  'Cozy Mystery': PREFERRED_KEYWORD_BONUS,
  'Death & Dying': PREFERRED_KEYWORD_BONUS,
  'Diet & Fitness': PREFERRED_KEYWORD_BONUS,
  'Disability': PREFERRED_KEYWORD_BONUS,
  'Divorce': PREFERRED_KEYWORD_BONUS,
  'Dystopia': PREFERRED_KEYWORD_BONUS,
  'Elderly & Aging': PREFERRED_KEYWORD_BONUS,
  'Engineering': PREFERRED_KEYWORD_BONUS,
  'Entrepreneurship': PREFERRED_KEYWORD_BONUS,
  'Environmental': PREFERRED_KEYWORD_BONUS,
  'Fable': PREFERRED_KEYWORD_BONUS,
  'Fairy Tale': PREFERRED_KEYWORD_BONUS,
  'Film': PREFERRED_KEYWORD_BONUS,
  'Finance & Economics': PREFERRED_KEYWORD_BONUS,
  'Gardening': PREFERRED_KEYWORD_BONUS,
  'Grief & Loss': PREFERRED_KEYWORD_BONUS,
  'Historical (1200 A.D. - 1800 A.D.)': PREFERRED_KEYWORD_BONUS,
  'Historical (1800 A.D. - PREFERRED_KEYWORD_BONUS50 A.D.)': 19,
  'Historical (500 A.D. - 1200 A.D.)': PREFERRED_KEYWORD_BONUS,
  'Historical (500 B.C. - 500 A.D.)': PREFERRED_KEYWORD_BONUS,
  'Historical (After PREFERRED_KEYWORD_BONUS50 A.D.)': 19,
  'Historical (Pre-500 B.C.)': PREFERRED_KEYWORD_BONUS,
  'Holidays': PREFERRED_KEYWORD_BONUS,
  'Home & House': PREFERRED_KEYWORD_BONUS,
  'Illness & Cancer': PREFERRED_KEYWORD_BONUS,
  'Investing & Retirement': PREFERRED_KEYWORD_BONUS,
  'Journalism': PREFERRED_KEYWORD_BONUS,
  'Marriage': PREFERRED_KEYWORD_BONUS,
  'Military': PREFERRED_KEYWORD_BONUS,
  'Music': PREFERRED_KEYWORD_BONUS,
  'Mythology': PREFERRED_KEYWORD_BONUS,
  'Paranormal & Supernatural': PREFERRED_KEYWORD_BONUS,
  'Photography': PREFERRED_KEYWORD_BONUS,
  'Poetry': PREFERRED_KEYWORD_BONUS,
  'Pregnancy': PREFERRED_KEYWORD_BONUS,
  'Public Relations': PREFERRED_KEYWORD_BONUS,
  'Real Estate': PREFERRED_KEYWORD_BONUS,
  'Religious Studies': PREFERRED_KEYWORD_BONUS,
  'Sales & Marketing': PREFERRED_KEYWORD_BONUS,
  'Social Media': PREFERRED_KEYWORD_BONUS,
  'Sports': PREFERRED_KEYWORD_BONUS,
  'Spy & Espionage': PREFERRED_KEYWORD_BONUS,
  'Sustainability': PREFERRED_KEYWORD_BONUS,
  'Time Travel': PREFERRED_KEYWORD_BONUS,
  'True Story': PREFERRED_KEYWORD_BONUS,
  'Writing & Publishing': PREFERRED_KEYWORD_BONUS,
}

const STATIC_SCORES = [
  'scoreCategories',
  'scoreEntrySteps',
  'scoreStability',
  'scoreHelpful',
  'scoreCyclesPerYear',
  'scoreWinnerValue',
  'scoreBenefits',
  'scoreQuickResults',
  'scoreMultipleWinners',
  'scoreAttractive',
  'scoreBonus',
]

const QRY = {
  // do as much as feasible in-db:
  // - anything that involves scoring to be done in-app
  // - any complicated joins to be done in-app
  //
  // The expression `COALESCE(b.pub_date <= now(), false)` being true means that
  // the book has been published.  The matrix for Unpublished publication type:
  //
  // Award                | Published?  | Will Be Published? |  No Plans
  // ==================== | ==========  | ================== |  ========
  // Unpublished Only     | No          | Yes                |  Yes
  // Unpublished + Others | If Matches  | If Matches         |  Yes
  // Unpublished Missing  | If Matches  | No                 |  No
  matches: `
SELECT
  a.*
FROM
  awards a, books b, authors
WHERE
  a.tombstoned IS NULL
AND
  b.id = :bookId
AND
  b.author_id = authors.id
AND
  -- already matched for this book
  a.id NOT IN (SELECT m.award_id FROM matches m WHERE m.book_id = :bookId)
AND
  (is_scam IS NULL OR NOT is_scam)
AND
  ((b.non_english IS NULL OR b.non_english = false) OR (
    (NOT (a.disqualifiers @> '["Non-English Book"]') OR a.disqualifiers IS NULL) 
  AND 
    b.non_english = true))
AND
  (a.open_date IS NULL OR a.open_date < :date::timestamp)
AND
  (a.due_date IS NULL OR (
     a.due_date > :date::timestamp + '2 days'
   AND
     a.due_date < :date::timestamp + '60 days'
  ))
AND
  CASE
    WHEN a.publication_types = '["Unpublished"]' THEN COALESCE(b.pub_date > now(), true)
    WHEN a.publication_types ? 'Unpublished' THEN b.pub_date IS NULL OR a.publication_types ? b.pub_type
    ELSE CASE
      WHEN COALESCE(b.pub_date > now(), true) THEN false
      ELSE a.publication_types ? b.pub_type
    END
  END
AND
  a.fiction_filter ? CASE WHEN b.fictional THEN 'Fiction' ELSE 'Nonfiction' END
AND
  (a.publish_start is NULL OR b.pub_date >= a.publish_start)
AND
  (a.publish_end is NULL OR b.pub_date <= a.publish_end)
AND
  (a.copyright_start is NULL OR bap_copyright(b.pub_date, b.copyright) >= a.copyright_start)
AND
  (a.copyright_end is NULL OR bap_copyright(b.pub_date, b.copyright) <= a.copyright_end)
AND
  (a.pages_min is NULL OR b.page_count >= 0.9 * a.pages_min)
AND
  (a.pages_max is NULL OR b.page_count <= 1.1 * a.pages_max)
AND
  (a.words_min is NULL OR b.word_count >= 0.8 * a.words_min)
AND
  (a.words_max is NULL OR b.word_count <= 1.2 * a.words_max)
AND
  (a.author_start IS NULL OR (authors.born IS NOT NULL AND (authors.born || '-01-01')::date >= a.author_start))
AND
  (a.author_end IS NULL OR (authors.born IS NOT NULL AND (authors.born || '-01-01')::date <= a.author_end))
AND
  (a.age_min IS NULL OR (authors.born IS NOT NULL AND DATE_PART('year', age(NOW(), (authors.born || '-01-01')::date)) >= a.age_min))
AND
  (a.age_max IS NULL OR (authors.born IS NOT NULL AND DATE_PART('year', age(NOW(), (authors.born || '-01-01')::date)) <= a.age_max))
AND
  b.formats ?| jsonb_array_to_text_array(a.formats_or)
AND
  (a.disqualifiers IS NULL OR NOT b.formats ?| jsonb_array_to_text_array(a.disqualifiers))
AND
  (a.work_types_not IS NULL OR NOT b.work_types ?| jsonb_array_to_text_array(a.work_types_not))
AND
  (a.disqualifiers IS NULL OR NOT a.disqualifiers ? 'ISBN Required' OR b.isbn IS NOT NULL OR b.asin IS NOT NULL)
;`,

  // leaving these gnarly queries here in case need similar again:
  //
  // books b LEFT JOIN LATERAL jsonb_to_recordset(b.regions) AS bregions(kind text, countries text, names text) ON true,
  // authors LEFT JOIN LATERAL jsonb_to_recordset(authors.regions) AS aregions(kind text, countries text, names text) ON true
  //
  // AND
  //   (a.keywords_or1 IS NULL OR b.keywords ?| jsonb_array_to_text_array(a.keywords_or1))
  // AND
  //   (a.keywords_or2 IS NULL OR b.keywords ?| jsonb_array_to_text_array(a.keywords_or2))
  // AND
  //   (a.keywords_not IS NULL OR NOT b.keywords ?| jsonb_array_to_text_array(a.keywords_not))
  // AND
  //   (a.keywords_and IS NULL OR b.keywords @> a.keywords_and)
  //
  // AND (
  //   a.book_setting IS NULL OR b.regions IS NULL OR b.regions = '[]' OR
  //   (bregions.kind = 'Setting' AND a.book_setting = '["ANY/ALL REGIONS"]' AND (bregions.countries || bregions.names) != '[][]') OR
  //   (bregions.kind = 'Setting' AND a.book_setting ?| jsonb_array_to_text_array(bregions.countries::jsonb || bregions.names::jsonb))
  // )
  // AND (
  //   a.author_birthplace IS NULL OR authors.regions IS NULL OR authors.regions = '[]' OR
  //   (aregions.kind = 'Birthplace' AND a.author_birthplace = '["ANY/ALL REGIONS"]' AND (aregions.countries || aregions.names) != '[][]') OR
  //   (aregions.kind = 'Birthplace' AND a.author_birthplace ?| jsonb_array_to_text_array(aregions.countries::jsonb || aregions.names::jsonb))
  // )
  // AND (
  //   a.author_lineage IS NULL OR authors.regions IS NULL OR authors.regions = '[]' OR
  //   (aregions.kind = 'Lineage' AND a.author_lineage = '["ANY/ALL REGIONS"]' AND (aregions.countries || aregions.names) != '[][]') OR
  //   (aregions.kind = 'Lineage' AND a.author_lineage ?| jsonb_array_to_text_array(aregions.countries::jsonb || aregions.names::jsonb))
  // )
  // AND (
  //   a.author_citizenship IS NULL OR authors.regions IS NULL OR authors.regions = '[]' OR
  //   (aregions.kind = 'Citizenship' AND a.author_citizenship = '["ANY/ALL REGIONS"]' AND (aregions.countries || aregions.names) != '[][]') OR
  //   (aregions.kind = 'Citizenship' AND a.author_citizenship ?| jsonb_array_to_text_array(aregions.countries::jsonb || aregions.names::jsonb))
  // )
  // AND (
  //   a.author_residency IS NULL OR authors.regions IS NULL OR authors.regions = '[]' OR
  //   (aregions.kind = 'Residence' AND a.author_residency = '["ANY/ALL REGIONS"]' AND (aregions.countries || aregions.names) != '[][]') OR
  //   (aregions.kind = 'Residence' AND a.author_residency ?| jsonb_array_to_text_array(aregions.countries::jsonb || aregions.names::jsonb))
  // )
}

function effectiveFee(award) {
  // guarding against bapFee being 0, not likely, but possible
  return award.bapFee != null ? award.bapFee : award.fee
}

module.exports = ({log, sequelize, TODAY}) => { // eslint-disable-line no-unused-vars
  const {Award, Match, Book} = require('@bap/cotton/model')(sequelize)

  function regions(kind, list) {
    const m = list?.find(i => i.kind == kind)
    if (m) {
      return (m.countries || []).concat(m.names || [])
    }
    return []
  }

  const PENALTIES = {
    // 'International Impact Book Awards': -80,
    // 'Pinnacle Book Achievement Awards': -80,
    // 'Pinnacle E-Book Achievement Awards': -80,
    // 'Literary Titan Book Award': -30,
  }

  function score(award, book) {
    const scores = {}

    // keywords
    if (award.keywordsNot) {
      const hits = _.intersection(book.keywords, award.keywordsNot).length
      if (hits !== 0) {
        log.debug('filtered keywords not:', award.keywordsNot)
        return null
      }
    }
    let or1 = 0
    let or2 = 0
    if (award.keywordsOr1) {
      const hits = _.intersection(book.keywords, award.keywordsOr1).length
      if (hits === 0) {
        log.debug('filtered keywords or1:', award.keywordsOr1)
        return null
      }
      or1 = 4 * hits
      if (hits === award.keywordsOr1.length) {
        or1 *= 2 // perfect match bonus!
      }
    }
    if (award.keywordsOr2) {
      const hits = _.intersection(book.keywords, award.keywordsOr2).length
      if (hits === 0) {
        log.debug('filtered keywords or2:', award.keywordsOr2)
        return null
      }
      or2 = 4 * hits
      if (hits === award.keywordsOr2.length) {
        or2 *= 2 // perfect match bonus!
      }
    }
    if (or1 + or2) {
      scores.orKeywords = or1 + or2
    }
    if (award.keywordsAnd) {
      const missing = _.difference(award.keywordsAnd, book.keywords).length
      if (missing !== 0) {
        log.debug('filtered keywords and:', award.keywordsAnd)
        return null
      }
      scores.andKeywords = 21 * award.keywordsAnd.length
    }
    // preferred keywords
    for (const keyword of _.flatten([award.keywordsAnd, award.keywordsOr1, award.keywordsOr2])) {
      const bonus = PREFERRED_KEYWORDS[keyword]
      if (bonus && book.keywords.includes(keyword)) {
        scores.preferredKeyword = bonus
        break
      }
    }

    // work types
    if (award.workTypesOr) {
      const hits = _.intersection(award.workTypesOr, book.workTypes).length
      if (hits === 0) {
        log.debug('filtered work types or:', award.name, award.category, award.workTypesOr)
        return null
      }
      scores.orWorkTypes = 11 * hits
    }
    if (award.workTypesAnd) {
      const missing = _.difference(award.workTypesAnd, book.workTypes).length
      if (missing !== 0) {
        log.debug('filtered work types and:', award.name, award.category, award.workTypesAnd)
        return null
      }
      scores.andWorkTypes = 13 * award.workTypesAnd.length
    }

    // regions, no bonus for multiple matches
    if (award.bookSetting) {
      const names = regions('Setting', book.regions)
      if (award.bookSetting.includes(ALL_REGIONS)) {
        if (names.length === 0) {
          log.debug('filtered book setting:', award.bookSetting)
          return null
        }
      } else if (_.intersection(award.bookSetting, names).length === 0) {
        log.debug('filtered book setting:', award.bookSetting, names)
        return null
      } else {
        scores.regions = 20
      }
    }
    if (award.authorBirthplace) {
      const names = regions('Birthplace', book.author.regions)
      if (award.authorBirthplace.includes(ALL_REGIONS)) {
        if (names.length === 0) {
          log.debug('filtered author birthplace:', award.authorBirthplace)
          return null
        }
      } else if (_.intersection(award.authorBirthplace, names).length === 0) {
        log.debug('filtered author birthplace:', award.authorBirthplace)
        return null
      } else {
        scores.regions = 20
      }
    }
    if (award.authorLineage) {
      const names = regions('Lineage', book.author.regions)
      if (award.authorLineage.includes(ALL_REGIONS)) {
        if (names.length === 0) {
          log.debug('filtered author lineage:', award.authorLineage)
          return null
        }
      } else if (_.intersection(award.authorLineage, names).length === 0) {
        log.debug('filtered author lineage:', award.authorLineage)
        return null
      } else {
        scores.regions = 20
      }
    }
    if (award.authorCitizenship) {
      const names = regions('Citizenship', book.author.regions)
      if (award.authorCitizenship.includes(ALL_REGIONS)) {
        if (names.length === 0) {
          log.debug('filtered author citizenship:', award.authorCitizenship)
          return null
        }
      } else if (_.intersection(award.authorCitizenship, names).length === 0) {
        log.debug('filtered author citizenship:', award.authorCitizenship)
        return null
      } else {
        scores.regions = 20
      }
      scores.regions = 20
    }
    if (award.authorResidency) {
      const names = regions('Residence', book.author.regions)
      if (award.authorResidency.includes(ALL_REGIONS)) {
        if (names.length === 0) {
          log.debug('filtered author residence:', award.authorResidency, names)
          return null
        }
      } else if (_.intersection(award.authorResidency, names).length === 0) {
        log.debug('filtered author residence:', award.authorResidency, names)
        return null
      } else {
        scores.regions = 20
      }
    }

    // one-off penalties for awards that we don't have a generic rule for
    if (PENALTIES[award.name]) {
      scores.penalty = PENALTIES[award.name]
    }

    // rest of the scoring
    for (const field of STATIC_SCORES) {
      if (award[field]) {
        scores[field] = award[field]
      }
    }
    if (award.allowsDigital) {
      scores.digital = 20
    }
    // NOTE: treating all currencies the same, eventually will want to apply an exchange rate
    const fee = effectiveFee(award)
    if (fee) {
      if (fee <= 5) {
        scores.fee = 0
      } else if (fee <= 60) {
        scores.fee = 25
      } else if (fee <= 70) {
        scores.fee = 21
      } else if (fee <= 80) {
        scores.fee = 15
      } else if (fee <= 90) {
        scores.fee = 6
      } else if (fee <= 100) {
        scores.fee = 0
      } else if (fee <= 150) {
        scores.fee = -11
      } else {
        scores.fee = -16
      }
    }
    if (!award.website) {
      scores.website = -10
    }
    if (award.dueDate) {
      const ddays = date.differenceInDays(award.dueDate, new Date())
      // awards due sooner score higher
      if (ddays >= 0 && ddays <= 60) {
        scores.dueDate = Math.round((60 - ddays) / 2)
      }
      if (award.resultsDate) {
        // announces results quickly
        const rdays = date.differenceInDays(award.resultsDate, award.dueDate)
        if (rdays <= 45) {
          scores.quickDraw = 10
        } else if (rdays <= 90) {
          scores.quickDraw = 5
        }
      }
    }
    if (award.nonContentTypes) {
      scores.nonContentType = -80
    }
    if (award.category.toLowerCase().replace(/[^a-z0-9]+/ug, '').match(REGEX.tooGeneric)) {
      scores.generic = -41
    }
    if (award.cyclesPerYear > 4) {
      scores.cycles = -66
    } else if (award.cyclesPerYear > 3) {
      scores.cycles = -44
    } else if (award.cyclesPerYear > 2) {
      scores.cycles = -14
    } else if (award.cyclesPerYear > 1) {
      scores.cycles = -5
    }
    scores.total = _.sum(Object.values(scores))

    return scores
  }

  const getCousins = async (bookId, awardName, sponsorId) => {
    const cousins = await Match.findAll({
      where: {
        bookId,
      },
      include: [
        {model: Award, where: {
          name: awardName,
          sponsorId,
        }},
        {model: Book, where: {
          id: bookId
        }},
      ],
    })
    return cousins
  }

  async function filteredScore(book, award, {always = false} = {}) {
    const scores = score(award, book)
    if (!scores) {
      return null
    }
    const prior = await Match.findOne({
      where: {
        status: 'won',
        bookId: book.id,
      },
      include: [
        {model: Award, where: {
          name: award.name,
          category: award.category,
          sponsorId: award.sponsorId,
        }},
      ],
    })
    if (prior && !always) {
      log.debug({id: String(prior.id)}, 'won in prior award cycle:', prior.award.name, prior.award.category)
      return null
    }
    const cousins = await getCousins(book.id, award.name, award.sponsorId)
    if (cousins.length) {
      const recent = cousins.filter(m => date.differenceInDays(new Date(), m.created) < 183)
      const submitted = cousins.filter(m => m.status === 'submitted')
      const won = cousins.find(m => m.status === 'won')
      if (recent.length >= 6 && !always) {
        log.debug('no more than 6 from same award in 6 month period')
        return null
      }
      const openDate = award.openDate.valueOf()
      if (won) {
        // won in any category in any cycle
        scores.wonCousin = -161
        scores.total += scores.wonCousin
      } else if (submitted.length > 0) {
        if (submitted.find(m => m.award.category === award.category)) {
          // submitted for same category in prior cycle
          scores.submitTwin = -121
          scores.total += scores.submitTwin
        } else if (submitted.find(m => m.award.openDate.valueOf() === openDate)) {
          // submitted in any category in the current cycle
          scores.submitSibling = -101
          scores.total += scores.submitSibling
        } else {
          // submitted in any category in a prior cycle
          scores.submitCousin = -81
          scores.total += scores.submitCousin
        }
      } else if (recent.find(m => m.status === 'targeted')) { // submitted & won exhausted above
        // targeted in any category in any cycle in the past 180 days
        scores.targetCousin = -41
        scores.total += scores.targetCousin
      }
      if (award.dueDate) {
        // penalize frequent award that is due soon and matched more than once this cycle (see peggy#126)
        if (award.cyclesPerYear > 3) {
          const daysDue = date.differenceInDays(award.dueDate, new Date())
          if (daysDue < 13) {
            if (cousins.filter(m => m.award.openDate.valueOf() === openDate).length > 1) {
              scores.frequentDueSoon = -100
              scores.total += scores.frequentDueSoon
            }
          }
        }
      }
    }
    return scores
  }

  // update cousins/siblings total score when status changed to submitting or won
  const updateCousins = async match => {
    const {book, award} = match
    const cousins = await getCousins(book.id, award.name, award.sponsorId)
    for (const cousin of cousins) {
      if (match.id != cousin.id) {
        const scores = await filteredScore(cousin.book, cousin.award, {always: true})
        if (scores) {
          cousin.score = scores.total
        } else {
          cousin.score = -999
        }
        await cousin.save()
      }
    }
  }

  async function newCandidates(book) {
    const now = TODAY || new Date()
    const awards = await sequelize.query(QRY.matches, {
      replacements: {
        bookId: book.id,
        date: now,
      },
      model: Award,
      mapToModel: true,
      type: QueryTypes.SELECT,
    })
    const candidates = []
    for (const award of awards) {
      const scores = await filteredScore(book, award)
      if (scores) {
        if (!award.dueDate) {
          // https://gitlab.com/bookawardpro/peggy/-/issues/91
          award.dueDate = date.add(now, {days: 30})
        }
        candidates.push({
          scores,
          awardId: award.id,
          score: scores.total,
          name: award.name,
          category: award.category,
          allowsDigital: award.allowsDigital,
          nonContentTypes: award.nonContentTypes,
          fee: award.fee,
          dueDate: award.dueDate,
          days: date.differenceInDays(award.dueDate, new Date()),
          // cyclesPerYear: award.cyclesPerYear, used to be used in scheduler/planner
        })
      }
    }
    return candidates
  }

  function targetable(award, {isAM = false} = {}) {
    if (award.dueDate) {
      if (award.dueDate <= date.addDays(TODAY || new Date(), isAM ? 0 : 11)) {
        return false
      }
    }
    if (!award.allowsDigital) {
      return false
    }
    if (effectiveFee(award) > 100) {
      return false
    }
    return true
  }

  async function awardLandscape(book) {
    const now = TODAY || new Date()
    const awards = await sequelize.query(QRY.matches, {
      replacements: {
        bookId: book.id,
        date: now,
      },
      model: Award,
      mapToModel: true,
      type: QueryTypes.SELECT,
    })
    const candidates = []
    for (const award of awards) {
      const scores = await filteredScore(book, award)
      if (scores) {
        candidates.push({
          ...award.toJSON(),
          scores,
          score: scores.total,
        })
      }
    }
    return candidates
  }

  return {
    PREFERRED_KEYWORD_BONUS,
    filteredScore,
    score,
    targetable,
    newCandidates,
    awardLandscape,
    updateCousins,
  }
}
