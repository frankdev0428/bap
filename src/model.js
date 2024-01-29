
const _ = require('lodash')
const date = require('date-fns')
const {Op} = require('sequelize')
const {Model, DataTypes, QueryTypes} = require('sequelize')
const crypto = require('crypto')

// TODO: de-dup validation in peggy
// const Yup = require('yup')

class AccessError extends Error {
  constructor(user, action, model, id) {
    super(`user ${user} cannot ${action} ${model} with id ${id}`)
    this.name = 'AccessError'
  }
}

class NotFoundError extends Error {
  constructor(model, id) {
    super(`${model} with id ${id} not found`)
    this.name = 'NotFoundError'
  }
}

const SA_IDS = (process.env.SYSTEM_ADMINS || '').split(/\s+/u).map(i => parseInt(i))
const AM_IDS = (process.env.AWARDS_MASTERS || '').split(/\s+/u).map(i => parseInt(i))

function isAwardsMaster(userId) {
  return AM_IDS.includes(userId)
}

function isSystemAdmin(userId) {
  return SA_IDS.includes(userId)
}

const models = {}

const QRY = {}

QRY.partnering = `
SELECT
  id
FROM
  user_trees
WHERE
  ancestor_id = :ancestorId::int
AND
  descendant_id = :descendantId::int
`

// TODO: assume user_id=1 for simplicity
QRY.rootSettings = `
SELECT
  p.*
FROM
  partners p
, user_trees t
WHERE
  p.user_id = t.ancestor_id
AND
  t.ancestor_id = t.descendant_id
AND
  t.ancestor_id NOT IN (SELECT descendant_id FROM user_trees WHERE depth > 0)
`

QRY.parentUser = `
SELECT
  u.*
FROM
  users u
, user_trees t
WHERE
  u.id = t.ancestor_id
AND
  t.descendant_id = :userId::int
AND
  depth = 1
`

QRY.userSettings = `
SELECT
  p.*
FROM
  partners p
, user_trees t
WHERE
  p.user_id = t.ancestor_id
AND
  t.descendant_id = :userId::int
ORDER BY t.depth
`

QRY.children = `
SELECT
  u.id
, u.email
, u.verbosity
, u.fullname
, u.nickname
, u.last_active as "lastActive"
, u.created
, u.tombstoned
, p.id IS NOT NULL AS "isPartner"
, 'https://www.gravatar.com/avatar/' || md5(u.email) || '?d=mp' as "avatar"
, array_agg(DISTINCT a.fullname) as "authors"
, array_agg(DISTINCT b.title) as "books"
, count(distinct s.id)::int as "subscriptions"
FROM
  user_trees t
, users u LEFT JOIN partners p ON (p.user_id = u.id)
          LEFT JOIN authors a ON (a.user_id = u.id)
          LEFT JOIN books b ON (b.user_id = u.id)
          LEFT JOIN subscriptions s ON (s.user_id = u.id AND s.enabled)
WHERE
  u.id = t.descendant_id
AND
  t.ancestor_id = :userId::int
AND
  depth > 0
GROUP BY 1,2,3,4,5,6,7,8,9,10
ORDER BY u.fullname
`

