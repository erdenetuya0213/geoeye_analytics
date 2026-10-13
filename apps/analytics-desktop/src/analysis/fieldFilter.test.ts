import { expect, it } from 'vitest'
import { filterSummary, matchesFieldFilters, normalizeFilter } from './fieldFilter.js'

const row = (lithology: string, rqd: number | null) => ({ dimensions: { lithology }, values: { 'logging.rqd': rqd } })

it('keeps the rows whose category is one of the chosen values', () => {
  const filters = { lithology: { kind: 'category' as const, values: ['LST', 'DOL'] } }
  expect(matchesFieldFilters(row('LST', 80), ['lithology'], filters)).toBe(true)
  expect(matchesFieldFilters(row('DOL', 80), ['lithology'], filters)).toBe(true)
  expect(matchesFieldFilters(row('AND', 80), ['lithology'], filters)).toBe(false)
  // No value chosen is "all", and a row without the field counts as Unassigned.
  expect(matchesFieldFilters(row('AND', 80), ['lithology'], { lithology: { kind: 'category', values: [] } })).toBe(true)
  expect(matchesFieldFilters({ dimensions: {} }, ['lithology'], { lithology: { kind: 'category', values: ['Unassigned'] } })).toBe(true)
})

it('reads a number filter as less than, more than or between', () => {
  const keys = ['logging.rqd']
  expect(matchesFieldFilters(row('LST', 80), keys, { 'logging.rqd': { kind: 'number', max: 75, min: null } })).toBe(false)
  expect(matchesFieldFilters(row('LST', 80), keys, { 'logging.rqd': { kind: 'number', max: null, min: 75 } })).toBe(true)
  expect(matchesFieldFilters(row('LST', 80), keys, { 'logging.rqd': { kind: 'number', max: 90, min: 75 } })).toBe(true)
  expect(matchesFieldFilters(row('LST', 95), keys, { 'logging.rqd': { kind: 'number', max: 90, min: 75 } })).toBe(false)
  // A row that has no number cannot satisfy a range.
  expect(matchesFieldFilters(row('LST', null), keys, { 'logging.rqd': { kind: 'number', max: null, min: 75 } })).toBe(false)
  expect(matchesFieldFilters(row('LST', null), keys, { 'logging.rqd': { kind: 'number', max: null, min: null } })).toBe(true)
})

it('still honours single-value filters saved by an earlier build', () => {
  expect(normalizeFilter('all')).toBeNull()
  expect(matchesFieldFilters(row('LST', 80), ['lithology'], { lithology: 'LST' })).toBe(true)
  expect(matchesFieldFilters(row('AND', 80), ['lithology'], { lithology: 'LST' })).toBe(false)
  expect(matchesFieldFilters(row('AND', 80), ['lithology'], { lithology: 'all' })).toBe(true)
})

it('summarises a filter the way a run should report it', () => {
  expect(filterSummary('Lithology', { kind: 'category', values: ['LST', 'DOL'] })).toBe('Lithology: LST, DOL')
  expect(filterSummary('RQD', { kind: 'number', max: 80, min: 50 })).toBe('RQD 50–80')
  expect(filterSummary('RQD', { kind: 'number', max: 80, min: null })).toBe('RQD ≤ 80')
  expect(filterSummary('RQD', { kind: 'number', max: null, min: 50 })).toBe('RQD ≥ 50')
  expect(filterSummary('RQD', undefined)).toBe('RQD: all')
})
