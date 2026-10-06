import { expect, it } from 'vitest'
import { importLocationColumns, readImportLocation } from './import-location.js'
it('shares point and interval keys across header aliases', () => {
  const point = readImportLocation(['TT_004', '12.5'], importLocationColumns(['Hole_ID', 'Depth (m)']))
  const interval = readImportLocation(['tt-004', '12.5', '12.5'], importLocationColumns(['BHID', 'Start Depth (m)', 'End Depth (m)']))
  expect(point.valid).toBe(true)
  expect(point.key).toBe(interval.key)
})
it('keeps missing and invalid locations unmatched without inventing depths', () => {
  const columns = importLocationColumns(['Hole ID', 'From', 'To', 'Depth'])
  for (const row of [['H1', '', '', '12'], ['H1', '12', '10', ''], ['', '0', '1', ''], ['H1', '-1', '1', '']]) {
    expect(readImportLocation(row, columns).valid).toBe(false)
  }
  expect(readImportLocation(['H1', '0', '1', ''], columns).valid).toBe(true)
})
