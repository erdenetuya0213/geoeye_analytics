const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path')
const { fileStem, saveExportBundle, suggestExportNames } = require('../electron/export-bundle.cjs')
const png = 'data:image/png;base64,' + Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(8)]).toString('base64')

test('suggests "<graph name> <n>" per feature folder and never overwrites', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'geoeye-export-'))
  const first = suggestExportNames({ projectPath, feature: 'statistics', files: [{ name: 'Histogram', kind: 'png' }, { name: 'Histogram', kind: 'png' }, { name: 'Summary', kind: 'csv' }] })
  assert.equal(first.directory, path.join(projectPath, 'Statistics', 'export'))
  assert.deepEqual(first.names, ['Histogram 1', 'Histogram 2', 'Summary 1'])

  const saved = saveExportBundle({ projectPath, feature: 'statistics', files: [{ name: 'Histogram 1', kind: 'png', dataUrl: png }, { name: 'Summary 1', kind: 'csv', contents: 'a\n1\n' }] })
  assert.deepEqual(saved.paths.map((p) => path.basename(p)), ['Histogram 1.png', 'Summary 1.csv'])
  assert.deepEqual(suggestExportNames({ projectPath, feature: 'statistics', files: [{ name: 'Histogram', kind: 'png' }] }).names, ['Histogram 2'])

  // A name that already exists (or repeats in the batch) moves to the next free number.
  const again = saveExportBundle({ projectPath, feature: 'statistics', files: [{ name: 'Histogram 1', kind: 'png', dataUrl: png }, { name: 'Histogram 1', kind: 'png', dataUrl: png }] })
  assert.deepEqual(again.paths.map((p) => path.basename(p)), ['Histogram 2.png', 'Histogram 3.png'])
})

test('feature folders follow the sidebar names', () => {
  const projectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'geoeye-export-'))
  const saved = saveExportBundle({ projectPath, feature: '3d', files: [{ name: 'Scene', kind: 'png', dataUrl: png }] })
  assert.equal(path.dirname(saved.paths[0]), path.join(projectPath, '3D Analysis', 'export'))
  assert.equal(suggestExportNames({ projectPath, feature: 'geotechnical', files: [{ name: 'RMR', kind: 'csv' }] }).directory, path.join(projectPath, 'Geotech', 'export'))
  assert.throws(() => suggestExportNames({ projectPath, feature: 'nope', files: [] }), /Unknown export feature/)
  assert.throws(() => saveExportBundle({ projectPath, feature: 'grade', files: [{ name: 'a', kind: 'png', dataUrl: 'data:image/png;base64,AAAA' }] }), /Invalid PNG/)
})

test('file stems keep spaces and drop characters Windows rejects', () => {
  assert.equal(fileStem('Histogram · Strength_MPa · Test_Type: UCS'), 'Histogram - Strength_MPa - Test_Type - UCS')
  assert.equal(fileStem('a/b\\c?*'), 'a-b-c-')
})
