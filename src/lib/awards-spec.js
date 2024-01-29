
const _ = require('lodash')
const date = require('date-fns')

const {Sequelize} = require('sequelize')
const sequelize = new Sequelize('sqlite::memory:')

const log = {
  debug: () => null,
  info: console.debug,
  warn: console.debug,
  error: console.debug,
}
const TODAY = date.addHours(date.startOfDay(new Date()), 12) // noon GMT
const {
  PREFERRED_KEYWORD_BONUS,
  score,
  targetable,
} = require('@bap/cotton/lib/awards')({log, sequelize, TODAY, testing: true})

function A(award = {}) {
  return _.merge({
    id: 1,
    name: 'NAME',
    category: 'CATEGORY',
    description: 'DESCRIPTION',
    notes: 'NOTES',
    restrictions: 'RESTRICTIONS',
    // fee: 33,
    currency: 'USD $',
    website: 'WEBSITE',
    allowsDigital: true,
    isScam: false,
    nonContentTypes: null, // ['Cover Design'],
    publicationTypes: null, // ['Traditional'],
    formatsOr: null, // ['Paperback', 'Ebook'],
    fictionFilter: null, // ['Fiction'],
    workTypesAnd: null, // ['First Book'],
    workTypesOr: null, // ['Picture Book/Illustrations', 'Comic Book/Graphic Novel'],
    workTypesNot: null, // ['Essay'],
    keywordsAnd: null,
    keywordsOr1: null,
    keywordsOr2: null,
    keywordsNot: null,
    wordsMin: null,
    wordsMax: null,
    pagesMin: null,
    pagesMax: null,
    publishStart: null,
    publishEnd: null,
    copyrightStart: null,
    copyrightEnd: null,
    authorStart: null,
    authorEnd: null,
    ageMin: null,
    ageMax: null,
    bookSetting: null,
    authorBirthplace: null,
    authorLineage: null,
    authorCitizenship: null,
    authorResidency: null,
    openDate: '',
    dueDate: '',
    finalsDate: '',
    resultsDate: '',
    scoreCategories: 0,
    scoreEntrySteps: 0,
    scoreStability: 0,
    scoreHelpful: 0,
    scoreCyclesPerYear: 0,
    scoreWinnerValue: 0,
    scoreBenefits: 0,
    scoreCycleChanges: 0,
    scoreMultipleWinners: 0,
    scoreAttractive: 0,
    scoreBonus: 0,
  }, award)
}

function B(book = {author: {}}) {
  return _.merge({
    id: 1,
  }, book)
}

describe('targeting', () => {

  it('will give enough time to process submissions', () => {
    expect(targetable(A({dueDate: null}))).toBeTruthy()
    expect(targetable(A({dueDate: TODAY}))).toBeFalsy()
    expect(targetable(A({dueDate: date.addDays(TODAY, 11)}))).toBeFalsy()
    expect(targetable(A({dueDate: date.addDays(TODAY, 12)}))).toBeTruthy()
  })

  it('only targets awards that accept digital submissions', () => {
    expect(targetable(A({allowsDigital: true}))).toBeTruthy()
    expect(targetable(A({allowsDigital: false}))).toBeFalsy()
  })

  it('only targets awards with effective fee <= $100', () => {
    expect(targetable(A({}))).toBeTruthy()
    expect(targetable(A({fee: 100}))).toBeTruthy()
    expect(targetable(A({fee: 101}))).toBeFalsy()
    expect(targetable(A({fee: 101, bapFee: 100}))).toBeTruthy()
    expect(targetable(A({fee: 101, bapFee: 101}))).toBeFalsy()
  })

})

