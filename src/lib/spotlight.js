const {Op} = require('sequelize')
const date = require('date-fns')
const {F} = require('@bap/cotton/lib/filters')
const _ = require('lodash')

const strReplace = (str, el) => {
  const [oldStr, newStr] = el
  return str.replaceAll(oldStr, newStr)
}

module.exports = ({sequelize}) => {

  const {Match, Award, Book, Author, Announcement, MarketingActivity, SocialShareMessage} = require('@bap/cotton/model')(sequelize)

  async function wins(bookId) {
    return await Match.count({where: {bookId, status: 'won'}})
  }

  function encoded(id) {
    return '1' + [...String(id)].map(c => c.charCodeAt(0).toString(16)).join('')
  }

  function decoded(txt) {
    const algo = txt[0]
    let id = ''
    if (algo === '1') {
      for (let i = 1; i < txt.length; i += 2) {
        id += String.fromCharCode(parseInt(txt.slice(i, i + 2), 16))
      }
    } else {
      throw new Error(`unknown algorithm: ${algo}`)
    }
    return id
  }

  const randomMessage = async bookId => {

    // get activity weight values
    const activityWeights = await MarketingActivity.findAll({
      attributes: ['activityName', 'weight'],
      raw: true
    })

    // find all matches (with associated award & book) that are 'won'
    // OR created in the last 6 months
    // OR targeted in the last 60 days
    const matches = await Match.findAll({
      attributes: ['id', 'bookId', 'status', 'subscriptionId', 'targeting', 'targeted', 'created', 'modified'],
      where: {
        bookId,
        [Op.or]: [
          {status: 'won'},
          {created: {[Op.gte]: date.sub(new Date(), {months: 6})}},
          {targeted: {[Op.gte]: date.sub(new Date(), {days: 60})}}
        ]
      },
      include: [
        {
          model: Award,
          attributes: ['id', 'name', 'category', 'dueDate', 'resultsDate']
        },
        {
          model: Book,
          attributes: ['title', 'cover'],
          include: [
            {
              model: Author,
              attributes: ['fullname', 'photo']
            }
          ]
        },
      ],
    })

    // number matched in the past 30 days
    const thirtyDayMatch = matches.filter(F.thirtyDays).length
    const weightedSelect = []

    // build array of activities. (no more than one match per activity)
    // for each activity in the array that has data, add it's name to the weightedSelect array weight number of times.
    // since it's read-only, return a clean objects with only the relevent data
    const activities = [
      {name: 'award_matches', results: _.sample(matches.filter(F.awardMatches))},
      {name: 'recent_award_target', results: _.orderBy(matches.filter(F.recentAwardTarget), ['targeted'], ['desc']).find(e => e)},
      {name: 'award_submission', results: _.sample(matches.filter(F.awardSubmission))},
      {name: 'recent_award_submission', results: _.orderBy(matches.filter(F.recentAwardSubmission), ['modified'], ['desc']).find(e => e)},
      {name: 'award_win', results: _.sample(matches.filter(F.awardWin))},
      {name: 'recent_award_win', results: _.orderBy(matches.filter(F.awardWin), ['modified'], ['desc']).find(e => e)},
    ].filter(e => e.results).map(e => {
      const weight = activityWeights.find(w => w.activityName === e.name)
      for (let i = 0; i < weight.weight; i++) {
        weightedSelect.push(e.name)
      }
      return {activityName: e.name,
        matchId: e.results.id,
        subId: e.results.subscriptionId,
        bookTitle: e.results.book.title,
        bookCover: e.results.book.cover,
        authorName: e.results.book.author.fullname,
        authorPhoto: e.results.book.author.photo,
        awardName: e.results.award.name,
        awardCategory: e.results.award.category}
    })

    // choose one activty by randomly sampling weightedSelect array
    const samp = _.sample(weightedSelect)

    // build the final activity object
    let finalActivity = {}
    if (activities.length) {
      finalActivity = activities.find(e => e.activityName === samp)
      finalActivity.thirtyDayMatch = thirtyDayMatch

      // find a message that corresponds to the chosen activity
      const message = await SocialShareMessage.findOne({
        attributes: ['message', 'activities', 'image'],
        where: {
          activities: {[Op.contains]: [finalActivity.activityName]},
        },
        order: sequelize.random()
      })

      // replace message placeholders with real values and set the final message value
      let replacedMessage = message.message
      const repStrs = [
        ['[[BOOK_TITLE]]', finalActivity.bookTitle],
        ['[[AWARD_NAME]]', finalActivity.awardName],
        ['[[AWARD_CATEGORY]]', finalActivity.awardCategory],
        ['[[AWARD_MATCHES_30]]', finalActivity.thirtyDayMatch]
      ]
      for (const el of repStrs) {
        replacedMessage = strReplace(replacedMessage, el)
      }
      finalActivity.message = replacedMessage

      // get path to award seal
      const anns = await Announcement.findOne({
        attributes: ['files'],
        where: {
          matches: {[Op.contains]: finalActivity.matchId},
        },
        order: [['created', 'DESC']],
      })

      // determine message image types and build paths/names
      const imagePaths = []
      for (const imageType of message.image) {
        let path = ''
        let imageDownloadName = ''
        if (imageType === 'book_cover') {
          path = finalActivity.bookCover
          imageDownloadName = `Book Cover - ${finalActivity.bookTitle}.jpg`
        } else if (imageType === 'author_pic') {
          path = finalActivity.authorPhoto ? finalActivity.authorPhoto : '/assets/img/default-author.jpg'
          imageDownloadName = `Author Photo - ${finalActivity.bookTitle}`
        } else if (imageType === 'nom_cert') {
          path = `/api/nomination-letter/${finalActivity.matchId}`
          imageDownloadName = `Nomination Certificate - ${finalActivity.awardName}`
        } else if (imageType === 'award_seal') {
          path = anns && 'seal' in anns.files ? anns.files.seal : 'assets/img/seals/winner.png'
          imageDownloadName = `Book Award Pro - ${finalActivity.awardName}`
        } else if (imageType === 'bap_nom_badge') {
          path = '/assets/img/seals/nomination.png'
          imageDownloadName = 'Book Award Pro - Award Nominee Badge.png'
        } else if (imageType === 'bap_win_badge') {
          path = 'assets/img/seals/winner.png'
          imageDownloadName = 'Book Award Pro - Award Winner Badge.png'
        }
        imagePaths.push({type: imageType, path, imageDownloadName})
      }
      finalActivity.messageImages = imagePaths
    }

    finalActivity.id = bookId
    finalActivity.encodedId = encoded(bookId)

    return finalActivity
  }


  return {
    decoded,
    encoded,
    randomMessage,
    wins,
  }
}
