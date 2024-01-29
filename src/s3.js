
const _ = require('lodash')
const fs = require('fs')
const fsp = require('fs').promises
const util = require('util')
const cp = require('child_process')
const execFile = util.promisify(cp.execFile)

function withScheme(url) {
  if (!url.startsWith('http')) {
    url = 'https://' + url // eslint-disable-line no-param-reassign
  }
  return url
}

const EXTENSIONS = {
  'application/pdf': 'jpg', // use the first page
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'png', // converted to PNG since react-pdf no likey
}

module.exports = ({log, s3}) => {

  async function uploadImage(mimetype, path, key, dimensions) {
    const ext = EXTENSIONS[mimetype]
    if (!ext) {
      throw new Error(`unsupported file type: ${mimetype}`)
    }
    const optimized = `${path}.${ext}`
    // reference: https://www.smashingmagazine.com/2015/06/efficient-image-resizing-with-imagemagick/
    const args = [
      // conver first element in case it is an animated image or a pdf
      `${path}[0]`,
      // resampling: interpolate using 2 surrounding pixels, disable jpeg fancy upsampling
      '-filter', 'Triangle', '-define', 'filter:support=2',
      '-define', 'jpeg:fancy-upsampling=off',
      // sharpen a bit
      '-unsharp', '0.25x0.08+8.3+0.045',
      // turn off dithering
      '-dither', 'None',
      // color reduction
      '-posterize', '136', '-colorspace', 'sRGB',
      // png stuff
      '-define', 'png:compression-filter=5', '-define', 'png:compression-level=9', '-define', 'png:compression-strategy=1',
      // strip image of metadata
      '-strip', '-define', 'png:exclude-chunk=all',
      // disable progressive rendering
      '-interlace', 'none',
      // reduce file size
      '-density', '72x72', '-units', 'PixelsPerInch',
      // jpeg/png compression level
      '-quality', '82%',
    ]
    // NOTE: using -thumbnail instead of -resize since that seems to be better for resampling (blows it up, interpolates, then shrinks it to size?)
    if (dimensions != 'nogo') {
      if (dimensions) {
        args.push(['-thumbnail', dimensions])
      } else {
        // no wider and no taller than 1200px while preserving aspect ratio
        args.push(['-thumbnail', '1200x>', '-thumbnail', 'x1200>'])
        // no thinner and no shorter than 400px while preserving aspect ratio
        args.push(['-thumbnail', '400x<', '-thumbnail', 'x400<'])
      }
    }
    args.push(optimized)
    await execFile('convert', _.flatten(args), {})
    const url = await new Promise((resolve, reject) => {
      s3.upload({
        ACL: 'public-read',
        Body: fs.createReadStream(optimized),
        Key: key,
        ContentType: mimetype,
        ContentDisposition: 'inline',
      }).send((errS3, data) => {
        if (errS3) {
          reject(errS3)
        } else {
          resolve(data.Location)
        }
      })
    }).finally(async () => {
      await fsp.unlink(optimized)
    })
    return {url: withScheme(url)}
  }

  async function uploadFile(path, key) {
    const ext = key.split('.').pop()
    const url = withScheme(await new Promise((resolve, reject) => {
      s3.upload({
        ACL: 'public-read',
        Body: fs.createReadStream(path),
        Key: key,
        ContentType: `application/${ext}`,
        ContentDisposition: 'attachment',
      }).send(async (errS3, data) => {
        await fsp.unlink(path)
        if (errS3) {
          reject(errS3)
        } else {
          resolve(data.Location)
        }
      })
    }))
    return {url}
  }

  async function deleteUpload(key) {
    return await new Promise((resolve, reject) => {
      s3.deleteObject({Key: key}, (errS3, data) => {
        if (errS3) {
          reject(errS3)
        } else {
          resolve(data)
        }
      })
    })
  }

  async function safeDeleteUpload(...keys) {
    for (const key of _.filter(keys)) {
      try {
        await deleteUpload(key)
      } catch (err) {
        log.error(err, 'failed to delete upload:', key)
      }
    }
  }

  function curKey(basedir, url) {
    return url ? url.slice(url.indexOf(basedir)) : null
  }

  function newKey(basedir, id) {
    return `${basedir}/${id}-${new Date().getTime()}`
  }

  async function download(key, path) {
    return await new Promise((resolve, reject) => {
      s3.getObject({Key: key}, async (errS3, data) => {
        if (errS3) {
          reject(errS3)
        } else {
          await fsp.writeFile(path, data.Body)
          resolve(path)
        }
      })
    })
  }

  async function uploadAuthorPhoto(author, path) {
    const old = curKey('author-photos', author.photo)
    const key = newKey('author-photos', author.id)
    await uploadImage('image/jpeg', path, key)
    await uploadImage('image/jpeg', path, `${key}-thumb`, '100x')
    await fsp.unlink(path)
    await safeDeleteUpload(old, `${old}-thumb`)
    return `/assets/${key}`
  }

  async function uploadBookCover(book, path) {
    const old = curKey('book-covers', book.cover)
    const key = newKey('book-covers', book.id)
    await uploadImage('image/jpeg', path, key)
    await uploadImage('image/jpeg', path, `${key}-thumb`, '200x')
    await fsp.unlink(path)
    await safeDeleteUpload(old, `${old}-thumb`)
    return `/assets/${key}`
  }

  async function uploadAnnouncementFile(announcement, file) {
    let ext = file.originalname.split('.').pop().toLowerCase()
    if (ext === 'jpeg') {
      ext = 'jpg'
    }
    const key = newKey('announcements', announcement.id) + '.' + ext
    if (['png', 'gif', 'jpg'].indexOf(ext) !== -1) {
      await uploadImage(`image/${ext}`, file.path, key)
      await fsp.unlink(file.path)
    } else {
      await uploadFile(file.path, key)
      // if (ext === 'pdf') {
      //   // TODO: this task is too book-centric
      //   await libtask.add('Optimize PDF', {url: upload.url, announcementId: announcement.id})
      // }
    }
    return `/assets/${key}`
  }

  return {
    download,
    uploadImage,
    uploadFile,
    deleteUpload,
    safeDeleteUpload,
    curKey,
    newKey,
    uploadAnnouncementFile,
    uploadAuthorPhoto,
    uploadBookCover,
  }
}