describe('awards', () => {

  it('works!', () => {
    const scores = score(A(), B())
    expect(scores).toStrictEqual({
      digital: 20,
      total: 20,
    })
  })

  it('includes static scores!', () => {
    const scores = score(A({scoreAttractive: 6, scoreBonus: 7, scoreWat: 9}), B())
    expect(scores?.scoreAttractive).toStrictEqual(6)
    expect(scores?.scoreBonus).toStrictEqual(7)
    expect(scores?.total).toStrictEqual(33)
    expect(scores?.scoreWat).toBeUndefined()
  })

  it('prefers less expensive awards, up to a point', () => {
    let scores = null
    scores = score(A({fee: null}), B())
    expect(scores?.fee).toBeUndefined()
    scores = score(A({fee: 0}), B())
    expect(scores?.fee).toBeUndefined()
    scores = score(A({fee: 5}), B())
    expect(scores?.fee).toStrictEqual(0)
    scores = score(A({fee: 33}), B())
    expect(scores?.fee).toStrictEqual(25)
    scores = score(A({fee: 100}), B())
    expect(scores?.fee).toStrictEqual(0)
    scores = score(A({fee: 150}), B())
    expect(scores?.fee).toStrictEqual(-11)
    scores = score(A({fee: 151}), B())
    expect(scores?.fee).toStrictEqual(-16)
  })

  it('penalizes awards with no website', () => {
    let scores = null
    scores = score(A({website: ''}), B())
    expect(scores?.website).toStrictEqual(-10)
  })

  it('prefers awards due sooner', () => {
    let scores = null
    scores = score(A({dueDate: new Date()}), B())
    expect(scores?.dueDate).toStrictEqual(30)
    scores = score(A({dueDate: date.add(new Date(), {days: 39})}), B())
    expect(scores?.dueDate).toStrictEqual(11)
    scores = score(A({dueDate: date.add(new Date(), {days: 90})}), B())
    expect(scores?.dueDate).toBeUndefined()
  })

  it('prefers less frequent awards', () => {
    let scores = null
    scores = score(A({cyclesPerYear: 5}), B())
    expect(scores?.cycles).toStrictEqual(-66)
    scores = score(A({cyclesPerYear: 4}), B())
    expect(scores?.cycles).toStrictEqual(-44)
    scores = score(A({cyclesPerYear: 3}), B())
    expect(scores?.cycles).toStrictEqual(-14)
    scores = score(A({cyclesPerYear: 2}), B())
    expect(scores?.cycles).toStrictEqual(-5)
    scores = score(A({cyclesPerYear: 1}), B())
    expect(scores?.cycles).toBeUndefined()
  })

  it('prefers awards that announce quickly', () => {
    let scores = null
    scores = score(A({dueDate: new Date(), resultsDate: date.add(new Date(), {days: 5})}), B())
    expect(scores?.quickDraw).toStrictEqual(10)
    scores = score(A({dueDate: new Date(), resultsDate: date.add(new Date(), {days: 46})}), B())
    expect(scores?.quickDraw).toStrictEqual(5)
  })

  it('penalizes non-content awards', () => {
    let scores = null
    scores = score(A({nonContentTypes: ['Cover Design']}), B())
    expect(scores?.nonContentType).toStrictEqual(-80)
  })

  it('penalizes overly generic awards', () => {
    let scores = null
    scores = score(A({category: 'Non Fiction : General'}), B())
    expect(scores?.generic).toStrictEqual(-41)
  })

  it('rejects books with unallowed keywords', () => {
    const scores = score(
      A({keywordsNot: ['Nope']}),
      B({keywords: ['Yup', 'Nope']})
    )
    expect(scores).toBeNull()
  })

  it('books need requisite keywords', () => {
    let scores = null
    scores = score(
      A({keywordsNot: ['YEEE', 'BOYE']}),
      B({keywords: ['YEEE']})
    )
    expect(scores).toBeNull()
    scores = score(
      A({keywordsNot: ['YEEE', 'BOYE']}),
      B({keywords: ['YEEE', 'BOYE', 'Hi Mom!']})
    )
    expect(scores).toBeNull()
    scores = score(
      A({keywordsAnd: ['YEEE', 'BOYE']}),
      B({keywords: ['YEEE']})
    )
    expect(scores).toBeNull()
    scores = score(
      A({keywordsAnd: ['YEEE', 'BOYE']}),
      B({keywords: ['YEEE', 'BOYE', 'Hi Mom!']})
    )
    expect(scores.andKeywords).toStrictEqual(42)
  })

  it('prefers books with optional keywords', () => {
    let scores = null
    scores = score(
      A({keywordsOr1: ['Hi Mom!']}),
      B({keywords: ['YEEE']})
    )
    expect(scores).toBeNull()
    scores = score(
      A({keywordsOr1: ['YEEE', 'BOYE']}),
      B({keywords: ['YEEE']})
    )
    expect(scores?.orKeywords).toStrictEqual(4)
    scores = score(
      A({keywordsOr1: ['YEEE', 'BOYE']}),
      B({keywords: ['YEEE', 'BOYE', 'Hi Mom!']})
    )
    expect(scores?.orKeywords).toStrictEqual(16)
    scores = score(
      A({keywordsOr1: ['YEEE', 'BOYE'], keywordsOr2: ['Hi Mom!']}),
      B({keywords: ['YEEE']})
    )
    expect(scores).toBeNull()
    scores = score(
      A({keywordsOr1: ['YEEE', 'BOYE'], keywordsOr2: ['Hi Mom!']}),
      B({keywords: ['YEEE', 'Hi Mom!']})
    )
    expect(scores?.orKeywords).toStrictEqual(12)
  })

  it('prefers certain keywords', () => {
    let scores = null
    scores = score(
      A({keywordsOr1: ['Time Travel', 'Hi Mom!']}),
      B({keywords: ['Hi Mom!']})
    )
    expect(scores.preferredKeyword).toBeUndefined()
    scores = score(
      A({keywordsOr1: ['Hi Mom!'], keywordsOr2: ['Time Travel']}),
      B({keywords: ['Time Travel', 'Jabroney', 'Hi Mom!']})
    )
    expect(scores.preferredKeyword).toStrictEqual(PREFERRED_KEYWORD_BONUS)
    scores = score(
      A({keywordsAnd: ['Children & Young Adult (Age 11-17)'], keywordsOr1: ['Time Travel', 'Hi Mom!']}),
      B({keywords: ['Time Travel', 'Children & Young Adult (Age 11-17)']})
    )
    expect(scores.preferredKeyword).toStrictEqual(PREFERRED_KEYWORD_BONUS)
  })

  it('requires and prefers matching work types', () => {
    let scores = null
    scores = score(
      A({workTypesOr: ['Time Travel', 'Hi Mom!']}),
      B({workTypes: ['Hi Mom!']})
    )
    expect(scores?.orWorkTypes).toStrictEqual(11)
    scores = score(
      A({workTypesOr: ['Time Travel']}),
      B({workTypes: ['Hi Mom!']})
    )
    expect(scores).toBeNull()
    // we don't support empty array
    // scores = score(
    //   A({workTypesOr: []}),
    //   B({workTypes: ['Hi Mom!']})
    // )
    // expect(scores).toBeNull()
    scores = score(
      A({workTypesOr: null}),
      B({workTypes: ['Hi Mom!']})
    )
    expect(scores?.orWorkTypes).toBeUndefined()

    scores = score(
      A({workTypesAnd: ['Time Travel', 'Hi Mom!']}),
      B({workTypes: ['Kewl', 'Hi Mom!', 'Time Travel']})
    )
    expect(scores?.andWorkTypes).toStrictEqual(26)
    scores = score(
      A({workTypesAnd: ['Time Travel', 'Hi Mom!']}),
      B({workTypes: ['Kewl', 'TimeTravel']})
    )
    // we don't support empty array
    // expect(scores).toBeNull()
    // scores = score(
    //   A({workTypesAnd: []}),
    //   B({workTypes: ['Hi Mom!']})
    // )
    // expect(scores?.andWorkTypes).toStrictEqual(0)
    scores = score(
      A({workTypesAnd: null}),
      B({workTypes: ['Hi Mom!']})
    )
    expect(scores?.andWorkTypes).toBeUndefined()
  })

  it('requires matching book setting', () => {
    let scores = null
    scores = score(
      A({bookSetting: ['YEEE', 'BOYE']}),
      B({regions: [{kind: 'Setting', names: ['Hi Mom!']}]})
    )
    expect(scores).toBeNull()
    scores = score(
      A({bookSetting: ['YEEE', 'BOYE']}),
      B({regions: [{kind: 'Published', names: ['YEEE']}]})
    )
    expect(scores).toBeNull()
    scores = score(
      A({bookSetting: ['YEEE', 'BOYE']}),
      B({regions: [{kind: 'Setting', countries: ['YEEE'], names: ['Hi Mom!']}]})
    )
    expect(scores?.regions).toStrictEqual(20)
  })

  it('requires matching author birthplace', () => {
    let scores = null
    scores = score(
      A({authorBirthplace: ['YEEE', 'BOYE']}),
      B({author: {}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorBirthplace: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Birthplace', names: ['Hi Mom!']}]}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorBirthplace: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Birthplace', names: ['Hi Mom!'], countries: ['BOYE']}]}})
    )
    expect(scores?.regions).toStrictEqual(20)
  })

  it('requires matching author lineage', () => {
    let scores = null
    scores = score(
      A({authorLineage: ['YEEE', 'BOYE']}),
      B({author: {}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorLineage: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Just Playing', names: ['YEEE']}]}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorLineage: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Lineage', names: ['Hi Mom!'], countries: ['BOYE']}]}})
    )
    expect(scores?.regions).toStrictEqual(20)
  })

  it('requires matching author citizenship', () => {
    let scores = null
    scores = score(
      A({authorCitizenship: ['YEEE', 'BOYE']}),
      B({author: {}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorCitizenship: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Citizenship', names: ['Hi Mom!']}]}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorCitizenship: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Citizenship', names: ['Hi Mom!'], countries: ['BOYE']}]}})
    )
    expect(scores?.regions).toStrictEqual(20)
  })

  it('requires matching author residency', () => {
    let scores = null
    scores = score(
      A({authorResidency: ['YEEE', 'BOYE']}),
      B({author: {}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorResidency: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Just Playing', names: ['YEEE']}]}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorResidency: ['YEEE', 'BOYE']}),
      B({author: {regions: [{kind: 'Residence', names: ['Hi Mom!'], countries: ['BOYE']}]}})
    )
    expect(scores?.regions).toStrictEqual(20)
  })

  it('does not score ALL_REGIONS awards higher', () => {
    let scores = null
    scores = score(
      A({authorResidency: ['ANY/ALL REGIONS']}),
      B({author: {}})
    )
    expect(scores).toBeNull()
    scores = score(
      A({authorResidency: ['ANY/ALL REGIONS']}),
      B({author: {regions: [{kind: 'Residence', names: ['HECK', 'YEEE']}]}})
    )
    expect(scores).toBeDefined()
    expect(scores.regions).toBeUndefined()
  })

})
