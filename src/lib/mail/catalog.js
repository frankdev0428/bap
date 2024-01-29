
const _ = require('lodash')
const date = require('date-fns')
const {randomInt} = require('crypto')
const {assetUrl, strftime, markdown2html} = require('@bap/cotton/lib')

const levels = {
  info: 1,
  notice: 2,
  warn: 3,
  request: 4,
  error: 5,
}

const urlButton = (url, text, color, style = {}) => {
  const defstyle = {
    color: '#fff',
    'border-style': 'solid',
    'border-width': '10px 18px',
    display: 'inline-block',
    'text-decoration': 'none',
    'border-radius': '3px',
    'box-shadow': '0 2px 3px rgba(0, 0, 0, 0.16)',
    '-webkit-text-size-adjust': 'none',
    'box-sizing': 'border-box',
    'background-color': color,
    'border-color': color,
  }
  return `
<center>
  <a style="${_.map(_.assign(defstyle, style), (v, k) => `${k}: ${v}`).join('; ')}"
     href="${url}" target="_blank" rel="noopener"
  >${text}</a>
</center>
`
}

module.exports = {}

module.exports['New Signup'] = {
  level: levels.notice,
  ttl: 7 * 86400,
  key: data => `New Signup : ${data.user.id}`,
  url: data => `https://${data.settings.domain}`,
  subject: data => `Thank you for joining ${data.settings.business}`,
  body: data => {
    return `
<br/>
Welcome to ${data.settings.business}; we are honored to work with you. If you
ever have any questions, know that we are here to help. You can simply reply to
any email from us to contact our team. Below is a quick outline of what to
expect next.
<br/>
<br/>
<h2>What's Next?</h2>
<center>
  <table role="presentation" border="0" cellspacing="0" cellpadding="10"><tbody>
    <tr>
      <td valign="middle">
        <img src="${assetUrl('/img/complete-profiles.png')}" width="60"/>
      </td>
      <td valign="middle">
        Please complete your Author & Book Profile so we can learn a little more
        about your book. That should only take a few minutes, and then our
        technology will immediately begin working on your awards.
      </td>
    </tr>
    <tr>
      <td valign="middle">
        <img src="${assetUrl('/img/fresh-matches.png')}" width="60"/>
      </td>
      <td valign="middle">
        ${data.settings.business} continues working for your book every day. On
        average, you can expect one or two fresh award matches every week.
      </td>
    </tr>
    <tr>
      <td valign="middle">
        <img src="${assetUrl('/img/activity-status.png')}" width="60"/>
      </td>
      <td valign="middle">
        You can always see the status of your ${data.plan} in your
        account, and you will receive an email notification when there is new
        award, targeting, or submission information for your book.
      </td>
    </tr>
  </tbody></table>
</center>
<br/>
<br/>
${urlButton(data.url, 'View My Acount', data.settings.theme.primary)}
`
  },
}

module.exports['New Referral'] = {
  level: levels.notice,
  ttl: 33 * 86400,
  key: data => `New Referral : ${data.referral.id}`,
  url: data => `https://${data.settings.domain}/connect`,
  subject: () => 'New readers discovering your book',
  body: data => {
    return `
<div style="padding: 10px 15px;">
  <div style="background-color: rgb(65, 177, 253); border-radius: 10px; padding-top: 20px; padding-bottom: 10px;">
    <center>
      <h1 style="font-size: 2rem; color: #000;">Readers are noticing your book!</h1>
      <div style="padding-bottom: 20px;">
        <img src="https://bap.nyc3.digitaloceanspaces.com/img/story-marketing-working.gif"/>
      </div>
      <h2 style="color: #000;">Feels good? Keep it going?</h2>
    </center>
  </div>
  <br/>
  <p style="text-align: justify;">
    Contgratulations ${data.user.nickname}; your story marketing is working! This is inspiring to readers and your book's audience is growing.
  </p>
  <p style="text-align: justify;">
    Keep it up! Every day, you can share fresh story marketing messages from your Book Award Pro marketing dashboard. You will get new messages to share about awards, reviews, nominations, wins and more.
  </p>
  <p style="text-align: justify;">
    And hey, since a fellow author saw your story marketing and joined Book Award Pro, we are giving you a nice credit for $${data.payout} on your account. Woohoo!
  </p>
  ${urlButton(data.url, 'View your marketing', data.settings.theme.primary)}
</div>
`
  },
}

module.exports['Password Recovery'] = {
  level: levels.warn,
  ttl: 2 * 86400,
  key: data => `Password Recovery : ${data.user.id}`,
  url: data => `https://${data.settings.domain}/reset-password?token=${data.token}`,
  subject: data => `Password Recovery for ${data.settings.business}`,
  body: data => {
    return `
<h2>Password Recovery</h2>
<br/>
We received a request to reset your ${data.settings.business} password for the
${data.user.email} account. Click the button below to create your new password:
<br/>
<br/>
${urlButton(data.url, 'Create New Password', data.settings.theme.primary)}
<br/>
<br/>
Need help? Reply to this message to contact support.
`
  },
}

module.exports['Password Reset'] = {
  level: levels.warn,
  ttl: 10 * 60,
  key: data => `Password Reset : ${data.user.id} : ${new Date().toISOString()}`,
  url: data => `https://${data.settings.domain}/login`,
  subject: () => 'Password Reset Successful',
  body: data => {
    return `
<h2>Password Reset Successful</h2>
<br/>
The password has been successfully reset on your ${data.settings.business}
account. You can now access your account with the new password.
<br/>
<br/>
${urlButton(data.url, 'Account Login', data.settings.theme.primary)}
`
  },
}

module.exports['New Award Match'] = {
  level: levels.info,
  ttl: 33 * 86400,
  key: data => `New Award Match : ${data.subscriptionId} : ${date.format(new Date(), 'yyyy-MM-dd')}`,
  url: data => `https://${data.settings.domain}/awards/${data.subscriptionId}`,
  subject: data => `New Award Match for ${data.book.title}`,
  body: data => {
    const book = data.book
    const cover = book.cover ? `<td width="150" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="100" /></td>` : ''
    const f = m => `
${m.name} <br/>
<span style="color: #99989b;">Category:</span> ${m.category} <br/>
<span style="color: #99989b;">Due Date:</span> ${date.format(new Date(m.dueDate), 'MMMM dd')} <br/>
`
    return `
<h2>New Award Match</h2>
${data.settings.business} has found a new award opportunity for your book. A
summary is below and the details for all award matches are included in your account.
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
  ${cover}<td class="email-text-secondary" style="font-size: 20px;">${book.title}</td>
</tr></tbody></table>
<br/>
<ul>
  <li>${data.matches.map(f).join('</li><br/><li>')}</li>
</ul>
<br/>
${urlButton(data.url, 'View Award Details', data.settings.theme.primary)}
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="0"><tbody>
  <tr>
    <td valign="middle" width="40">
      <img src="${assetUrl('/img/fresh-matches.png')}" height="30" width="30"/>
    </td>
    <td valign="middle">
      <h4>Improve Matching</h4>
    </td>
  </tr>
</tbody></table>
Award Matches are opportunities to consider for your book. Providing thorough,
accurate information in your
<a href="https://${data.settings.domain}/books/update/${data.book.id}">Book Profile</a> and
<a href="https://${data.settings.domain}/authors/update/${data.book.authorId}">Author Profile</a> ensures the best award matches.
`
  },
}

