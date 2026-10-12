const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { validateChartImages, writeChartImages } = require('../electron/chart-export.cjs')
const svg = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0L1 1"/></svg>'
const item = { name: 'reference-01', format: 'svg', dataUrl: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}` }

test('accepts self-contained ECharts SVG and rejects executable or linked content', () => {
  assert.equal(validateChartImages({ images: [item] })[0].bytes.toString(), svg)
  for (const bad of ['<script/>', '<foreignObject/>', '<image href="x"/>', '<path onclick="x"/>', '<style>x{fill:url(https://example.com)}</style>']) {
    assert.throws(() => validateChartImages({ images: [{ ...item, dataUrl: 'data:image/svg+xml,' + encodeURIComponent(`<svg>${bad}</svg>`) }] }))
  }
  for (const name of ['../secret', 'CON', 'a/b', '']) assert.throws(() => validateChartImages({ images: [{ ...item, name }] }))
  assert.throws(() => validateChartImages({ images: [{ ...item, format: 'png' }] }))
  assert.throws(() => validateChartImages({ images: [item, item] }))
})

test('preserves existing exports and appends a suffix', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'geoeye-chart-export-'))
  try {
    const images = validateChartImages({ images: [item] })
    const first = writeChartImages(directory, images)
    const next = writeChartImages(directory, images)
    assert.equal(path.basename(first[0]), 'reference-01.svg')
    assert.equal(path.basename(next[0]), 'reference-01-1.svg')
    assert.equal(fs.readFileSync(first[0], 'utf8'), svg)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})
