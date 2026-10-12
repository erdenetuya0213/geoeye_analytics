const fs = require('node:fs')
const path = require('node:path')

function validateChartImages(input) {
  if (!Array.isArray(input?.images) || input.images.length < 1 || input.images.length > 2) throw new Error('Choose one or two chart images.')
  const names = new Set()
  return input.images.map(image => {
    if (!['png', 'svg'].includes(image?.format)) throw new Error('Only PNG and SVG charts can be exported.')
    if (typeof image.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(image.name) || /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i.test(image.name)) throw new Error('Invalid chart file name.')
    const name = `${image.name}.${image.format}`
    if (names.has(name)) throw new Error('Duplicate chart image.')
    names.add(name)
    if (typeof image.dataUrl !== 'string' || image.dataUrl.length > 40_000_000) throw new Error('Invalid chart image size.')
    let bytes
    if (image.format === 'png') {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl)
      if (!match) throw new Error('Invalid PNG encoding.')
      bytes = Buffer.from(match[1], 'base64')
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG signature.')
    } else {
      const match = /^data:image\/svg\+xml(?:;charset=[^;,]+)?(;base64)?,(.*)$/s.exec(image.dataUrl)
      if (!match) throw new Error('Invalid SVG encoding.')
      const svg = match[1] ? Buffer.from(match[2], 'base64').toString('utf8') : decodeURIComponent(match[2])
      if (!/^\s*<svg\b/i.test(svg) || !/<\/svg>\s*$/i.test(svg) || /<(?:script|foreignObject|image|iframe|object|embed)\b|\son[a-z]+\s*=|(?:href|src)\s*=|<!DOCTYPE|<!ENTITY|url\(\s*['"]?(?!#)/i.test(svg)) throw new Error('SVG must be a self-contained static chart.')
      bytes = Buffer.from(svg, 'utf8')
    }
    return { name, bytes }
  })
}

// A directory is chosen in the native dialog, never accepted from renderer input.
// Existing exports are preserved; all formats in a batch receive the same suffix.
function writeChartImages(directory, images) {
  let suffix = 0
  const target = (image) => path.join(directory, suffix ? image.name.replace(/\.(png|svg)$/, `-${suffix}.$1`) : image.name)
  while (images.some(image => fs.existsSync(target(image)))) suffix++
  const paths = []
  for (const image of images) {
    const file = target(image)
    fs.writeFileSync(file, image.bytes, { flag: 'wx' })
    paths.push(file)
  }
  return paths
}

module.exports = { validateChartImages, writeChartImages }