module.exports['Candidate Targeted'] = {
  level: levels.notice,
  ttl: 10 * 86400,
  key: data => `Candidate Targeted : ${data.target.id}`,
  customerId: data => data.customer.id,
  isInternal: true,
  url: data => `https://${data.settings.domain}/awards/${data.target.subscriptionId}`,
  subject: data => `[Target] ${data.plan} for ${data.book.title}`,
  body: data => {
    return `
<h2>To-Do: Review Target</h2>
<h3 style="color: #99989b;">Action Required</h3>
<div>
  Please review (and revise, if necessary) the following Candidate Target. The
  candidate will be presented to the client in five (5) days. The Awards Master
  review and revisions must be completed before the candidate phase expires.
</div>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="0">
  <tbody>
    <td width="120" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>
    <td>
      <span style="color: #33383b;">${data.book.title}</span>
      <br/>
      <table role="presentation" border="0" cellspacing="10" cellpadding="0" width="100%"><tbody>
        <tr><td style="color: #99989b;" nowrap>Award</td><td>${data.award.name}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Category</td><td>${data.award.category}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Due</td><td>${date.format(new Date(data.award.dueDate), 'MMMM dd')}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Client</td><td>${data.customer.fullname}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Email</td><td>${data.customer.email}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Matched</td><td>${date.format(new Date(data.target.created), 'yyyy-MM-dd')}</td></tr>
      </tbody></table>
    </td>
  </tbody>
</table>
<br/>
${urlButton(data.url, 'Manage Awards', data.settings.theme.primary)}
`
  },
}

module.exports['New Submission'] = {
  level: levels.notice,
  ttl: 1 * 86400, // will be nagged every day until submitted
  key: data => `New Submission : ${data.target.id} : ${date.format(new Date(), 'yyyy-MM-dd')}`,
  customerId: data => data.customer.id,
  isInternal: true,
  url: data => `https://${data.settings.domain}/awards/${data.target.subscriptionId}`,
  subject: data => `[Submit] ${data.plan} for ${data.book.title}`,
  body: data => {
    const notes = []
    if (data.award.bapFee != null) {
      notes.push(`<div style="padding: 5px 10px; border: 1px solid #badbcc; border-radius: 3px; background-color: #d1e7dd; color: #0f5132;">BAP Entry Fee:  $${data.award.bapFee}</div>`)
    }
    if (data.award.submitNotes) {
      notes.push(data.award.submitNotes)
    }
    return `
<h2>To-Do: New Submission</h2>
<h3 style="color: #99989b;">Action Required</h3>
<div>
  Please complete the following Award Submission. The client's expected
  submission completion date is in 24 hours from now. Once completed, change the
  award's status to "Submitted" on the client's award matches.
</div>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="0">
  <tbody>
    <td width="120" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>
    <td>
      <span style="color: #33383b;">${data.book.title}</span>
      <br/>
      <table role="presentation" border="0" cellspacing="10" cellpadding="0" width="100%"><tbody>
        <tr><td style="color: #99989b;" nowrap>Award</td><td>${data.award.name}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Category</td><td>${data.award.category}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Due</td><td>${date.format(new Date(data.award.dueDate), 'MMMM dd')}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Website</td><td><a href="${data.award.website}"><small>${data.award.website.slice(0, 40)}${data.award.website.length > 40 ? '...' : ''}</small></a></td></tr>
        <tr><td style="color: #99989b;" nowrap>Client</td><td>${data.customer.fullname}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Email</td><td>${data.customer.email}</td></tr>
      </tbody></table>
    </td>
  </tbody>
</table>
${notes ? `<h4 style="color: #99989b;">Notes</h4>${notes.join('<br/>')}<br/>` : ''}
<br/>
<br/>
${urlButton(data.url, 'Manage Awards', data.settings.theme.primary)}
`
  },
}

module.exports['Targeting Complete'] = {
  level: levels.notice,
  ttl: 90 * 86400,
  key: data => `Targeting Complete : ${data.target.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.target.subscription.id}`,
  subject: data => `New Award Target for ${data.target.book.title}`,
  body: data => {
    const book = data.target.book
    let submitBlurb = ''
    let retargetBlurb = ''
    if (data.target.submitBy) {
      const eta = Math.ceil(date.differenceInHours(data.target.submitBy, new Date()) / 24) + 2
      submitBlurb = `
<br/>
<br/>
This Targeted award will be submitted in approximately ${eta} days.
Your submission for this Targeted award is now being prepared. You do not
need to take any action; we are automatically handling everything for you.
Another notification will be sent when the submission is complete.
`
      retargetBlurb = `
<br/>
<br/>
If you would like to reject this Target and receive a new award Target, click the Retarget button on the
<a href="${data.url}/target/${data.target.id}">award's details</a>.
`
    }
    const cover = book.cover ? `<td width="150" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="100" /></td>` : ''
    return `
<h2>New Award Target</h2>
${data.settings.business} has analyzed your awards landscape to determine the
current most promising opportunity -- your Targeted award. All of the details
and the status of your service are available in your account.
${submitBlurb}
<br/>
<br/>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
  ${cover}
  <td class="email-text-secondary" align="center">
    <span style="font-size: 20px">${book.title}</span>
    <br/>
    <br/>
    <br/>
    ${urlButton(data.url, 'View Targeted Award', data.settings.theme.primary)}
  </td>
</tr></tbody></table>
${retargetBlurb}
`
  },
}

