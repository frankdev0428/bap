#! /usr/bin/env node

const USAGE = `
Generate sample emails and send.

Usage: COMMAND [options] [<emails>...]

Options:
  -v, --verbosity LEVEL
    trace, debug, info, warn, error, fatal [default: warn]
  -n, --dry-run
    Only print emails, do not send
`
const argv = require('docopt').docopt(USAGE)
const config = {
  verbosity: argv['--verbosity'],
  dryrun: argv['--dry-run'],
  emails: argv['<emails>'],
}

const bunyan = require('bunyan')
const log = bunyan.createLogger({
  name: process.argv[1].split('/').pop(),
  level: bunyan[config.verbosity.toUpperCase()],
})

const {assetUrl} = require('@bap/cotton/lib')
const date = require('date-fns')
const {Sequelize} = require('sequelize')
const sequelize = new Sequelize({
  logging(msg) {
    log.debug(msg)
  },
  dialect: 'postgres',
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  database: process.env.PGNAME,
  username: process.env.PGUSER,
  password: process.env.PASSWORD,
})

const enabled = s => config.emails.length === 0 || config.emails.includes(s)

const AWARD_NOTES = `
# EXCELLENT!

I WANT ROOM SERVICE! I WANT THE **CLUB** SANDWICH, I WANT THE COLD *MEXICAN* BEER, I WANT A \`$10,000-A-NIGHT\` HOOKER!

> IF WE'RE GONNA WASTE THE DUDE, WE OUGHTA GET PAID FOR IT. I MEAN, THAT'S THE AMERICAN WAY, RIGHT?

## WHAT DOES A SCANNER SEE? [^1]

- [x] INTO THE HEAD? DOWN INTO THE HEART? DOES IT SEE INTO ME? INTO US? CLEARLY OR DARKLY?
- [x] HEAVEN AND HELL ARE RIGHT HERE, BEHIND EVERY WALL, EVERY WINDOW, THE WORLD BEHIND THE WORLD. AND WE'RE SMACK IN THE MIDDLE.
- [ ] I WISH I COULD SAY SOMETHING CLASSY AND INSPIRATIONAL, BUT THAT JUST WOULDN'T BE OUR STYLE. PAIN HEALS. CHICKS DIG SCARS. GLORY LASTS FOREVER.

### SHOOT THE HOSTAGE!
---

YOU EVER HAVE THAT FEELING WHERE YOU'RE NOT SURE IF YOU'RE AWAKE OR STILL DREAMING?  PEOPLE KEEP ASKING IF I'M BACK AND I HAVEN'T REALLY HAD AN ANSWER. BUT NOW, YEAH, I'M THINKING I'M BACK! [WHOA!](https://imgflip.com/i/5vzy6t)

![WHOA](https://i.imgflip.com/5vzy6t.jpg)

[^1]: made you look 😂
`

