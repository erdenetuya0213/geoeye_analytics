// Writes screen results into <project>/<Feature>/export/ — one folder per app feature, named like the sidebar.
// Files are named "<graph name> <n>"; existing files are never overwritten.
const fs = require('node:fs')
const path = require('node:path')

const FEATURE_FOLDERS = {
  data: 'Data', statistics: 'Statistics', multivariate: 'Multivariate', domain: 'Domain', grade: 'Grade',
  variography: 'Variography', structure: 'Structure', geotechnical: 'Geotech', custom: 'Custom', '3d': '3D Analysis',
  operations: 'Operations',
}
const KINDS = new Set(['png', 'csv', 'json', 'txt', 'svg'])

/** Windows-safe file stem that keeps spaces and readable punctuation. */
const fileStem = (value) => String(value ?? '')
  .replace(/\s*[·:]\s*/g, ' - ')
  .replace(/[<>"/\\|?*\u0000-\u001f]+/g, '-')
  .replace(/\s+/g, ' ')
  .replace(/^[\s.-]+|[\s.]+$/g, '')
  .slice(0, 150)

function exportDirectory(projectPath, feature) {
  const folder = FEATURE_FOLDERS[feature]
  if (folder === undefined) throw new Error(`Unknown export feature: ${feature}`)
  return path.join(projectPath, folder, 'export')
}

/** Next free "<base> <n>" (n ≥ 1) for each file; names reserved in the same batch count as taken. */
function nextNames(directory, files) {
  const taken = new Set()
  return files.map((file) => {
    if (!KINDS.has(file.kind)) throw new Error(`Unsupported export kind: ${file.kind}`)
    const base = fileStem(file.name).replace(/ \d+$/, '') || 'Graph'
    for (let n = 1; ; n += 1) {
      const name = `${base} ${n}`
      const key = `${name}.${file.kind}`.toLowerCase()
      if (!taken.has(key) && !fs.existsSync(path.join(directory, `${name}.${file.kind}`))) { taken.add(key); return name }
    }
  })
}

function suggestExportNames({ projectPath, feature, files }) {
  const directory = exportDirectory(projectPath, feature)
  return { directory, names: nextNames(directory, files) }
}

function decode(file) {
  if (file.kind === 'png') {
    const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(file.dataUrl ?? '')
    if (!match) throw new Error(`Invalid PNG for ${file.name}`)
    const bytes = Buffer.from(match[1], 'base64')
    if (bytes.length > 64 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error(`Invalid PNG for ${file.name}`)
    return bytes
  }
  if (KINDS.has(file.kind)) {
    if (typeof file.contents !== 'string' || Buffer.byteLength(file.contents) > 128 * 1024 * 1024) throw new Error(`Invalid ${file.kind} for ${file.name}`)
    if (file.kind === 'svg' && /<script|<foreignObject|on[a-z]+=|href\s*=\s*"(?!#)/i.test(file.contents)) throw new Error('SVG contains disallowed content')
    return Buffer.from(file.contents, 'utf8')
  }
  throw new Error(`Unsupported export kind: ${file.kind}`)
}

/** Saves each file as "<name>.<kind>"; a name that already exists moves to the next free number. */
function saveExportBundle({ projectPath, feature, files }) {
  if (!Array.isArray(files) || files.length === 0 || files.length > 60) throw new Error('Nothing to export.')
  const directory = exportDirectory(projectPath, feature)
  const prepared = files.map((file) => ({ bytes: decode(file), file, stem: fileStem(file.name) }))
  if (prepared.some((item) => !item.stem)) throw new Error('Every file needs a name.')
  fs.mkdirSync(directory, { recursive: true })
  const written = []
  for (const { bytes, file, stem } of prepared) {
    // Files written earlier in this batch are already on disk, so the same check covers duplicates within the batch.
    const name = fs.existsSync(path.join(directory, `${stem}.${file.kind}`)) ? nextNames(directory, [{ name: stem, kind: file.kind }])[0] : stem
    const target = path.join(directory, `${name}.${file.kind}`)
    fs.writeFileSync(target, bytes)
    written.push(target)
  }
  return { directory, paths: written }
}

module.exports = { FEATURE_FOLDERS, fileStem, saveExportBundle, suggestExportNames }