module.exports['Submission Complete'] = {
  level: levels.notice,
  ttl: 90 * 86400,
  key: data => `Submission Complete : ${data.match.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.match.subscriptionId}/match/${data.match.id}`,
  subject: data => `Book Submission Complete for ${data.match.book.title}`,
  body: data => {
    const book = data.match.book
    const award = data.match.award
    const cover = book.cover ? `<td width="150" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="100" /></td>` : ''
    let connect = ''
    if (!data.settings.enterprise) {
      connect = `
<div style="padding: 20px; background-color: #F2F4F6; border-radius: 5px; margin-top: 20px;">
<h2 style="margin-top: 0px; padding-top: 0px;">Market your book</h2>
It's easy to share about your new submission and grow your book's audience.
<br/>
<br/>
Every day, you can share fresh story marketing messages from your Book Award Pro marketing dashboard. You'll get new messages to share about awards, reviews,  nominations, wins, and more.
${urlButton(`https://${data.settings.domain}/connect`, 'Story Marketing', data.settings.theme.primary, {'margin-top': '20px'})}
</div>
`
    }
    return `
<h2>Book Submission Complete</h2>
Congratulations! ${book.title} has been submitted for ${award.name} in ${award.category}.
<a href="${data.url}">View the submission details</a> in your account.
<br/>
<br/>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
  <td class="email-text-secondary" align="center">
    <h4>${book.title}</h4>
    <span style="font-size: 14px; color: #99989b;">officially submitted for</span>
    <br/>
    <h4 style="color: #33383b;">
      ${award.name}
      <br/>
      ${award.category}
    </h4>
  </td>
  ${cover}
</tr></tbody></table>
${connect}
<br/>
`
  },
}

module.exports['Subscription Canceled'] = {
  level: levels.notice,
  ttl: 10 * 86400,
  key: data => `Subscription Canceled : ${data.user.id} : ${data.subscription.id}`,
  url: () => null,
  subject: data => `Subscription Canceled : ${data.plan} for ${data.book?.title || 'NO BOOK ASSIGNED'}`,
  body: data => {
    const cover = data.book ? `<td width="150" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>` : ''
    return `
<h2>Subscription Canceled</h2>
<br/>
<div>
  We are sorry to see you have canceled your ${data.plan} and can confirm that has been processed.
  May we ask your reason for choosing to cancel? Any feedback you could share with us would be appreciated.
</div>
<br/>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
  ${cover}
  <td class="email-text-secondary">
    <span style="font-size: 20px; color: #33383b;">${data.book?.title || 'NO BOOK ASSIGNED'}</span>
    <br/>
    <br/>
    Your ${data.plan} is paid until ${date.format(new Date(data.subscription.end), 'MMMM dd, YYY')}
    and you will continue to receive service until then. At that point, your subscription will not renew and you will not be charged again.
  </td>
</tr></tbody></table>
<br/>
<div>
  Thank you for choosing ${data.settings.business}. If you have any questions,
  please reply to this message to contact support.
</div>
`
  },
}

module.exports['Subscription Expiring'] = {
  level: levels.warn,
  ttl: 20 * 86400,
  key: data => `Subscription Expiring : ${data.customer.id} : ${data.subscription.id}`,
  url: data => `https://${data.settings.domain}/account?scope=${data.customer.id}`,
  subject: data => `Service Expiring: ${data.plan} for ${data.book?.title || 'NO BOOK ASSIGNED'}`,
  body: data => {
    const cover = data.book ? `<td width="150" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>` : ''
    return `
<h2>Service Expiring</h2>
<div>
The service detailed below will expire soon. Please submit a renewal before the expiration date to prevent this service from expiring.
</div>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="0">
  <tbody>
    ${cover}
    <td>
      <span style="color: #33383b;">${data.book?.title || 'NO BOOK ASSIGNED'}</span>
      <br/>
      <table role="presentation" border="0" cellspacing="10" cellpadding="0" width="100%"><tbody>
        <tr><td style="color: #99989b;" nowrap>Plan</td><td>${data.plan}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Expires</td><td>${date.format(new Date(data.subscription.end), 'MMMM dd, yyyy')}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Client</td><td>${data.customer.fullname}</td></tr>
        <tr><td style="color: #99989b;" nowrap>Email</td><td>${data.customer.email}</td></tr>
      </tbody></table>
    </td>
  </tbody>
</table>
<br/>
${urlButton(data.url, 'View Account', data.settings.theme.primary)}
`
  },
}

module.exports['Published Book'] = {
  level: levels.warn,
  ttl: 5 * 86400,
  key: data => `Published Book : ${data.book.id}`,
  url: data => `https://${data.settings.domain}/books/update/${data.book.id}`,
  subject: () => 'Awards Update Nearing Your Publication Date',
  body: data => {
    const cover = data.book ? `<td width="150" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>` : ''
    return `
<h2>Your Publication Date is Almost Here</h2>
<br/>
<div>
  According to your <a href="${data.url}">book profile</a>, the publication date for
  ${data.book.title} is on ${date.format(new Date(data.book.pubDate), 'MMMM dd, yyyy')},
  which is only a few days away. Matching your book for the best award
  opportunities requires accurate information.
</div>
<br/>
<div>
  Please take a moment to review your book profile to be sure we have all the latest details, including:
</div>
<br/>
<ul>
  <li>Upload the newest version of your book's PDF and ePub files.</li>
  <li>Update your book's description text with any recent editing.</li>
  <li>Verify all of the details to get the best award matches.</li>
</ul>
<div>
  These are exciting and busy times! Congratulations on your upcoming book launch.
</div>
<br/>
<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
  ${cover}
  <td class="email-text-secondary" align="center">
    <span style="font-size: 20px">${data.book.title}</span>
    <br/>
    <br/>
    <br/>
    ${urlButton(data.url, 'Review Book Profile', data.settings.theme.primary)}
  </td>
</tr></tbody></table>
`
  },
}

module.exports['Unconfigured Subscription'] = {
  level: levels.warn,
  ttl: 10 * 86400,
  key: data => `Unconfigured Subscription : ${data.subscription.id}`,
  url: data => `https://${data.settings.domain}/books`,
  subject: data => `Awards Setup Needed: ${data.plan}`,
  body: data => {
    return `
<h2>Finish Your Awards Setup</h2>
<div>
  Before ${data.settings.business} can begin finding awards for you, we need to
  know a few details about your book. Please take a moment to
  <a href="${data.url}">finish the quick setup</a> for your ${data.plan}.
  If you have any questions, simply reply to this email; we are always happy to help.
</div>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="120" align="center"><img src="${assetUrl('/img/complete-profiles.png')}" width="80" /></td>
      <td align="center">
        <h4>${data.plan}</h4>
        ${urlButton(data.url, 'Finish Quick Setup', data.settings.theme.primary)}
      </td>
    </tr>
  </tbody>
</table>
<br/>
`
  },
}

module.exports['Transaction Approved'] = {
  level: levels.notice,
  ttl: 370 * 86400, // 6 months worth to serve as payment history report
  key: data => `Transaction Approved : ${data.charge.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.subscription.id}`,
  subject: data => `Payment Receipt: ${data.settings.business} for ${data.subscription?.book?.title || 'New Service Activated'}`,
  body: data => {
    // new signups will not have an assigned book yet
    const book = data.subscription.book || {title: `New Service Activated`}
    let card = 'No charge to payment card'
    if (data.card) {
      card = `Payment card ending ${data.card.last4}`
    }
    return `
<h2>Payment Receipt</h2>
<br/>
The payment for your ${data.settings.business} service was successful.
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="150" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="100" /></td>
      <td>
        <span style="color:#33383b;">${book.title}</span>
        <br/>
        <br/>
        ${data.charge.description} : $${data.charge.dollars}
        <br/>
        <br/>
        ${card}
        <br/>
        <br/>
        Paid on ${date.format(data.charge.ts, 'MMMM dd, YYY')}
      </td>
    </tr>
  </tbody>
</table>
<br/>
Thank you for choosing ${data.settings.business}. You can view the status and
details of your service any time in your account:
<br/>
<br/>
${urlButton(data.url, 'Subscription Details', data.settings.theme.primary)}
<br/>
If you have any questions, please reply to this message to contact support.
`
  },
}

module.exports['Transaction Declined'] = {
  level: levels.warn,
  ttl: 370 * 86400, // 6 months worth to serve as payment history report
  key: data => `Transaction Declined : ${data.charge.id}`,
  url: data => `https://${data.settings.domain}/account/service/${data.subscription.id}`,
  subject: data => `Payment Failed: ${data.settings.business}`,
  body: data => {
    // strange, but possible for someone to have been paying for service without a book
    const book = data.subscription.book || {title: `New Service Activated`}
    const blurb = data.sca
      ? `
The issuing bank for your payment card requires confirmation of this payment.
Once payment has been confirmed, your service will be reactivated.
<br/> <br/> ${urlButton(data.sca, 'Confirm Payment', data.settings.theme.primary)} `
      : `
The payment for your ${data.plan} was declined by your payment card. Please set
a new payment card for your ${data.plan} or update the details for the existing
card. You can view your services on the My Account page.
<br/> <br/> ${urlButton(data.url, 'Service Details', data.settings.theme.primary)}`
    return `
<h2>Payment Declined</h2>
<h3>${data.plan} Deactivated</h3>
<br/>
${blurb}
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="150" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="100" /></td>
      <td>
        <span style="color:#33383b;">${book.title}</span>
        <br/>
        <br/>
        ${data.plan} : $${data.charge.dollars}
        <br/>
        <br/>
        Payment card ending ${data.card.last4}
        <br/>
        <br/>
        Declined on ${date.format(data.charge.ts, 'MMMM dd, YYY')}
      </td>
    </tr>
  </tbody>
</table>
<br/>
If you have any questions, please reply to this message to contact support.
`
  },
}

module.exports['Service Requested'] = {
  level: levels.request,
  ttl: 4 * 86400,
  key: data => `Service Requested : ${data.request.id}`,
  url: data => `https://${data.settings.domain}/account?scope=${data.customer.id}`,
  subject: data => `New Service Request from ${data.customer.fullname}`,
  body: data => {
    const approve = urlButton(`https://${data.settings.domain}/requests/${data.request.id}/approve`, 'Approve', '#090', {width: '150px'})
    const deny = urlButton(`https://${data.settings.domain}/requests/${data.request.id}/deny`, 'Deny', '#900', {width: '150px'})
    return `
<h2>New Service Request</h2>
<h3 style="color: #99989b;">Action Required</h3>
<br/>
<div>Your action is required. A client has requested to immediately add a new service to their ${data.settings.business} account.</div>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="120" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>
      <td>
        <table role="presentation" border="0" cellspacing="10" cellpadding="0">
          <tbody>
            <tr><td style="color: #99989b;" nowrap>Service</td><td width="10">&nbsp;</td><td>${data.plan}</td></tr>
            <tr><td style="color: #99989b;" nowrap valign="top">Client</td><td width="10">&nbsp;</td><td>${data.customer.fullname}<br/>${data.customer.email}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Book</td><td width="10">&nbsp;</td><td>${data.book.title}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Author</td><td width="10">&nbsp;</td><td>${data.book.author.fullname}</td></tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
<br/>
<br/>
<center>
  <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td valign="top">
      ${approve}
      <br/>
      <ul style="font-size: 13px; color: #99989b;">
        <li>New service activated on client's account.</li>
        <li>Client automatically notified of approval.</li>
      </ul>
    </td>
    <td width="40">&nbsp;</td>
    <td valign="top">
      ${deny}
      <br/>
      <ul style="font-size: 13px; color: #99989b;">
        <li>Client automatically notified their request is denied.</li>
        <li>Nothing new added to client's account.</li>
      </ul>
    </td>
  </tr></tbody></table>
</center>
`
  },
}

module.exports['Boost Requested'] = {
  level: levels.request,
  ttl: 4 * 86400,
  key: data => `Boost Requested : ${data.request.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.subscription.id}`,
  subject: data => `New Boost Request from ${data.customer.fullname}`,
  body: data => {
    const approve = urlButton(`https://${data.settings.domain}/requests/${data.request.id}/approve`, 'Approve', '#090', {width: '150px'})
    const deny = urlButton(`https://${data.settings.domain}/requests/${data.request.id}/deny`, 'Deny', '#900', {width: '150px'})
    const award = {
      summary: 'Automatically Targeted',
      due: 'Automatically Targeted',
      fee: 'Automatically Targeted',
    }
    if (data.award) {
      award.summary = `${data.award.name}<br/>${data.award.category}`
      award.fee = `${data.award.currency} ${data.award.fee}`
      award.due = strftime(data.award.dueDate, 'yyyy-MM-dd', {or: 'Open'})
    }
    return `
<h2>New Service Request</h2>
<h3 style="color: #99989b;">Action Required</h3>
<br/>
<div>Your action is required. A client has requested to immediately add a new service to their ${data.settings.business} account.</div>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="120" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>
      <td>
        <table role="presentation" border="0" cellspacing="10" cellpadding="0">
          <tbody>
            <tr><td style="color: #99989b;" nowrap>Boost</td><td width="10">&nbsp;</td><td>${data.plan}</td></tr>
            <tr><td style="color: #99989b;" nowrap valign="top">Client</td><td width="10">&nbsp;</td><td>${data.customer.fullname}<br/>${data.customer.email}</td></tr>
            <tr><td style="color: #99989b;" nowrap valign="top">Book</td><td width="10">&nbsp;</td><td>${data.book.title}<br/> by ${data.book.author.fullname}</td></tr>
            <tr><td style="color: #99989b;" nowrap valign="top">Award</td><td width="10">&nbsp;</td><td>${award.summary}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Due</td><td width="10">&nbsp;</td><td>${award.due}</td></tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
<br/>
<br/>
<center>
  <table role="presentation" border="0" cellspacing="0" cellpadding="0"><tbody><tr>
    <td valign="top">
      ${approve}
      <br/>
      <ul style="font-size: 13px; color: #99989b;">
        <li>New service activated on client's account.</li>
        <li>Client automatically notified of approval.</li>
      </ul>
    </td>
    <td width="40">&nbsp;</td>
    <td valign="top">
      ${deny}
      <br/>
      <ul style="font-size: 13px; color: #99989b;">
        <li>Client automatically notified their request is denied.</li>
        <li>Nothing new added to client's account.</li>
      </ul>
    </td>
  </tr></tbody></table>
</center>
`
  },
}

module.exports['Request Receipt'] = {
  level: levels.request,
  ttl: 10 * 86400,
  key: data => `Request Receipt : ${data.request.id}`,
  url: () => null,
  subject: data => `Request Received for ${data.plan}`,
  body: data => {
    return `
<h2>Request Received</h2>
<br>
Thank you for your request to add a new ${data.plan} to your account. We
will review this request and you will receive a notification when it has been completed.
<br><br>
If you have any questions, please reply to this message to contact support.
`
  },
}

module.exports['Request Approved'] = {
  level: levels.request,
  ttl: 10 * 86400,
  key: data => `Request Approved : ${data.request.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.subscription.id}`,
  subject: data => `Request Approved for ${data.plan}`,
  body: data => {
    return `
<h2>Request Approved</h2>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="150" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>
      <td>
        <span style="color:#33383b;">${data.book.title}</span>
        <br/>
        <br/>
        Service: ${data.plan}
      </td>
    </tr>
  </tbody>
</table>
<br/>
<div>
  Your recent request for a new ${data.plan} has been approved and this
  service is now active on your ${data.settings.business} account. The status of
  your new ${data.plan} is available on your Awards page:
</div>
<br/>
${urlButton(data.url, 'View Awards', data.settings.theme.primary)}
`
  },
}

module.exports['Request Denied'] = {
  level: levels.request,
  ttl: 10 * 86400,
  key: data => `Request Denied : ${data.request.id}`,
  url: () => null,
  subject: data => `Request Denied for ${data.plan}`,
  body: data => {
    return `
<h2>Request Denied</h2>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="150" align="center"><img src="${assetUrl(data.book.cover || '/img/default-book.jpg')}" width="100" /></td>
      <td>
        <span style="color:#33383b;">${data.book.title}</span>
        <br/>
        <br/>
        Denied: ${data.plan}
      </td>
    </tr>
  </tbody>
</table>
<br/>
<div>
  Your recent request for a new ${data.plan} has been denied for your
  ${data.settings.business} account. If you have any questions, please reply to
  this message to contact support. Thank you.
</div>
`
  },
}

module.exports['Pending Requests'] = {
  level: levels.warn,
  ttl: 4 * 86400,
  key: data => `Pending Requests : ${data.user.id}`,
  url: data => `https://${data.settings.domain}/requests?scope=${data.user.id}&view=Pending`,
  subject: () => `Pending Requests`,
  body: data => {
    const row = r => {
      return `
        ${r.requestor.fullname}<br/>
        ${r.requestor.email}<br/>
        ${r.product.name}<br/>
        ${date.format(r.created, 'MMMM dd, YYY')}<br/>
`
    }
    return `
<h2>Pending Requests</h2>
<div>
  The following requests for new service have yet to be approved or denied.
</div>
<br/>
<ul>
  <li>${data.requests.map(row).join('<br/></li><li>')}</li>
</ul>
<br/>
${urlButton(data.url, 'Manage Requests', data.settings.theme.primary)}
`
  },
}

module.exports['Card Expiring'] = { // TODO: spec calls for this to re-trigger but I don't know how
  level: levels.warn,
  ttl: 25 * 86400,
  key: data => `Card Expiring : ${data.card.id}`,
  url: data => `https://${data.settings.domain}/account`,
  subject: data => `Payment Card Expiring for ${data.settings.business}`,
  body: data => {
    return `
<h2>Payment Card Expiring Soon</h2>
<div>
  A payment card on your ${data.settings.business} account is expiring soon.
  Please update this card or replace it with a new payment method.
</div>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="120" align="center"><img src="${assetUrl('/img/card-expiring.png')}" width="80" /></td>
      <td>
        <h4>Card Details</h4>
        <table role="presentation" border="0" cellspacing="5" cellpadding="0">
          <tbody>
            <tr><td style="color: #99989b;" nowrap>Brand</td><td width="10">&nbsp;</td><td>${data.card.brand}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Number</td><td width="10">&nbsp;</td><td>**** ${data.card.last4}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Expires</td><td width="10">&nbsp;</td><td>${data.card.exp_month < 10 ? '0' : ''}${data.card.exp_month} / ${data.card.exp_year}</td></tr>
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
<br/>
${urlButton(data.url, 'View Payment Cards', data.settings.theme.primary)}
<br/>
`
  },
}

const AVATARS = [
  'amelie-poulain-96.png',
  'beyonce-96-2.png',
  'beyonce-96.png',
  'bodyguard-male-96.png',
  'bride-with-veil-96.png',
  'courage-96.png',
  'don-quixote-96.png',
  'guitarist-96.png',
  'jacques-yves-cousteau-96.png',
  'man-96.png',
  'man-artist-96.png',
  'man-beard-96.png',
  'man-blond-hair-96.png',
  'man-bouncing-ball-96.png',
  'man-cook-96.png',
  'man-curly-hair-dark-skin-tone-96.png',
  'man-curly-hair-light-skin-tone-96.png',
  'man-curly-hair-medium-dark-skin-tone-96.png',
  'man-curly-hair-medium-light-skin-tone-96.png',
  'man-curly-hair-medium-skin-tone-96.png',
  'man-dark-skin-tone-96.png',
  'man-farmer-96.png',
  'man-juggling-96.png',
  'man-lifting-weights-96.png',
  'man-light-skin-tone-96.png',
  'man-mechanic-96.png',
  'man-medium-dark-skin-tone-96.png',
  'man-medium-light-skin-tone-96.png',
  'man-medium-skin-tone-96.png',
  'man-pilot-96.png',
  'man-playing-handball-96.png',
  'man-playing-water-polo-96.png',
  'man-running-96.png',
  'man-scientist-96.png',
  'man-singer-96.png',
  'man-superhero-96.png',
  'man-technologist-96.png',
  'man-wearing-turban-96.png',
  'man-with-beard-dark-skin-tone-96.png',
  'man-with-beard-light-skin-tone-96.png',
  'man-with-beard-medium-dark-skin-tone-96.png',
  'man-with-beard-medium-light-skin-tone-96.png',
  'man-with-beard-medium-skin-tone-96.png',
  'man-with-chinese-cap-96.png',
  'man-with-mustache-dark-skin-tone-96.png',
  'man-with-mustache-light-skin-tone-96.png',
  'man-with-mustache-medium-dark-skin-tone-96.png',
  'man-with-mustache-medium-light-skin-tone-96.png',
  'man-with-mustache-medium-skin-tone-96.png',
  'mermaid-emoji-96.png',
  'merperson-96.png',
  'monarch-96.png',
  'morty-smith-96.png',
  'neutral-person-dark-skin-tone-96.png',
  'neutral-person-light-skin-tone-96.png',
  'neutral-person-medium-dark-skin-tone-96.png',
  'neutral-person-medium-light-skin-tone-96.png',
  'neutral-person-medium-skin-tone-96.png',
  'old-lady-96.png',
  'old-man-96.png',
  'old-man-dark-skin-tone-96.png',
  'old-man-light-skin-tone-96.png',
  'old-man-medium-dark-skin-tone-96.png',
  'old-man-medium-light-skin-tone-96.png',
  'old-man-medium-skin-tone-96.png',
  'old-person-96.png',
  'old-woman-dark-skin-tone-96.png',
  'old-woman-medium-dark-skin-tone-96.png',
  'old-woman-medium-light-skin-tone-96.png',
  'old-woman-medium-skin-tone-96.png',
  'older-person-96.png',
  'older-person-dark-skin-tone-96.png',
  'older-person-light-skin-tone-96.png',
  'older-person-medium-dark-skin-tone-96.png',
  'older-person-medium-light-skin-tone-96.png',
  'older-person-medium-skin-tone-96.png',
  'person-96.png',
  'person-artist-96.png',
  'person-astronaut-96.png',
  'person-bald-96.png',
  'person-biking-96.png',
  'person-blond-hair-96.png',
  'person-bouncing-ball-96.png',
  'person-cook-96.png',
  'person-curly-hair-96.png',
  'person-detective-96.png',
  'person-factory-worker-96.png',
  'person-farmer-96.png',
  'person-feeding-baby-96.png',
  'person-firefighter-96.png',
  'person-gesturing-ok-96.png',
  'person-getting-haircut-96.png',
  'person-getting-massage-96.png',
  'person-golfing-96.png',
  'person-guard-96.png',
  'person-health-worker-96.png',
  'person-in-lotus-position-96.png',
  'person-in-manual-wheelchair-96.png',
  'person-in-motorized-wheelchair-96.png',
  'person-in-steamy-room-96.png',
  'person-in-tuxedo-96.png',
  'person-judge-96.png',
  'person-juggling-96.png',
  'person-lifting-weights-96.png',
  'person-mechanic-96.png',
  'person-mountain-biking-96.png',
  'person-office-worker-96.png',
  'person-pilot-96.png',
  'person-playing-handball-96.png',
  'person-playing-water-polo-96.png',
  'person-police-officer-96.png',
  'person-red-hair-96.png',
  'person-rowing-boat-96.png',
  'person-scientist-96.png',
  'person-singer-96.png',
  'person-supervillain-96.png',
  'person-teacher-96.png',
  'person-technologist-96.png',
  'person-white-hair-96.png',
  'person-with-veil-96.png',
  'prince-96.png',
  'princess-96.png',
  'queen-elizabeth-96.png',
  'relax-with-book-96.png',
  'skier-emoji-96.png',
  'sophia-loren-96.png',
  'superhero-96.png',
  'supervillain-96.png',
  'taylor-swift-96.png',
  'themis-96.png',
  'violinist-96.png',
  'wizard-96.png',
  'woman-artist-96.png',
  'woman-bouncing-ball-96.png',
  'woman-cook-96.png',
  'woman-farmer-96.png',
  'woman-juggling-96.png',
  'woman-mechanic-96.png',
  'woman-pilot-96.png',
  'woman-playing-handball-96.png',
  'woman-running-96.png',
  'woman-scientist-96.png',
  'woman-singer-96.png',
  'woman-standing-96.png',
  'woman-student-96.png',
  'woman-superhero-96.png',
  'woman-supervillain-96.png',
  'woman-technologist-96.png',
  'woman-with-headscarf-96.png',
]

function randomAvatar() {
  return assetUrl(`/img/avatars/${AVATARS[randomInt(AVATARS.length)]}`)
}

module.exports['New User'] = {
  level: levels.warn,
  ttl: 33 * 86400,
  key: data => `New User : ${data.customer.id}`,
  customerId: data => data.customer.id,
  isInternal: true,
  url: data => `https://${data.settings.domain}?scope=${data.customer.id}`,
  subject: data => `[New User] Account created for ${data.settings.business}`,
  body: data => {
    const avatar = randomAvatar()
    let coupon = ''
    if (data.coupon) {
      coupon = `<tr><td style="color: #99989b;" nowrap>Coupon</td><td width="10">&nbsp;</td><td>${data.coupon}</td></tr>`
    }
    let affiliate = ''
    if (data.affiliate) {
      affiliate = `<tr><td style="padding: 5px; color: #fff; background: #f00" nowrap>Affiliate</td><td width="10">&nbsp;</td><td>${data.affiliate.fullname} (${data.affiliate.id})</td></tr>`
    }
    return `
<h2>New Account Created</h2>
<table role="presentation" border="0" cellspacing="0" cellpadding="10">
  <tbody>
    <tr>
      <td width="120" align="center"><img src="${assetUrl(avatar)}" width="80" /></td>
      <td>
        <h3>${data.settings.business}</h3>
        <table role="presentation" border="0" cellspacing="5" cellpadding="0">
          <tbody>
            <tr><td style="color: #99989b;" nowrap>Name</td><td width="10">&nbsp;</td><td>${data.customer.fullname}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Email</td><td width="10">&nbsp;</td><td>${data.customer.email}</td></tr>
            <tr><td style="color: #99989b;" nowrap>Plan</td><td width="10">&nbsp;</td><td>${data.plan || 'No Plan'}</td></tr>
            ${coupon}
            ${affiliate}
          </tbody>
        </table>
      </td>
    </tr>
  </tbody>
</table>
<br/>
${urlButton(data.url, 'View New Account', data.settings.theme.primary)}
<br/>
`
  },
}

module.exports['Referral Payouts'] = {
  level: levels.warn,
  ttl: 90 * 86400,
  key: () => `Referral Payouts : ${date.format(new Date(), 'yyyy-MM-dd')}`,
  isInternal: true,
  url: data => `https://${data.settings.domain}/am`,
  subject: () => `[Referrals] Monthly Payouts`,
  body: data => {
    const paypal = i => `${i.email},${i.total},USD`
    const credit = i => `${i.name} (${i.email}) $${i.total} for <a href="https://dashboard.stripe.com/customers/${i.stripeId}/balance_transactions">${i.count} referrals</a>`
    return `
<h2>Monthly Payouts and Account Credits</h2>
<h3 style="color: #99989b;">Action Required</h3>
<h2>PayPal Payouts</h2>
For referrals which are to be paid via cash, the payouts CSV file must be manually uploaded to PayPal for use with their "Payouts" service.
<br/>
<br/>
---
<br/>
${data.paypal.map(paypal).join('\n') || 'NO PAYPAL REFERRALS NEED TO BE PAID'}
<br/>
---
<br/>
<br/>
<h2>Account Credits</h2>
The following credits for referrals have been applied to Book Award Pro accounts:
<ul>
  <li>${data.credits.map(credit).join('</li><li>') || 'NO CREDIT REFERRALS NEED TO BE PAID'}</li>
</ul>
`
  },
}

module.exports['Book Update Reminder'] = {
  level: levels.warn,
  ttl: 30 * 86400,
  key: data => `Book Update Reminder : ${data.user.id}`,
  url: data => `https://${data.settings.domain}?scope=${data.user.id}`,
  subject: () => 'Awards Reminder: Review Your Book Profile',
  body: data => {
    return `
<h2>Keep Your Account Up-to-Date</h2>
<br/>
Matching your book for the best award opportunities requires accurate
information. If you have not done so recently, please review the details on your
${data.settings.business} account.
<br/>
${data.books.map(book => `
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="0">
  <tbody>
    <tr>
      <td width="80" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="80" /></td>
      <td width="10">&nbsp;</td>
      <td>
        ${book.title}
        <br/>
        <table role="presentation" border="0" cellspacing="10" cellpadding="0"><tbody>
          <tr>
            <td><img src="${assetUrl('/img/icons/book-profile.png')}" width="20" style="display: block"/></td>
            <td><a href="https://${data.settings.domain}/books/update/${book.id}">Review Book Profile</a></td>
          </tr>
          <tr>
            <td><img src="${assetUrl('/img/icons/author-profile.png')}" width="20" style="display: block"/></td>
            <td><a href="https://${data.settings.domain}/authors/update/${book.authorId}"> Review Author Profile</a></td>
          </tr>
        </tbody></table>
        <span style="font-size: 12px; color: #99989b;">
          Updated: ${date.format(book.modified, 'MMMM dd, YYY')}
        </span>
      </td>
    </tr>
  </tbody>
</table>
`).join('')}
`
  },
}

module.exports['Author Award Winner'] = {
  level: levels.notice,
  ttl: 90 * 86400,
  key: data => `Author Award Winner : ${data.ann.id} : ${data.match.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.match.subscriptionId}/match/${data.match.id}`,
  subject: data => `Award-Winning News about ${data.match.award.name}`,
  body: async data => {
    const book = data.match.book
    const award = data.match.award
    const files = {...data.ann.files}
    const cond = {
      email: '',
      url: '',
      notes: '',
      files: '',
      connect: '',
    }
    if (award.email) {
      cond.email = `<b>&middot; Award Contact:</b><br/> &nbsp; ${award.email}<br/><br/>`
    }
    if (data.ann.url) {
      cond.url = `<b>&middot; Award Announcement:</b><br/> &nbsp; ${data.ann.url}<br/><br/><br/>`
    }
    if (data.ann.notes) {
      cond.notes = `The following information has been provided by ${award.name}:<br/><br/><div class="email-markdown" style="padding: 10px; border-left: 3px solid #cccccc">${await markdown2html(data.ann.notes)}</div><br/><br/>`
    }
    if (data.settings.enterprise) {
      delete files.howto
    } else {
      cond.connect = `This is exciting news to share with your audience. Make the most of your award win by
        <a href="https://${data.settings.domain}/connect">connecting with readers</a>.<br/><br/>`
    }
    const seal = assetUrl(files.seal || _.get(data.settings, 'theme.seals.winner', '/img/seals/winner.png'))
    const cover = book.cover ? `<td width="200" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="150" /></td>` : ''
    if (Object.keys(files).length) {
      cond.files = 'Some additional files have been provided as part of your award win. Click the following to download:<ul>'
      const labels = {
        seal: 'Award Seal',
        howto: 'Make the Most of Your Win',
        misc: 'Other Award File',
      }
      _.each(files, (url, slot) => {
        const label = labels[slot]
        if (label) {
          cond.files += `<li> <a href="https://${data.settings.domain}${url}">${label}</a></li>`
        }
      })
      cond.files += `</ul>Additionally, award files are available any time in your ${data.settings.business} account.
        Click the button below to view all documents related to your ${award.name} submission.<br/><br/>`
    }
    return `
<h1>Award-Winning News</h1>
<br/>
Hi ${data.user.nickname},
<br/>
<br/>
We are honored to share the news that your book has been announced a winner in ${award.name}.
Congratulations! There is a lot of important information about your award win below.
<br/>
<br/>
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="20"><tbody><tr>
  ${cover}<td><img src="${seal}" style="min-width: 200px; max-width: 250px; min-height: 200px; max-height: 250px;"/></td>
</tr></tbody></table>
<br/>
<br/>
<center>
  <h3>${book.title} new winner of ${award.name}</h3>
</center>
${cond.connect}
Below, we have included more details about your award win. If you have any questions regarding
this announcement, we encourage you to get in touch directly with the award organization.
<br/>
<br/>
Congratulations once again! We are honored to support you in your award-winning journey.
<br/>
<br/>
Awardingly,
<br/>
${data.settings.business} Team
<br/>
<br/>
<br/>
<div style="width: 100%; border: 1px solid #cccccc; border-radius: 5px; background-color: #f2f4f6;">
  <h3 style="margin: 20px">Details About Your Win</h3>
</div>
<br/>
${cond.email}
${cond.url}
${cond.notes}
${cond.files}
<br/>
<br/>
${urlButton(data.url, 'View Award Details', data.settings.theme.primary)}
<br/>
`
  },
}

module.exports['Author Award Update'] = {
  level: levels.notice,
  ttl: 90 * 86400,
  key: data => `Author Award Update : ${data.ann.id} : ${data.match.id}`,
  url: data => `https://${data.settings.domain}/awards/${data.match.subscriptionId}/match/${data.match.id}`,
  subject: data => `Update about ${data.match.award.name}`,
  body: async data => {
    const book = data.match.book
    const award = data.match.award
    const cond = {
      email: '',
      notes: '',
      files: '',
    }
    if (award.email) {
      cond.email = `<b>&middot; Award Contact:</b><br/> &nbsp; ${award.email}<br/><br/>`
    }
    if (data.ann.notes) {
      cond.notes = `The following information has been provided by ${award.name}:<br/><br/><div class="email-markdown" style="padding: 10px; border-left: 3px solid #cccccc">${await markdown2html(data.ann.notes)}</div><br/><br/>`
    }
    const cover = book.cover ? `<td width="200" align="center"><img src="${assetUrl(book.cover || '/img/default-book.jpg')}" width="150" /></td>` : ''
    if (data.ann.files.misc) {
      cond.files = `${award.name} has provided a file with your update.  Click the following to download:
        <ul><li> <a href="https://${data.settings.domain}${data.ann.files.misc}">File from the Award</a></li></ul>
        Additionally, award update files are available any time in your ${data.settings.business} account.
        Click the button below to view all documents related to your ${award.name} submission.<br/><br/>
        ${urlButton(data.url, 'View Award Details', data.settings.theme.primary)}<br/><br/>`
    }
    return `
<h1>Award Update</h1>
<br/>
Hi ${data.user.nickname},
<br/>
<br/>
Included with your professional submission to ${award.name}, we track your book's progress and keep you informed
of any bonus benefits or updates along the way. Below, we have included information from the award.
<br/>
<br/>
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="20"><tbody><tr>
  ${cover}
  <td>
    <h3>${book.title}</h3>
    <div style="color: #99989b;">Award:</div>${award.name}
    <br/>
    <br/>
    <div style="color: #99989b;">Category:</div>${award.category}
  </td>
</tr></tbody></table>
<br/>
<br/>
<br/>
<br/>
${cond.notes}
${cond.files}
${cond.email}
If you have any questions regarding this update, we encourage you to get in touch directly with the award organization.
We are honored to work with you along your book's journey.
<br/>
<br/>
Awardingly,
<br/>
${data.settings.business} Team
<br/>
<br/>
`
  },
}

module.exports['Partner Award Winners'] = {
  level: levels.notice,
  ttl: 33 * 86400,
  key: data => `Partner Award Winners : ${data.ann.id} : ${data.users.map(i => i.subscriptionId).join(',')}`,
  url: data => `https://${data.settings.domain}`,
  subject: data => `[Clients Notified] Award Win for ${data.award.name}`,
  body: async data => {
    const award = data.award
    const seal = assetUrl(data.ann.files.seal || _.get(data.settings, 'theme.seals.winner', '/img/seals/winner.png'))
    const cond = {
      email: '',
      url: '',
      notes: '',
    }
    if (award.email) {
      cond.email = `<b>&middot; Award Contact:</b><br/> &nbsp; ${award.email}<br/><br/>`
    }
    if (data.ann.url) {
      cond.url = `<b>&middot; Award Announcement:</b><br/> &nbsp; ${data.ann.url}<br/><br/><br/>`
    }
    if (data.ann.notes) {
      cond.notes = `The following information has been provided by ${award.name}:<br/><br/><div class="email-markdown" style="padding: 10px; border-left: 3px solid #cccccc">${await markdown2html(data.ann.notes)}</div><br/><br/>`
    }
    let users = '<table role="presentation" border="0" cellspacing="10" cellpadding="10"><tbody>'
    for (const user of data.users) {
      users += '<tr>'
      users += `<td><img src="${assetUrl(user.book.cover || '/img/default-book.jpg')}" height="60"/></td>`
      users += `<td><a href="https://${data.settings.domain}/awards/${user.subscriptionId}">${user.book.title}<br/>${user.fullname}</a></td>`
      users += '</tr>'
    }
    users += '</tbody></table>'
    return `
<h1>Award Win Details Sent</h1>
<br/>
This notification is to keep you apprised of your clients' award-winning success in ${award.name}.
<br/>
<br/>
Included with our submission services, we track progress and keep your clients informed of their award-winning news.
<br/>
<br/>
<br/>
<br/>
<table role="presentation" border="0" cellspacing="0" cellpadding="20" border="1"><tbody><tr>
  <td><h3>Award Winners Notified</h3></td>
  <td><img src="${seal}" style="min-width: 100px; max-width: 200px; min-height: 100px; max-height: 200px;"/></td>
</tr></tbody></table>
<br/>
<br/>
${users}
<br/>
<br/>
<div style="width: 100%; border: 1px solid #cccccc; border-radius: 5px; background-color: #f2f4f6;">
  <h3 style="margin: 20px">Copy of Award Win Details</h3>
</div>
<br/>
${cond.email}
${cond.url}
${cond.notes}
If you have any questions regarding this announcement, we encourage you to get in touch directly
with the award organization. We are honored to support you in your award-winning journey.
<br/>
<br/>
Awardingly,
<br/>
${data.settings.business} Team
<br/>
<br/>
`
  },
}

module.exports['Partner Award Update'] = {
  level: levels.notice,
  ttl: 33 * 86400,
  key: data => `Partner Award Update : ${data.ann.id} : ${data.users.map(i => i.subscriptionId).join(',')}`,
  url: data => `https://${data.settings.domain}`,
  subject: data => `[Clients Notified] Update about ${data.award.name}`,
  body: async data => {
    const award = data.award
    const cond = {
      email: '',
      notes: '',
      files: '',
    }
    if (award.email) {
      cond.email = `<b>&middot; Award Contact:</b><br/> &nbsp; ${award.email}<br/><br/>`
    }
    if (data.ann.notes) {
      cond.notes = `The following information has been provided by ${award.name}:<br/><br/><div class="email-markdown" style="padding: 10px; border-left: 3px solid #cccccc">${await markdown2html(data.ann.notes)}</div><br/><br/>`
    }
    if (data.ann.files.misc) {
      cond.files = `${award.name} has provided a file with your update.  Click the following to download:
        <ul><li> <a href="${assetUrl(data.ann.files.misc)}">File from the Award</a></li></ul>
        Additionally, award update files are available any time in your ${data.settings.business} account.<br/><br/>`
    }
    let users = '<table role="presentation" border="0" cellspacing="10" cellpadding="10"><tbody>'
    for (const user of data.users) {
      users += '<tr>'
      users += `<td><img src="${assetUrl(user.book.cover || '/img/default-book.jpg')}" height="60"/></td>`
      users += `<td><a href="https://${data.settings.domain}/awards/${user.subscriptionId}">${user.book.title}<br/>${user.fullname}</a></td>`
      users += '</tr>'
    }
    users += '</tbody></table>'
    return `
<h1>Award Update Sent</h1>
<br/>
This notification is to keep you apprised of your clients' book award progress for submissions in ${award.name}.
<br/>
<br/>
Included with our submission services, we track progress and keep your clients informed of any bonus benefits or updates they receive.
<br/>
<br/>
<h3>Clients Notified:</h3>
${users}
<br/>
<br/>
<div style="width: 100%; border: 1px solid #cccccc; border-radius: 5px; background-color: #f2f4f6;">
  <h3 style="margin: 20px">Copy of Award Update</h3>
</div>
<br/>
${cond.notes}
${cond.files}
${cond.email}
If you have any questions regarding this update, we encourage you to get in touch directly
with the award organization. We are honored to work with you along your book's journey.
<br/>
<br/>
Awardingly,
<br/>
${data.settings.business} Team
<br/>
<br/>
`
  },
}

module.exports['Contact Info for Winners'] = {
  level: levels.notice,
  ttl: 33 * 86400,
  key: data => `Contact Info for Winners : ${data.users.map(i => i.id).join(',')}`,
  url: data => `https://${data.settings.domain}`,
  subject: () => 'Contact Information for Winners',
  body: data => {
    const award = data.award
    let users = '<table role="presentation" border="0" cellspacing="10" cellpadding="10"><tbody>'
    for (const user of data.users) {
      let address = 'No address on file'
      if (user.author.address) {
        address = user.author.address.replace(/[\n\r]+/ug, ', ')
      }
      users += `<tr>
        <td align="center"><img src="${assetUrl(user.book.cover || '/img/default-book.jpg')}" height="100"/></td>
        <td>
          <b>${user.book.title}</b>
          <br/>
          <div style="color: #99989b;">Author:</div>${user.author.fullname} (${user.author.email})
          <br/>
          <div style="color: #99989b;">Address:</div>${address}
        </td>
      </tr>`
    }
    users += '</tbody></table>'
    return `
<h1>Winner Contact Information</h1>
<br/>
Thank you for the recent ${award.name} announcement. We have shared the exciting details with our newly winning authors,
as well as your contact information for any additional questions they may have.
<br/>
<br/>
Below, we have included the contact information for each winning author so you may communicate directly with them for any future updates.
We have also included any mailing address information we have on file for each author.
<br/>
<br/>
Thank you again for sharing this news and for celebrating authors. We are delighted to continue forging an award-winning future together.
<br/>
<br/>
Awardingly,
<br/>
${data.settings.business} Team
<br/>
<br/>
<br/>
<div style="width: 100%; border: 1px solid #cccccc; border-radius: 5px; background-color: #f2f4f6;">
  <h3 style="margin: 20px">List of Winners:</h3>
</div>
<br/>
${users}
<br/>
`
  },
}

module.exports['Testimonial Request'] = {
  level: levels.notice,
  ttl: 33 * 86400,
  key: data => `Testimonial Request : ${data.user.id} : ${data.testimonial.attempt}`,
  url: () => null,
  subject: () => 'Award-Winning Testimonial',
  plain: true,
  body: data => {
    return `
Dear ${data.user.nickname},

Congratulations once again on your recent award-winning success! We are so excited to see you receive praise and recognition for ${data.book.title}.

In honor of your win, would you have a few minutes to provide a brief testimonial?

We would appreciate if you could send us a couple of sentences about your experience with (and perhaps recommendation of) Book Award Pro. We love hearing from our authors directly about their experiences with our service!

Thank you for your time and for the honor to support you in your award-winning journey.


Awardingly,

Hannah

--
Hannah Jacobson
Founder of Book Award Pro
https://bookawardpro.com
`
  },
}

module.exports['How Did You Hear'] = {
  level: levels.notice,
  ttl: 33 * 86400,
  key: data => `How Did You Hear : ${data.user.id}`,
  url: () => null,
  subject: () => 'Welcome to Book Award Pro!',
  plain: true,
  body: data => {
    return `
Hi ${data.user.nickname},

Thank you for joining us. My name is Nour, and I am an Author Success Manager here at Book Award Pro. I am writing to personally extend a warm welcome and to let you know that we are here if you have any questions along the way.

If you have a moment, we would love to know how you heard about Book Award Pro. Your feedback is incredibly important to us, and we would sincerely appreciate hearing your thoughts.

We are truly honored to support you along your award-winning journey.


Awardingly,

Nour

--
Nour Youssef
Author Success @ Book Award Pro
https://bookawardpro.com
`
  },
}
