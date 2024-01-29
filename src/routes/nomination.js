
const _ = require('lodash')
const {createCanvas, registerFont, loadImage} = require('canvas')
const {assetUrl} = require('@bap/cotton/lib')

registerFont('./font/CrimsonText.ttf', {family: 'CrimsonText'})
registerFont('./font/Playball.ttf', {family: 'Playball'})
registerFont('./font/Roboto.ttf', {family: 'Roboto'})

module.exports = ({app, sequelize}) => {

  const model = require('@bap/cotton/model')(sequelize)

  app.get('/nomination-letter/:id', async (req, res) => {
    const id = parseInt(req.params.id)
    await req.user.can('read', model.Match, id)
    const target = await model.Match.findByPk(id, {
      include: [
        model.Book,
        model.Award,
        model.Subscription,
      ],
    })
    const canvas = createCanvas(900, 750)
    const ctx = canvas.getContext('2d')

    let width = null
    let height = null
    let img = await loadImage(assetUrl('/img/cert-frame.png'))
    ctx.drawImage(img, 0, 0, 900, 750)

    ctx.fillStyle = '#fffcfa'
    ctx.fillRect(120, 125, 660, 500)
    ctx.strokeStyle = '#000000'
    ctx.strokeRect(120, 125, 660, 500)

    ctx.textAlign = 'center'

    ctx.font = '32px CrimsonText'
    ctx.fillStyle = '#999999'
    ctx.fillText('CERTIFICATE of', 450, 175)
    ctx.font = '66px Playball'
    ctx.fillStyle = '#42b3ff'
    ctx.fillText('Award Nomination', 450, 250)

    const center = 330
    ctx.font = '20px Playball'
    ctx.fillStyle = '#666666'
    ctx.fillText('It is hereby certified', center, 325)
    ctx.fillText('has successfully been nominated for the award', center, 425)
    ctx.font = '30px CrimsonText'
    ctx.fillStyle = '#333333'
    ctx.fillText(target.book.title, center, 375, 400)
    ctx.fillStyle = '#333333'
    ctx.font = '26px Roboto'
    ctx.fillText(target.award.name, center, 500, 400)
    ctx.font = '20px Roboto'
    ctx.fillText(target.award.category, center, 550)

    img = await loadImage(assetUrl(target.book.thumbnail))
    width = 200
    height = 300
    const ratio = img.height / img.width
    if (ratio > 1.5) {
      // if skinnier than 1.5 (height / width), then constrain width to avoid distortion
      width *= 1.5 / ratio
    } else if (ratio < 1.5) { // too wide
      // if fatter than 1.5 (height / width), then constrain height to avoid distortion
      height *= ratio / 1.5
    }
    ctx.drawImage(img, 0, 0, img.width, img.height, 550, 300, width, height)
    ctx.strokeStyle = '#aaaaaa'
    ctx.strokeRect(550, 300, width, height)

    // branding logos, constrain height while preserving aspect ratio
    const settings = await model.settingsForUser(target.book.userId)
    if (settings.powered) {
      img = await loadImage(assetUrl('/img/logos/bap.png'))
      height = 20
      width = img.width * height / img.height
      ctx.drawImage(img, 530 - width, 595, width, height)
    }
    img = await loadImage(assetUrl(_.get(settings, 'theme.seals.nomination', '/img/seals/nomination.png')))
    ctx.drawImage(img, 635, 505, 200, 154)
    img = await loadImage(assetUrl(settings.thumbnail))
    height = 30
    width = img.width * height / img.height
    ctx.drawImage(img, 130, 590, width, height)

    // const text = ctx.measureText('Awesome!')
    // ctx.strokeStyle = 'rgba(0,0,0,0.5)'
    // ctx.beginPath()
    // ctx.lineTo(50, 102)
    // ctx.lineTo(50 + text.width, 102)
    // ctx.stroke()

    res.set({
      'Content-Type': 'image/jpeg',
      'Content-Disposition': `attachment; filename=Nomination Certificate - ${target.award.name} - ${target.book.title}.jpg`,
    })
    res.end(canvas.toBuffer('image/jpeg'))
  })

}
