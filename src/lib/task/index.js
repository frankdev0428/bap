
const path = require('path')
const fsp = require('fs').promises
const util = require('util')
const cp = require('child_process')
const exec = util.promisify(cp.exec)
const execFile = util.promisify(cp.execFile)

// const axios = require('axios').create({
//   validateStatus: null,
//   maxContentLength: 99999,
//   poll: {
//     maxSockets: 500,
//   },
//   timeout: 5000,
// })

const catalog = {}

catalog['Optimize PDF'] = {
  retries: 0,
  timeout: 3600,
  ttl: 30 * 86400,
  key: data => `Optimize PDF : ${data.url}`,
  run: async ({task, log, model, asset}) => {
    const book = await model.Book.findByPk(task.data.bookId)
    if (!book) {
      log.warn({id: String(task.data.bookId)}, 'no book found for pdf:', task.data.url)
      return {}
    }
    const dst = `${process.env.UPLOADS_DIR}/${book.id}.pdf`
    const orig = asset.curKey('book-copies', task.data.url)
    await asset.download(orig, dst)
    let optimized = dst + '.opt'
    const args = ['-sDEVICE=pdfwrite', '-dCompatibilityLevel=2.0', '-dPDFSETTINGS=/ebook', '-dNOPAUSE', '-dBATCH', `-sOutputFile=${optimized}`, dst]
    const gs = await execFile('gs', args, {})
    const m = gs.stdout.match(/processing pages 1 through (?<pages>\d+)/iu)
    if (m) {
      book.pageCount = parseInt(m.groups.pages)
    }
    const ps2ascii = await exec(`ps2ascii ${dst} | wc -w`)
    book.wordCount = parseInt(ps2ascii.stdout.trim())
    if (book.cover) {
      // only check if a cover is needed if there is a book cover to prepend
      const pdftotext = await execFile('pdftotext', ['-f', 1, '-l', 1, optimized, '-'])
      if (pdftotext.stdout.length > 1) {
        // some text is a good indicator that there is no image on first page
        const pdfimages = await execFile('pdfimages', ['-f', 1, '-l', 1, '-list', optimized])
        let width = 0
        let height = 0
        for (const line of pdfimages.stdout.split('\n')) {
          const fields = line.split(/\s+/ug)
          if (fields[3] === 'image') {
            width = parseInt(fields[4])
            height = parseInt(fields[5])
            break
          }
        }
        if (width < 800 || height < 800) {
          // prepend cover image. NOTE: using img2pdf then pdfunite instead of
          // something like imagemagick that will rasterize the entire pdf
          const coverimg = `${process.env.UPLOADS_DIR}/${book.id}-cover.jpg`
          await asset.download(asset.curKey('book-covers', book.cover), coverimg)
          const coverpdf = `${process.env.UPLOADS_DIR}/${book.id}-cover.pdf`
          const img2pdf = await execFile('img2pdf', ['--auto-orient', '--fit', 'shrink', '--pagesize', 'Letter', '-o', coverpdf, coverimg])
          if (img2pdf.stderr) {
            log.error({id: String(book.id)}, 'failed to convert cover image:', img2pdf.stderr)
          } else {
            await fsp.unlink(coverimg)
            const pdfunite = await execFile('pdfunite', [coverpdf, optimized, optimized + '.cov'])
            if (pdfunite.stderr) {
              log.error({id: String(book.id)}, 'failed to prepend cover image:', pdfunite.stderr)
            } else {
              await fsp.unlink(coverpdf)
              await fsp.unlink(optimized)
              optimized += '.cov'
              log.warn({id: String(book.id)}, 'added cover image:', book.id)
            }
          }
        }
      }
    }
    const upload = await asset.uploadFile(optimized, asset.newKey('book-copies', book.id) + '.pdf')
    book.copies.pdf = upload.url
    book.changed('copies', true)
    await book.save()
    await fsp.unlink(dst)
    await asset.safeDeleteUpload(orig)
    return {pdf: upload.url}
  },
}

catalog['Target Renewal'] = {
  retries: 0,
  timeout: 300,
  ttl: 3 * 86400,
  key: data => `Target Renewal : ${data.id}`,
  run: async ({task}) => {
    const args = [
      '-r', 'dotenv/config',
      './bin/cupid.js',
      '-v', 'info',
      '--matching', 'none',
      '--targeting', 'webhook',
      task.data.id,
    ]
    const cwd = path.resolve(__dirname + '/../..') // eslint-disable-line no-path-concat
    const {stdout, stderr} = await execFile('node', args, {cwd})
    return {stdout, stderr}
  },
}

module.exports = ({sequelize}) => {
  const {Task} = require('@bap/cotton/model')(sequelize)

  async function add(name, data = {}) {
    const task = catalog[name]
    if (!task) {
      throw new Error(`task type not in catalog: ${name}`)
    }
    const key = task.key(data)
    const existing = await Task.count({where: {key}})
    if (existing) {
      return false
    }
    await Task.create({
      name,
      key,
      data,
      timeout: task.timeout,
      ttl: task.ttl,
    })
    return true
  }

  const spec = name => catalog[name]

  async function run({task, ...deps}) {
    return await catalog[task.name].run({task, ...deps})
  }

  return {
    spec,
    add,
    run,
  }
}