async function main() {
  const libmail = require('@bap/cotton/lib/mail')({log, sequelize})
  const cover = assetUrl('/img/demo/cover.jpg')

  if (enabled('Password Recovery')) {
    await libmail.test('Password Recovery', {
      token: 'abc123',
    })
    log.warn('SENT:', 'Password Recovery')
  }

  if (enabled('Password Reset')) {
    await libmail.test('Password Reset', {})
    log.warn('SENT:', 'Password Reset')
  }

  if (enabled('New Signup')) {
    await libmail.test('New Signup', {
      plan: 'Pro Plan',
    })
    log.warn('SENT:', 'New Signup')
  }

  if (enabled('New Referral')) {
    await libmail.test('New Referral', {
      referral: {
        id: 33,
      },
      payout: 33.33,
    })
    log.warn('SENT:', 'New Referral')
  }

  if (enabled('Subscription Canceled')) {
    await libmail.test('Subscription Canceled', {
      subscription: {
        id: 33,
        name: 'Test Plan',
        end: '2021-07-07',
      },
      plan: 'Pro Plan',
      book: {
        cover,
        title: 'Demo in the Rye',
      },
    })
    log.warn('SENT:', 'Subscription Canceled')
  }

  if (enabled('Published Book')) {
    await libmail.test('Published Book', {
      book: {
        cover,
        id: 33,
        title: 'Demo in the Rye',
        pubDate: new Date(),
      },
    })
    log.warn('SENT:', 'Published Book')
  }

  if (enabled('Unconfigured Subscription')) {
    await libmail.test('Unconfigured Subscription', {
      subscription: {
        id: 10,
      },
      plan: 'Essentials Plan',
    })
    log.warn('SENT:', 'Unconfigured Subscription')
  }

  if (enabled('Subscription Expiring')) {
    await libmail.test('Subscription Expiring', {
      subscription: {
        id: 10,
        end: date.add(new Date(), {days: 20}),
      },
      plan: 'Pro Non-Recurring - 6-Months',
      customer: {
        fullname: 'Edgar Allan Poe',
        email: 'partner-sub-demo@awardmatch.com',
      },
      book: {
        cover,
        title: 'Demo in the Rye',
        author: {
          fullname: 'Robert Frost',
        },
      },
    })
    log.warn('SENT:', 'Subscription Expiring')
  }

  if (enabled('Transaction Approved')) {
    await libmail.test('Transaction Approved', {
      charge: {
        id: 0,
        ts: new Date(),
        dollars: 199,
        description: 'Submit Boost',
      },
      card: {
        last4: '4242',
      },
      subscription: {
        id: 10,
        book: {
          cover,
          title: 'Demo in the Rye',
        },
      },
    })
    log.warn('SENT:', 'Transaction Approved')
  }

  if (enabled('Transaction Declined')) {
    await libmail.test('Transaction Declined', {
      plan: 'Test Plan',
      charge: {
        id: 0,
        ts: new Date(),
        dollars: 199,
      },
      card: {
        last4: '4242',
      },
      subscription: {
        id: 10,
        book: {
          cover,
          title: 'Demo in the Rye',
        },
      },
      sca: 'https://invoice.stripe.com/i/acct_19SitOADNtrRET4E/test_YWNjdF8xOVNpdE9BRE50clJFVDRFLF9MUnI4S1huakFKcFoyNFd2Z05BYUtQSGgxV0NHNVBRLDM5NjQ4NDI402008hnfUP9V?s=ap',
    })
    log.warn('SENT:', 'Transaction Declined')
  }

  if (enabled('Card Expiring')) {
    await libmail.test('Card Expiring', {/* eslint-disable camelcase */
      card: {
        brand: 'Visa',
        last4: '4242',
        exp_month: 6,
        exp_year: 2024,
      },
    })
    log.warn('SENT:', 'Card Expiring')
  }

  if (enabled('Request Receipt')) {
    await libmail.test('Request Receipt', {
      plan: 'Test Plan',
      product: {
        id: 33,
        name: 'Test Plan',
      },
      request: {
        id: 42,
      },
    })
    log.warn('SENT:', 'Request Receipt')
  }

  if (enabled('Service Requested')) {
    await libmail.test('Service Requested', {
      plan: 'Test Plan',
      request: {
        id: 42,
      },
      customer: {
        fullname: 'Edgar Allan Poe',
        email: 'partner-sub-demo@awardmatch.com',
      },
      book: {
        cover,
        title: 'The Demo in the Rye',
        author: {
          fullname: 'Demo Author',
        },
      },
    })
    log.warn('SENT:', 'Service Requested')
  }

  if (enabled('Boost Requested')) {
    await libmail.test('Boost Requested', {
      plan: 'Submit Boost',
      request: {
        id: 42,
      },
      subscription: {
        id: 10,
      },
      award: {
        id: 0,
        name: 'Love Is Lit',
        category: 'Longest Category to Test Spacing',
        dueDate: new Date(),
        currency: 'USD $',
        fee: 99,
      },
      customer: {
        fullname: 'Edgar Allan Poe',
        email: 'partner-sub-demo@awardmatch.com',
      },
      book: {
        cover,
        title: 'Demo in the Rye',
        author: {
          fullname: 'Robert Frost',
        },
      },
    })
    log.warn('SENT:', 'Boost Requested')
  }

  if (enabled('Request Approved')) {
    await libmail.test('Request Approved', {
      request: {
        id: 33,
      },
      plan: 'Test Plan',
      subscription: {
        id: 10,
      },
      book: {
        cover,
        title: 'Demo in the Rye',
      },
    })
    log.warn('SENT:', 'Request Approved')
  }

  if (enabled('Request Denied')) {
    await libmail.test('Request Denied', {
      request: {
        id: 33,
      },
      plan: 'Test Plan',
      subscription: {
        id: 10,
      },
      book: {
        cover,
        title: 'Demo in the Rye',
      },
    })
    log.warn('SENT:', 'Request Denied')
  }

  if (enabled('Pending Requests')) {
    await libmail.test('Pending Requests', {
      requests: [
        {
          requestor: {fullname: 'Edgar Allan Poe', email: 'partner-sub-demo@awardmatch.com'},
          product: {name: 'Essentials Plan'},
          created: new Date(),
        },
        {
          requestor: {fullname: 'Edgar Allan Poe', email: 'partner-sub-demo@awardmatch.com'},
          product: {name: 'Submit Boost'},
          created: new Date(),
        },
      ],
    })
    log.warn('SENT:', 'Pending Requests')
  }

  if (enabled('New Award Match')) {
    await libmail.test('New Award Match', {
      subscriptionId: 33,
      book: {
        cover,
        title: 'Demo in the Rye',
      },
      matches: [
        {
          name: 'Modern Man',
          category: 'Love Is Lit',
          dueDate: new Date(),
        },
        {
          name: 'The BAP Gun',
          category: 'Humor',
          dueDate: new Date(),
        },
      ],
    })
    log.warn('SENT:', 'New Award Match')
  }

  if (enabled('Candidate Targeted')) {
    await libmail.test('Candidate Targeted', {
      target: {
        id: 10,
        subscriptionId: 33,
        created: new Date(),
      },
      customer: {
        fullname: 'Edgar Allan Poe',
        email: 'partner-sub-demo@awardmatch.com',
      },
      award: {
        name: 'Love Is Lit',
        category: 'Longest Category to Test Spacing',
        dueDate: new Date(),
      },
      book: {
        cover,
        title: 'Demo in the Rye',
      },
      plan: 'Pro Plan',
    })
    log.warn('SENT:', 'Candidate Targeted')
  }

  if (enabled('New Submission')) {
    await libmail.test('New Submission', {
      target: {
        id: 10,
        subscriptionId: 33,
      },
      customer: {
        fullname: 'Edgar Allan Poe',
        email: 'partner-sub-demo@awardmatch.com',
      },
      award: {
        name: 'Love Is Lit',
        category: 'Longest Category to Test Spacing',
        dueDate: new Date(),
        website: 'https://www.modern-man-awards.com/submissions?some_option=cool+beans',
        submitNotes: 'Always select the $33 option, no matter the actual page count of a book, because 33 is the magic number.',
        bapFee: 33,
      },
      book: {
        cover,
        title: 'Demo in the Rye',
      },
      plan: 'Pro Plan',
    })
    log.warn('SENT:', 'New Submission')
  }

  if (enabled('Targeting Complete')) {
    await libmail.test('Targeting Complete', {
      target: {
        subscription: {
          id: 33,
        },
        submitBy: date.addDays(new Date(), 4),
        book: {
          cover,
          title: 'Demo in the Rye',
        },
        award: {
          name: 'The BAP Gun',
          category: 'Humor',
          dueDate: new Date(),
        },
      },
    })
    log.warn('SENT:', 'Targeting Complete')
  }

  if (enabled('Submission Complete')) {
    await libmail.test('Submission Complete', {
      match: {
        id: 7,
        subscriptionId: 33,
        book: {
          cover,
          title: 'Demo in the Rye',
        },
        award: {
          name: 'The BAP Gun',
          category: 'Humor',
          dueDate: new Date(),
        },
      },
    })
    log.warn('SENT:', 'Submission Complete')
  }

  if (enabled('New User')) {
    await libmail.test('New User', {
      affiliate: {
        id: 33,
        fullname: 'Test Affiliate',
      },
      customer: {
        id: 42,
        email: 'test@bookawardpro.com',
        fullname: 'Test Account',
      },
      plan: 'Pro Plan',
      coupon: 'abc123',
    })
    log.warn('SENT:', 'New User')
  }

  if (enabled('Referral Payouts')) {
    await libmail.test('Referral Payouts', {
      paypal: [
        {
          email: 'test-0@bookawardpro.com',
          name: 'Test 0',
          total: 33,
          count: 1,
        },
      ],
      credits: [
        {
          email: 'test-1@bookawardpro.com',
          name: 'Test 1',
          stripeId: 'cus_abc123',
          total: 33,
          count: 3,
        },
        {
          email: 'test-2@bookawardpro.com',
          name: 'Test 2',
          stripeId: 'cus_xyz789',
          total: 99.5,
          count: 1,
        },
      ],
    })
    log.warn('SENT:', 'Referral Payouts')
  }

  if (enabled('Book Update Reminder')) {
    await libmail.test('Book Update Reminder', {
      books: [
        {
          cover,
          id: 1,
          authorId: 33,
          title: 'Demo in the Rye',
          modified: date.subDays(new Date(), 3),
        },
        {
          cover,
          id: 2,
          authorId: 33,
          title: 'Adventures in Demoland',
          modified: date.subDays(new Date(), 33),
        },
      ],
    })
    log.warn('SENT:', 'Book Update Reminder')
  }

  if (enabled('Author Award Winner')) {
    await libmail.test('Author Award Winner', {
      match: {
        id: 1,
        subscriptionId: 33,
        book: {
          cover,
          title: 'Demo in the Rye',
        },
        award: {
          name: 'Ten Farcical Keanu Stories',
          category: 'Humor',
          email: 'whoa@keanu.reeves',
        },
      },
      ann: {
        notes: AWARD_NOTES,
        files: {
          misc: '/img/demo/cover.jpg',
          howto: '/img/demo/cover.jpg',
        },
        url: 'http://keanu.reeves/whoa',
      },
    })
    log.warn('SENT:', 'Author Award Winner')
  }

  if (enabled('Author Award Update')) {
    await libmail.test('Author Award Update', {
      match: {
        id: 1,
        subscriptionId: 33,
        book: {
          cover,
          title: 'Demo in the Rye',
        },
        award: {
          name: 'Ten Farcical Keanu Stories',
          category: 'Humor',
          email: 'whoa@keanu.reeves',
        },
      },
      ann: {
        notes: AWARD_NOTES,
        files: {misc: '/img/demo/cover.jpg'},
        url: 'http://keanu.reeves/whoa',
      },
    })
    log.warn('SENT:', 'Author Award Update')
  }

  if (enabled('Partner Award Winners')) {
    await libmail.test('Partner Award Winners', {
      award: {
        name: 'Ten Farcical Keanu Stories',
        category: 'Humor',
        email: 'whoa@keanu.reeves',
      },
      ann: {
        notes: AWARD_NOTES,
        files: {misc: cover},
        url: 'http://keanu.reeves/whoa',
      },
      users: [
        {
          email: 'test-1@bookawardpro.com',
          fullname: 'Test 1',
          book: {
            cover,
            title: 'Demo in the Rye',
          },
          subscriptionId: 7,
        },
        {
          email: 'test-2@bookawardpro.com',
          fullname: 'Test 2',
          book: {
            title: 'Adventures in Demoland',
          },
          subscriptionId: 33,
        },
      ],
    })
    log.warn('SENT:', 'Partner Award Winners')
  }

  if (enabled('Partner Award Update')) {
    await libmail.test('Partner Award Update', {
      award: {
        name: 'Ten Farcical Keanu Stories',
        category: 'Humor',
        email: 'whoa@keanu.reeves',
      },
      ann: {
        notes: AWARD_NOTES,
        files: {misc: cover},
        url: 'http://keanu.reeves/whoa',
      },
      users: [
        {
          email: 'test-1@bookawardpro.com',
          fullname: 'Test 1',
          book: {
            cover,
            title: 'Demo in the Rye',
          },
          subscriptionId: 7,
        },
        {
          email: 'test-2@bookawardpro.com',
          fullname: 'Test 2',
          book: {
            title: 'Adventures in Demoland',
          },
          subscriptionId: 33,
        },
      ],
    })
    log.warn('SENT:', 'Partner Award Update')
  }

  if (enabled('Contact Info for Winners')) {
    await libmail.test('Contact Info for Winners', {
      award: {
        name: 'Ten Farcical Keanu Stories',
        category: 'Humor',
        email: 'whoa@keanu.reeves',
      },
      users: [
        {
          book: {
            cover,
            title: 'Demo in the Rye',
          },
          author: {
            email: 'test-1@bookawardpro.com',
            fullname: 'Test 1',
            address: '123 E Main St.\nHollywood, CA, 90210\r\nUSA',
          },
        },
        {
          book: {
            title: 'Adventures in Demoland',
          },
          author: {
            email: 'test-2@bookawardpro.com',
            fullname: 'Test 2',
          },
        },
      ],
    })
    log.warn('SENT:', 'Contact Info for Winners')
  }

  if (enabled('Testimonial Request')) {
    await libmail.test('Testimonial Request', {
      book: {
        title: 'Demo in the Rye',
      },
    })
    log.warn('SENT:', 'Testimonial Request')
  }

  if (enabled('How Did You Hear')) {
    await libmail.test('How Did You Hear', {})
    log.warn('SENT:', 'How Did You Hear')
  }

  sequelize.close()
}

main()
