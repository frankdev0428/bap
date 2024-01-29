
const date = require('date-fns')

// keeping in case we want a quick report
//
// const {QueryTypes} = require('sequelize')
// const QRY = {}
// QRY.commissions = `
// SELECT
//   u.id
// , COALESCE(a.email, u.email) AS email
// , u.fullname AS name,
// , SUM(c.amount) AS total
// , COUNT(c.id) AS count
// FROM
//   users u
// , affiliates a
// , referrals r
// , commissions c
// WHERE
//   c.referral_id = r.id
// AND
//   r.affiliate_id = a.id
// AND
//   a.user_id = u.id
// AND
//   c.method = :method
// AND
//   c.created BETWEEN :start AND :end
// GROUP BY 1, 2, 3;
// `

module.exports = () => {

  function unpayable(affiliate, subscription) {
    if (subscription.status !== 'active') {
      return subscription.status
    }
    if (date.differenceInDays(new Date(), subscription.created) < 33) {
      return 'too soon'
    }
    return null
  }

  function payout(affiliate, referral) {
    let percentage = affiliate.percentage / 100
    if (affiliate.method === 'credit') {
      percentage *= 2
    }
    return referral.paid * percentage
  }

  return {
    payout,
    unpayable,
  }
}
