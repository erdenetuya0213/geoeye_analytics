import { describe, expect, it } from 'vitest'
import { nextStructureLogVersionNumber, upsertStructureLogVersion } from './structureLogStore.js'
import type { StructureLogVersion } from './structureLogStore.js'

const version = (number: number, set = 'J1'): StructureLogVersion => ({
  holeFilter: 'all',
  rows: [{ observationId: 'OBS-1', jointSet: set }],
  sets: [{ id: set, label: set, color: '#ff0000' }],
  templateId: 'structure-auto-v34',
  updatedAt: '2026-10-01T00:00:00.000Z',
  version: number,
})

describe('structure log version storage', () => {
  it('overwrites the same document version without duplicating it', () => {
    const result = upsertStructureLogVersion([version(34)], version(34, 'J2'))
    expect(result).toHaveLength(1)
    expect(result[0]?.rows[0]?.jointSet).toBe('J2')
  })

  it('keeps a new version as a separate document revision', () => {
    const result = upsertStructureLogVersion([version(34)], version(35))
    expect(result.map((item) => item.version)).toEqual([34, 35])
  })

  it('creates a version after the latest saved revision', () => {
    expect(nextStructureLogVersionNumber([version(34), version(37)], 'structure-auto-v34', 'all', 35)).toBe(38)
    expect(nextStructureLogVersionNumber([version(34)], 'structure-auto-v34', 'TT-2', 34)).toBe(35)
  })
})