module.exports = sequelize => {
  if (!models.BapModel) {
    class BapModel extends Model {
      static async getUserId(id) {
        const row = await sequelize.query(`SELECT user_id FROM ${this.getTableName()} WHERE id = ${id}`, {
          plain: true,
        })
        return row?.user_id
      }
    }
    // BapModel.getUserId = _.memoize(BapModel.getUserId)
    models.BapModel = BapModel
  }
  const {BapModel} = models

  if (!models.User) {
    class UserModel extends BapModel {
      async can(action, model, id) {
        return await UserModel.memoCan(this.id, action, model, id)
      }

      static async memoCan(userId, action, model, id) {
        const descendantId = model.name === 'user' ? id : await model.getUserId(id)
        if (!descendantId) {
          throw new NotFoundError(model.name, id)
        }
        // the api uses User.can() to throw requested resource not found, so
        // doing this check after it, also get the added benefit of caching
        // isAwardsMaster results in case that ever gets more involved
        if (isAwardsMaster(userId)) {
          return
        }
        const x = await sequelize.query(QRY.partnering, {
          replacements: {
            descendantId,
            ancestorId: userId,
          },
          plain: true,
        })
        if (!x) {
          throw new AccessError(userId, action, model.name, id)
        }
      }

      isAM() {
        return isAwardsMaster(this.id)
      }

      isSA() {
        return isSystemAdmin(this.id)
      }

      affiliateCode() {
        return this.nickname.replace(/[^a-zA-Z]+/ug, '').slice(0, 8) + this.id.toString(16)
      }

    }
    UserModel.memoCan = _.memoize(UserModel.memoCan, (user, action, model, id) => {
      return `${user}:${action}:${model.name}:${id}`
    })

    models.User = UserModel.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      password: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'SALT:hash(SALT+PASSWORD)',
      },
      email: {
        type: DataTypes.TEXT,
        unique: true,
        allowNull: false,
        comment: 'primary email address, doubling as username',
      },
      lastActive: {
        type: DataTypes.DATE,
      },
      // TODO: model as a hash of {event: enabled} to support expected requirements
      verbosity: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        allowNull: false,
        comment: 'level of notifications to receive',
      },
      avatar: {
        type: DataTypes.VIRTUAL,
        get() {
          const hash = crypto.createHash('md5')
          hash.update(this.email || '')
          return `https://www.gravatar.com/avatar/${hash.digest('hex')}?d=mp`
        },
        set() {
          throw new Error('READ ONLY: avatar')
        }
      },
      fullname: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'more formal name',
      },
      nickname: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'more informal name',
      },
      stripeId: {
        type: DataTypes.TEXT,
        unique: true,
        comment: 'stripe customer id',
      },
      newMatchNotification: {
        type: DataTypes.ENUM,
        values: [
          'As they happen',
          'Once weekly',
          'Twice monthly',
          'Never',
        ],
        defaultValue: 'Once weekly',
        allowNull: false,
        comment: 'new match notification frequency',
      }
    }, {
      sequelize,
      modelName: 'user',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
      paranoid: true,
      deletedAt: 'tombstoned',
    })
    models.User.addScope('defaultScope', {
      attributes: {
        exclude: ['password'],
      },
    })
  }
  const {User} = models

  if (!models.UserTree) {
    class UserTree extends BapModel {}
    models.UserTree = UserTree.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      ancestorId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      descendantId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      depth: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'relationship: 0=self, 1=parent:child, etc',
      },
    }, {
      sequelize,
      modelName: 'user_tree',
      underscored: true,
      timestamps: false,
    })
    models.UserTree.belongsTo(User, {as: 'ancestor', foreignKey: 'ancestorId', onDelete: 'CASCADE'})
    models.UserTree.belongsTo(User, {as: 'descendant', foreignKey: 'descendantId', onDelete: 'CASCADE'})
    User.hasMany(models.UserTree, {as: 'ancestors', foreignKey: 'descendantId'})
    User.hasMany(models.UserTree, {as: 'descendants', foreignKey: 'ancestorId'})
  }
  const {UserTree} = models // eslint-disable-line no-unused-vars

  if (!models.Author) {
    class Author extends BapModel {}
    models.Author = Author.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      fullname: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      email: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'multiple author profiles can use same email',
      },
      regions: {
        type: DataTypes.JSONB,
        comment: 'criteria for matching (eg birthplace, citizenship, residence, lineage)',
      },
      address: {
        type: DataTypes.TEXT,
      },
      photo: {
        type: DataTypes.TEXT,
        comment: 'url of author photo',
      },
      thumbnail: {
        type: DataTypes.VIRTUAL,
        get() {
          if (this.photo) {
            return this.photo + '-thumb'
          }
          return '/img/default-author.jpg'
        },
        set() {
          throw new Error('READ ONLY: thumbnail')
        }
      },
      bio: {
        type: DataTypes.TEXT,
        comment: 'brief author biography',
      },
      orgs: {
        type: DataTypes.TEXT,
        comment: 'organizations author is member of, newline separated',
      },
      born: {
        type: DataTypes.INTEGER,
        comment: '4 digit year author was born',
      },
      social: {
        type: DataTypes.BOOLEAN,
        comment: 'opt-in to share with author social media accounts',
      },
      instagram: {
        type: DataTypes.TEXT,
        comment: 'author instagram handle',
      },
      twitter: {
        type: DataTypes.TEXT,
        comment: 'author twitter handle',
      },
      facebook: {
        type: DataTypes.TEXT,
        comment: 'author facebook url',
      },
      linkedin: {
        type: DataTypes.TEXT,
        comment: 'author linkedin url',
      },
      tiktok: {
        type: DataTypes.TEXT,
        comment: 'author tiktok url',
      },
      goodreads: {
        type: DataTypes.TEXT,
        comment: 'author goodreads url',
      },
      tombstoned: {
        type: DataTypes.DATE,
        comment: 'timestamp when marked as deleted',
      },
    }, {
      sequelize,
      modelName: 'author',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasMany(models.Author)
    models.Author.belongsTo(User)
    models.Author.addScope('active', {
      where: {
        tombstoned: {[Op.is]: null},
      },
    })
  }
  const {Author} = models

  if (!models.Book) {
    class Book extends BapModel {
      boostable() {
        // see https://gitlab.com/bookawardpro/peggy/-/issues/76
        return Boolean(this.copies?.pdf)
      }
    }
    models.Book = Book.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key'
      },
      authorId: {
        type: DataTypes.INTEGER,
        references: {model: Author},
        allowNull: false,
        comment: 'authors(id) foreign key'
      },
      title: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      subtitle: {
        type: DataTypes.TEXT,
      },
      description: {
        type: DataTypes.TEXT,
      },
      inspiration: {
        type: DataTypes.TEXT,
      },
      isbn: {
        type: DataTypes.TEXT,
        comment: 'internation standard book number',
      },
      asin: {
        type: DataTypes.TEXT,
        comment: 'amazon standard identification number',
      },
      keywords: {
        type: DataTypes.JSONB,
        'comment': 'array of keywords to match against awards'
      },
      copyright: {
        type: DataTypes.INTEGER,
        comment: '4-digit copyright year',
      },
      pubDate: {
        type: DataTypes.DATEONLY,
        comment: 'publication date',
      },
      pubName: {
        type: DataTypes.TEXT,
        comment: 'name of the publisher',
      },
      pubType: {
        type: DataTypes.TEXT,
        comment: 'publication types (eg traditional, independent, self-published)',
      },
      fictional: {
        type: DataTypes.BOOLEAN,
        comment: 'fiction or non-fiction',
      },
      website: {
        type: DataTypes.TEXT,
      },
      formats: {
        type: DataTypes.JSONB,
        comment: 'book format (eg hardback, paperback, ebook, audiobook)',
      },
      workTypes: {
        type: DataTypes.JSONB,
        comment: 'work types (eg novel, graphic, textbook, first)',
      },
      regions: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'criteria for matching (eg setting)',
      },
      cover: {
        type: DataTypes.TEXT,
        comment: 'url of cover image',
      },
      incomplete: {
        type: DataTypes.VIRTUAL,
        get() {
          return this.keywords == null
        },
        set() {
          throw new Error('READ ONLY: incomplete')
        }
      },
      thumbnail: {
        type: DataTypes.VIRTUAL,
        get() {
          if (this.cover) {
            return this.cover + '-thumb'
          }
          return '/img/default-book.jpg'
        },
        set() {
          throw new Error('READ ONLY: thumbnail')
        }
      },
      copies: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: '{filetype: url} mapping of digital copies',
      },
      pageCount: {
        type: DataTypes.INTEGER,
        comment: 'approximate number of pages in the pdf',
      },
      wordCount: {
        type: DataTypes.INTEGER,
        comment: 'approximate number of words in the pdf',
      },
      tombstoned: {
        type: DataTypes.DATE,
        comment: 'timestamp when marked as deleted',
      },
      nonEnglish: {
        type: DataTypes.BOOLEAN,
        comment: 'is the book language non-english'
      }
    }, {
      sequelize,
      modelName: 'book',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasMany(models.Book)
    models.Book.belongsTo(User)
    Author.hasMany(models.Book)
    models.Book.belongsTo(Author)
    models.Book.addScope('active', {
      where: {
        tombstoned: {[Op.is]: null},
      },
    })
    models.Book.addScope('incomplete', {
      where: {
        keywords: {[Op.is]: null},
      },
    })
    models.Book.addScope('complete', {
      where: {
        keywords: {[Op.not]: null},
      },
    })
  }
  const {Book} = models // eslint-disable-line no-unused-vars

  if (!models.Product) {
    class Product extends BapModel {}
    models.Product = Product.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      stripeId: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'stripe price id',
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      price: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'price in US dollars (no cents)',
      },
      kind: {
        type: DataTypes.ENUM,
        values: ['plan', 'boost'],
      },
      months: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'for kind=plan, number of months in billing cycle',
      },
      recurs: {
        type: DataTypes.BOOLEAN,
        comment: 'for kind=plan, true if is recurring',
      },
      features: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'any of: match, target, submit, fast',
      },
      notes: {
        type: DataTypes.TEXT,
        comment: 'markup?',
      },
    }, {
      sequelize,
      modelName: 'product',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
  }
  const {Product} = models // eslint-disable-line no-unused-vars

  if (!models.Subscription) {
    class Subscription extends BapModel {}
    models.Subscription = Subscription.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      bookId: {
        type: DataTypes.INTEGER,
        references: {model: Book},
        comment: 'books(id) foreign key',
      },
      productId: {
        type: DataTypes.INTEGER,
        references: {model: Product},
        allowNull: false,
        comment: 'products(id) foreign key',
      },
      stripeId: {
        type: DataTypes.TEXT,
        comment: 'stripe subscription id',
      },
      cardId: {
        type: DataTypes.TEXT,
        comment: 'stripe payment method id',
      },
      status: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'stripe status',
      },
      renewed: {
        type: DataTypes.DATE,
        comment: 'timestamp when last renewed / paid for',
      },
      renews: {
        type: DataTypes.DATE,
        comment: 'stripe current_period_end',
      },
      end: {
        type: DataTypes.DATE,
        comment: 'when non-recurring plan scheduled to end, or when recurring plan ended',
      },
      enabled: {
        type: DataTypes.BOOLEAN,
        defaultValue: true,
        allowNull: false,
        comment: 'prevent new subscriptions while honoring existing',
      },
    }, {
      sequelize,
      paranoid: true,
      modelName: 'subscription',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
      deletedAt: 'tombstoned',
    })
    User.hasMany(models.Subscription)
    models.Subscription.belongsTo(User)
    Book.hasMany(models.Subscription, {onDelete: 'SET NULL'})
    models.Subscription.belongsTo(Book)
    Product.hasMany(models.Subscription, {onDelete: 'RESTRICT'})
    models.Subscription.belongsTo(Product)
    models.Subscription.addScope('unconfigured', {
      where: {
        enabled: true,
        bookId: {[Op.is]: null},
      },
      include: [User, Product],
    })
  }
  const {Subscription} = models // eslint-disable-line no-unused-vars

  if (!models.Boost) {
    class Boost extends BapModel {
      static async getUserId(id) {
        const row = await sequelize.query(`SELECT s.user_id FROM subscriptions s, boosts b WHERE b.id = ${id} AND b.subscription_id = s.id`, {
          plain: true,
        })
        return row?.user_id
      }
    }
    models.Boost = Boost.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      subscriptionId: {
        type: DataTypes.INTEGER,
        references: {model: Subscription},
        comment: 'subscriptions(id) foreign key'
      },
      productId: {
        type: DataTypes.INTEGER,
        references: {model: Product},
        allowNull: false,
        comment: 'products(id) foreign key',
      },
      processed: {
        type: DataTypes.DATE,
      },
      awards: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'zero or more awards to boost',
      },
    }, {
      sequelize,
      modelName: 'boost',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    Subscription.hasMany(models.Boost)
    models.Boost.belongsTo(Subscription)
    Product.hasMany(models.Boost, {onDelete: 'RESTRICT'})
    models.Boost.belongsTo(Product)
  }
  const {Boost} = models // eslint-disable-line no-unused-vars

  if (!models.Session) {
    class Session extends BapModel {}
    models.Session = Session.init({
      sid: {
        type: DataTypes.STRING,
        primaryKey: true,
      },
      expires: {
        type: DataTypes.DATE,
      },
      data: {
        type: DataTypes.TEXT,
      },
    }, {
      sequelize,
      modelName: 'session',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
  }
  const {Session} = models // eslint-disable-line no-unused-vars

  if (!models.Partner) {
    class Partner extends BapModel {}
    models.Partner = Partner.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key'
      },
      powered: { // NOTE: left as int in case would like to refer to style of a partner
        type: DataTypes.INTEGER,
        // references: {model: Partner},
        defaultValue: 1,
        comment: '1 if powered by Book Award Pro, 0 otherwise'
      },
      enterprise: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'true for enterprise partners',
      },
      business: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'company/business name',
      },
      domain: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'domain name',
      },
      theme: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: '{prop: value} mapping of values for theming',
      },
      bcc: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'send a copy of transactional emails here',
      },
      products: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: '{name: overrides} mapping of product offerings',
      },
      emails: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: '{name: address} mapping of emails',
      },
      urls: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: '{name: address} mapping of urls',
      },
      logo: {
        type: DataTypes.TEXT,
        comment: 'url of service logo',
      },
      thumbnail: {
        type: DataTypes.VIRTUAL,
        get() {
          if (this.logo) {
            return this.logo + '-thumb'
          }
          return '/img/pixel.png'
        },
        set() {
          throw new Error('READ ONLY: thumbnail')
        }
      },
    }, {
      sequelize,
      modelName: 'partner',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasOne(models.Partner)
    models.Partner.belongsTo(User)
  }
  const {Partner} = models // eslint-disable-line no-unused-vars

  if (!models.Sponsor) {
    class Sponsor extends BapModel {}
    models.Sponsor = Sponsor.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      airtableId: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
    }, {
      sequelize,
      modelName: 'sponsor',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
  }
  const {Sponsor} = models // eslint-disable-line no-unused-vars

  if (!models.Award) {
    class Award extends BapModel {
      overage() {
        if (this.fee == null) {
          throw new Error(`trying to compute overage for award with no fee: ${this.id}`)
        }
        return Math.max(0, this.fee - 100)
      }

      boostable() {
        if (!this.allowsDigital) {
          return false
        }
        if (this.dueDate && new Date(this.dueDate) < new Date()) {
          // NOTE: we're being aggressive here assuming that awards will be lax
          return false
        }
        return true
      }
    }

    models.Award = Award.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      airtableId: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      sponsorId: {
        type: DataTypes.INTEGER,
        references: {model: Sponsor},
        allowNull: false,
        comment: 'sponsors(id) foreign key'
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      category: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      email: {
        type: DataTypes.TEXT,
        comment: '',
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      notes: {
        type: DataTypes.TEXT,
        comment: '',
      },
      submitNotes: {
        type: DataTypes.TEXT,
        comment: 'internal submission notes',
      },
      restrictions: {
        type: DataTypes.TEXT,
        comment: '',
      },
      fee: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      bapFee: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      currency: {
        type: DataTypes.TEXT,
        comment: '',
      },
      website: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      allowsDigital: {
        type: DataTypes.BOOLEAN,
        comment: '',
      },
      isScam: {
        type: DataTypes.BOOLEAN,
        comment: '',
      },
      cyclesPerYear: {
        type: DataTypes.INTEGER,
        comment: 'number of cycles per year (5 means 5+)',
      },
      nonContentTypes: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      publicationTypes: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      formatsOr: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      fictionFilter: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: 'one or both of: Fiction, Nonfiction',
      },
      workTypesAnd: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      workTypesOr: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      workTypesNot: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      keywordsAnd: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      keywordsOr1: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      keywordsOr2: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      keywordsNot: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      disqualifiers: {
        type: DataTypes.JSONB,
        comment: '',
      },
      wordsMin: {
        type: DataTypes.INTEGER,
        comment: ''
      },
      wordsMax: {
        type: DataTypes.INTEGER,
        comment: ''
      },
      pagesMin: {
        type: DataTypes.INTEGER,
        comment: ''
      },
      pagesMax: {
        type: DataTypes.INTEGER,
        comment: ''
      },
      publishStart: {
        type: DataTypes.DATEONLY,
        comment: '',
      },
      publishEnd: {
        type: DataTypes.DATEONLY,
        comment: '',
      },
      copyrightStart: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      copyrightEnd: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      authorStart: {
        type: DataTypes.DATEONLY,
        comment: 'minimum author birth date',
      },
      authorEnd: {
        type: DataTypes.DATEONLY,
        comment: 'maximum author birth date',
      },
      ageMin: {
        type: DataTypes.INTEGER,
        comment: 'minimum age of author',
      },
      ageMax: {
        type: DataTypes.INTEGER,
        comment: 'maximum age of author',
      },
      bookSetting: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      authorBirthplace: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      authorLineage: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      authorCitizenship: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      authorResidency: {
        type: DataTypes.JSONB,
        defaultValue: [],
        comment: '',
      },
      openDate: {
        type: DataTypes.DATE,
        comment: '',
      },
      dueDate: {
        type: DataTypes.DATE,
        comment: '',
      },
      finalsDate: {
        type: DataTypes.DATE,
        comment: '',
      },
      resultsDate: {
        type: DataTypes.DATE,
        comment: '',
      },
      scoreCategories: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreEntrySteps: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreStability: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreHelpful: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreCyclesPerYear: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreWinnerValue: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreBenefits: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreCycleChanges: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreMultipleWinners: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreAttractive: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      scoreBonus: {
        type: DataTypes.INTEGER,
        comment: '',
      },
      tombstoned: {
        type: DataTypes.DATE,
        comment: 'timestamp when marked as deleted',
      },
    }, {
      sequelize,
      modelName: 'award',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    Sponsor.hasOne(models.Award, {onDelete: 'SET NULL'})
    models.Award.belongsTo(Sponsor)
  }
  const {Award} = models // eslint-disable-line no-unused-vars

  if (!models.Match) {
    class Match extends BapModel {
      static get SubmitLeadDays() {
        return 9
      }

      static async getUserId(id) {
        const row = await sequelize.query(`SELECT s.user_id FROM subscriptions s, matches m WHERE m.id = ${id} AND m.subscription_id = s.id`, {
          plain: true,
        })
        return row?.user_id
      }

      boostable() {
        if (this.submitBy) {
          // we did/will do the submission
          return false
        }
        if (['submitted', 'won'].includes(this.status)) {
          // no need if already submitted or won
          return false
        }
        return true
      }

      targetBy() {
        if (this.targeted && this.targeting === 'candidate') {
          return date.addDays(this.targeted, 5)
        }
        return null
      }

      prepareBy() {
        if (this.submitBy && this.targeting !== 'rejected' && !['submitted', 'won'].includes(this.status)) {
          return date.addDays(this.submitBy, 2)
        }
        return null
      }
    }
    models.Match = Match.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      awardId: {
        type: DataTypes.INTEGER,
        references: {model: Award},
        allowNull: false,
        comment: 'awards(id) foreign key'
      },
      subscriptionId: {
        type: DataTypes.INTEGER,
        references: {model: Subscription},
        comment: 'subscriptions(id) foreign key'
      },
      boostId: {
        type: DataTypes.INTEGER,
        references: {model: Boost},
        comment: 'boosts(id) foreign key'
      },
      bookId: {
        type: DataTypes.INTEGER,
        references: {model: Book},
        allowNull: false,
        comment: 'books(id) foreign key'
      },
      score: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '',
      },
      // TODO: index on `status is null`
      status: {
        type: DataTypes.ENUM,
        values: ['liked', 'disliked', 'targeted', 'submitted', 'won'],
      },
      managed: { // could be considered a derived field: managed => targeting is not null
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'true if state ever managed by partner (eg targeted)',
      },
      targeting: {
        type: DataTypes.ENUM,
        values: ['candidate', 'presented', 'complete', 'rejected'],
      },
      // NOTE: these timestamps differ from their MatchState counterparts where those are more user-facing and these are for internal use
      targeted: {
        type: DataTypes.DATE,
        comment: 'timestamp when match was targeted',
      },
      submitBy: {
        type: DataTypes.DATE,
        comment: 'when submission should be started',
      },
      reason: {
        type: DataTypes.ENUM,
        values: ['cupid-match', 'am-match', 'extra-target', 'renewal', 'boost'],
      },
      // extra: {
      //   type: DataTypes.BOOLEAN,
      //   defaultValue: false,
      //   comment: 'true when customers request an extra target',
      // },
      // reason: {
      //   type: DataTypes.VIRTUAL,
      //   get() {
      //     if (this.boostId) {
      //       return 'boost'
      //     }
      //     if (this.extra) {
      //       return 'extra-target'
      //     }
      //     if (this.submitBy) {
      //       return 'submit-renewal'
      //     }
      //     if (this.targeted) {
      //       return 'target-renewal'
      //     }
      //     if (this.targeting) {
      //       return 'am-matched'
      //     }
      //     return 'matched'
      //   },
      //   set() {
      //     throw new Error('READ ONLY: reason')
      //   }
      // },
    }, {
      sequelize,
      modelName: 'match',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    Award.hasMany(models.Match)
    models.Match.belongsTo(Award)
    Subscription.hasMany(models.Match)
    models.Match.belongsTo(Subscription)
    Book.hasMany(models.Match)
    models.Match.belongsTo(Book)
    Boost.hasMany(models.Match, {onDelete: 'SET NULL'})
    models.Match.belongsTo(Boost)
  }
  const {Match} = models // eslint-disable-line no-unused-vars

  if (!models.MatchState) {
    class MatchState extends BapModel {}
    models.MatchState = MatchState.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      matchId: {
        type: DataTypes.INTEGER,
        references: {model: Match},
        allowNull: false,
        comment: 'matches(id) foreign key',
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        comment: 'users(id) foreign key of who set this status'
      },
      name: {
        type: DataTypes.ENUM,
        allowNull: false,
        values: ['liked', 'disliked', 'targeted', 'submitted', 'won'],
      },
    }, {
      sequelize,
      modelName: 'match_state',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    Match.hasMany(models.MatchState)
    models.MatchState.belongsTo(Match)
    User.hasMany(models.MatchState)
    models.MatchState.belongsTo(User)
  }
  const {MatchState} = models // eslint-disable-line no-unused-vars

  if (!models.Notification) {
    class Notification extends BapModel {}
    models.Notification = Notification.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      partnerId: {
        type: DataTypes.INTEGER,
        references: {model: Partner},
        comment: 'partners(id) foreign key',
      },
      internal: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'true if for intneral use only (BAP OPS)',
      },
      key: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'unique-to-notification key to de-dupe',
      },
      subject: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      body: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: '',
      },
      plain: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'send message as plain text instead of html',
      },
      url: {
        type: DataTypes.TEXT,
        comment: 'optional link to more details',
      },
      level: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: '1=info, 2=notice, 3=warn, 4=request, 5=error',
      },
      ttl: {
        type: DataTypes.INTEGER,
        comment: 'time to live in seconds',
      },
      read: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'true once user has read the notification',
      },
      processed: {
        type: DataTypes.DATE,
        comment: 'timestamp when processed by our mailer',
      },
    }, {
      sequelize,
      modelName: 'notification',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasMany(models.Notification)
    models.Notification.belongsTo(User)
    Partner.hasMany(models.Notification)
    models.Notification.belongsTo(Partner)
  }
  const {Notification} = models // eslint-disable-line no-unused-vars

  if (!models.Task) {
    class Task extends BapModel {}
    models.Task = Task.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      name: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'unique name in task runner catalog',
      },
      key: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'unique-to-task key to de-dupe',
      },
      worker: {
        type: DataTypes.TEXT,
        comment: 'name of worker that is processing task',
      },
      data: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: '',
      },
      results: {
        type: DataTypes.JSONB,
        comment: 'any results worth saving',
      },
      retries: {
        type: DataTypes.INTEGER,
        defaultValue: 0,
        comment: 'number of times task has been retried',
      },
      timeout: {
        type: DataTypes.INTEGER,
        comment: 'number of seconds to give worker to complete, will retry after this timeout',
      },
      ttl: {
        type: DataTypes.INTEGER,
        comment: 'time to live in seconds',
      },
      processed: {
        type: DataTypes.DATE,
        comment: 'timestamp when successfully processed',
      },
    }, {
      sequelize,
      modelName: 'task',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
  }
  const {Task} = models // eslint-disable-line no-unused-vars

  if (!models.Affiliate) {
    class Affiliate extends BapModel {}
    models.Affiliate = Affiliate.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      url: {
        type: DataTypes.TEXT,
        defaultValue: 'https://bookawardpro.com',
        comment: 'url to redirect to once the referral cookie has been attached',
      },
      code: {
        type: DataTypes.TEXT,
        unique: true,
        comment: 'the code used to identify an affiliate on new signup'
      },
      method: {
        type: DataTypes.ENUM,
        values: ['credit', 'paypal'],
        defaultValue: 'credit',
        comment: 'how the affiliate should be paid',
      },
      percentage: {
        type: DataTypes.INTEGER,
        defaultValue: 25,
        comment: 'integer value for the base rate of payout: 25 = 25% 5 = 5%',
      },
      days: {
        type: DataTypes.INTEGER,
        defaultValue: 30,
        // 30 = 30 day window where any non-zero subscription purchase can potentially be paid out
        // 0 = 0 days meaning only the subscription on account creation is eligible
        comment: 'how long an affiliate can receive credit for a subscription',
      },
      recurring: {
        type: DataTypes.BOOLEAN,
        defaultValue: false,
        comment: 'whether affiliate is paid for every renewal or just the first payment',
      },
      subscriptions: {
        type: DataTypes.INTEGER,
        defaultValue: 1,
        comment: 'number of subscriptions affiliate can earn commission for',
      },
      email: {
        type: DataTypes.TEXT,
      },
      campaigns: {
        type: DataTypes.JSONB,
        defaultValue: [],
      },
    }, {
      sequelize,
      modelName: 'affiliate',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasOne(models.Affiliate)
    models.Affiliate.belongsTo(User)
  }
  const {Affiliate} = models // eslint-disable-line no-unused-vars

  if (!models.Referral) {
    class Referral extends BapModel {}
    models.Referral = Referral.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      affiliateId: {
        type: DataTypes.INTEGER,
        references: {model: Affiliate},
        allowNull: false,
        comment: 'affiliates(id) foreign key',
      },
      subscriptionId: {
        type: DataTypes.INTEGER,
        references: {model: Subscription},
        allowNull: false,
        comment: 'subscriptions(id) foreign key',
      },
      campaign: {
        type: DataTypes.TEXT,
        comment: 'optional field to track where referee got the affiliate cookie',
      },
      paid: {
        type: DataTypes.DECIMAL(7, 2),
        comment: 'amount paid for the subscription',
      },
      earned: {
        type: DataTypes.DECIMAL(7, 2),
        comment: 'amount earned for the affiliate',
      },
      processed: {
        type: DataTypes.DATE,
        comment: 'timestamp when paid to affiliate',
      },
    }, {
      sequelize,
      modelName: 'referral',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    Affiliate.hasMany(models.Referral)
    models.Referral.belongsTo(Affiliate)
    Subscription.hasOne(models.Referral, {onDelete: 'RESTRICT'})
    models.Referral.belongsTo(Subscription)
  }
  const {Referral} = models // eslint-disable-line no-unused-vars

  if (!models.Request) {
    class Request extends BapModel {}
    models.Request = Request.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      childId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      productId: {
        type: DataTypes.INTEGER,
        references: {model: Product},
        allowNull: false,
        comment: 'products(id) foreign key',
      },
      data: {
        type: DataTypes.JSONB,
        defaultValue: {},
        comment: 'request specific details: subscription, award, book',
      },
      approved: {
        type: DataTypes.BOOLEAN,
        comment: 'true if parent has approved, false if denied',
      },
    }, {
      sequelize,
      modelName: 'request',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasMany(models.Request)
    models.Request.belongsTo(User)
    User.hasMany(models.Request, {as: 'requestors', foreignKey: 'childId'})
    models.Request.belongsTo(User, {as: 'requestor', foreignKey: 'childId', onDelete: 'CASCADE'})
    Product.hasMany(models.Request)
    models.Request.belongsTo(Product)
  }
  const {Request} = models // eslint-disable-line no-unused-vars

  if (!models.Announcement) {
    class Announcement extends BapModel {}
    models.Announcement = Announcement.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      awardId: {
        type: DataTypes.INTEGER,
        references: {model: Award},
        allowNull: false,
        comment: 'awards(id) foreign key - represents all same name',
      },
      distinction: {
        type: DataTypes.TEXT,
        allowNull: false,
        comment: 'a way to disambiguate',
      },
      notice: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
        comment: 'is a notice, as opposed to winner announcement',
      },
      url: {
        type: DataTypes.TEXT,
        comment: 'place where award lists winners',
      },
      notes: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: '',
        comment: 'info to pass along to the author',
      },
      files: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: {},
        comment: '{name: url} mapping of files',
      },
      matches: {
        type: DataTypes.JSONB,
        allowNull: false,
        defaultValue: [],
        comment: 'matches.id of matches in this announcement',
      },
    }, {
      sequelize,
      modelName: 'announcement',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    Award.hasMany(models.Announcement)
    models.Announcement.belongsTo(Award)
  }
  const {Announcement} = models // eslint-disable-line no-unused-vars

  if (!models.Testimonial) {
    class Testimonial extends BapModel {}
    models.Testimonial = Testimonial.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      userId: {
        type: DataTypes.INTEGER,
        references: {model: User},
        allowNull: false,
        comment: 'users(id) foreign key',
      },
      attempt: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        comment: 'current attempt to get testimonial',
      },
      response: {
        type: DataTypes.TEXT,
        comment: 'customer response',
      },
    }, {
      sequelize,
      modelName: 'testimonial',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
    User.hasOne(models.Testimonial)
    models.Testimonial.belongsTo(User)
  }
  const {Testimonial} = models // eslint-disable-line no-unused-vars

  if (!models.SocialShareMessage) {
    class SocialShareMessage extends BapModel {}
    models.SocialShareMessage = SocialShareMessage.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      message: {
        type: DataTypes.TEXT,
        comment: 'message verbiage',
      },
      activities: {
        type: DataTypes.ARRAY(DataTypes.ENUM),
        values: [
          'award_matches',
          'recent_award_target',
          'award_submission',
          'recent_award_submission',
          'award_win',
          'recent_award_win',
          'review_matches',
          'recent_review_target',
          'review_submission',
          'review_results',
          'recent_review_results'
        ],
        comment: 'array of associated activites',
      },
      image: {
        type: DataTypes.ARRAY(DataTypes.ENUM),
        values: ['book_cover', 'author_pic', 'nom_cert', 'bap_nom_badge', 'award_seal', 'bap_win_badge'],
        comment: 'array of associated image types',
      },
    }, {
      sequelize,
      modelName: 'social_share_message',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
  }
  const {SocialShareMessage} = models // eslint-disable-line no-unused-vars

  if (!models.MarketingActivity) {
    class MarketingActivity extends BapModel {}
    models.MarketingActivity = MarketingActivity.init({
      id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
        autoIncrement: true,
        autoIncrementIdentity: true,
      },
      activityName: {
        type: DataTypes.ENUM,
        values: [
          'award_matches',
          'recent_award_target',
          'award_submission',
          'recent_award_submission',
          'award_win',
          'recent_award_win',
          'review_matches',
          'recent_review_target',
          'review_submission',
          'review_results',
          'recent_review_results'
        ],
        allowNull: false,
        comment: 'name of marketing activity',
      },
      weight: {
        type: DataTypes.INTEGER,
        allowNull: false,
        comment: 'weight of marketing activity',
      },
    }, {
      sequelize,
      modelName: 'marketing_activity',
      underscored: true,
      timestamps: true,
      createdAt: 'created',
      updatedAt: 'modified',
    })
  }
  const {MarketingActivity} = models // eslint-disable-line no-unused-vars

  async function rootUser() {
    return await User.findByPk(1)
  }

  async function parentUser(userId) {
    return await sequelize.query(QRY.parentUser, {
      replacements: {userId},
      model: User,
      mapToModel: true,
      plain: true,
    })
  }

  async function rootSettings() {
    return _.first(await sequelize.query(QRY.rootSettings, {
      model: Partner,
      mapToModel: true,
      type: QueryTypes.SELECT,
      limit: 1,
    }))
  }

  async function children(userId) {
    // TODO: use User.build({attrs}) so don't have to duplicate in SQL
    return await sequelize.query(QRY.children, {
      replacements: {userId},
      // model: User,
      // mapToModel: true,
      type: QueryTypes.SELECT,
    })
  }

  async function settingsForUser(userId) {
    let xxx = _.first(await sequelize.query(QRY.userSettings, {
      replacements: {userId},
      model: Partner,
      mapToModel: true,
      type: QueryTypes.SELECT,
      limit: 1,
    }))
    if (!xxx) {
      xxx = await rootSettings()
    }
    return xxx.toJSON()
  }

  // TODO: consider memoizing
  async function settingsForDomain(domain) {
    // NOTE: Important to prefer records created earlier to support multiple
    // partners with same domain. Otherwise, there is potential for the
    // branding to get "hijacked" cuz the wrong partner record was chosen.
    domain = domain.replace(/https?:\/\/([^:]+).*/u, '$1') // eslint-disable-line no-param-reassign
    let xxx = await Partner.findOne({
      where: {domain},
      order: ['id'],
      limit: 1,
    })
    if (!xxx) {
      xxx = await rootSettings()
    }
    return xxx.toJSON()
  }

  return {
    ...models,
    rootUser,
    parentUser,
    children,
    settingsForDomain,
    settingsForUser,
    NotFoundError,
    AccessError,
  }
}
