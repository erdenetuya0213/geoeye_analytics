import { DataPoolClient, type FieldLoggingDataset } from '@geoeye/datapool-client'
import { describe, expect, it, vi } from 'vitest'
import {
  createLocalDrillholeDraft,
  createLocalTabularDraft,
  effectiveDrillholes,
  effectiveSurveysByHoleId,
  loadLocalProjectSnapshot,
  readLocalProjectRecord,
  writeLocalProjectRecord,
  type LocalProjectSnapshot,
} from './localProjectDb.js'

const snapshot: LocalProjectSnapshot = {
  datasets: [],
  drillholes: [{
    collar: null,
    id: 'hole-1',
    name: 'DH-001',
    projectId: 'project-1',
    surveyStationCount: 0,
  }],
  fieldLogging: { projectId: 'project-1', submissions: [], templates: [] },
  fieldStructures: [],
  observations: [],
  project: {
    canWrite: true,
    description: null,
    drillholeCount: 1,
    id: 'project-1',
    isActive: true,
    name: 'Local project',
    organizationId: null,
    organizationName: null,
  },
  projection: [],
  refreshedAt: '2026-10-04T00:00:00.000Z',
  surveysByHoleId: {},
  variables: [],
  version: 1,
}

describe('local project database', () => {
  it('refreshes the current filled templates across all holes without keeping completed CSV copies', async () => {
    const client = new DataPoolClient({ endpoint: 'https://example.invalid', fetch: vi.fn() })
    const live: FieldLoggingDataset = {
      id: 'structure-template', name: 'Structure auto', category: 'structure', version: 35,
      updatedAt: '2026-10-05T00:00:00.000Z',
      columns: [{ key: 'joint_spacing_m', label: 'Joint spacing', dataType: 'numeric', unit: 'm' }],
      records: ['hole-1', 'hole-2', 'hole-3'].map((holeId, index) => ({
        id: `row-${index}`, holeId, depthFrom: 0, depthTo: 3, values: { joint_spacing_m: 0.2 },
      })),
    }
    const completed = { ...live, id: 'structure-template:generated:v34', version: 34, records: live.records.slice(0, 1) }
    vi.spyOn(client, 'variables').mockResolvedValue([])
    vi.spyOn(client, 'datasets').mockResolvedValue([])
    vi.spyOn(client, 'drillholes').mockResolvedValue(snapshot.drillholes)
    vi.spyOn(client, 'projectionStatus').mockResolvedValue([])
    vi.spyOn(client, 'fieldLoggingStructures').mockResolvedValue([])
    const logging = vi.spyOn(client, 'fieldLogging').mockResolvedValue({
      ...snapshot.fieldLogging, datasets: [live, completed],
      templates: [{ id: live.id, name: live.name, version: live.version }],
    })
    const first = await loadLocalProjectSnapshot(client, snapshot.project)
    expect(first.fieldLogging.datasets).toEqual([live])
    expect(first.fieldLogging.datasets![0]!.records.map(row => row.holeId)).toEqual(['hole-1', 'hole-2', 'hole-3'])

    // The next refresh replaces old values, removed rows and schema versions.
    const updated = { ...live, version: 36, records: [
      { ...live.records[0]!, values: { joint_spacing_m: 0.8 } },
      ...live.records.slice(2),
    ] }
    logging.mockResolvedValue({ ...snapshot.fieldLogging, datasets: [updated, completed],
      templates: [{ id: live.id, name: live.name, version: updated.version }],
    })
    const second = await loadLocalProjectSnapshot(client, snapshot.project)
    expect(second.fieldLogging.datasets).toEqual([updated])
    expect(second.fieldLogging.templates[0]?.version).toBe(36)
    expect(first.fieldLogging.datasets![0]!.records[0]!.values.joint_spacing_m).toBe(0.2)
    expect(logging).toHaveBeenCalledTimes(2)
    expect(logging).toHaveBeenLastCalledWith(snapshot.project.id)
  })

  it('layers an unsent drillhole import over the saved cloud snapshot', () => {
    const draft = createLocalDrillholeDraft({
      collar: [{ crs: 'EPSG:32648', easting: 501_000, elevation: 1_420, holeId: 'dh-001', northing: 5_301_000 }],
      survey: [
        { azimuth: 40, depth: 0, dip: -60, holeId: 'DH-001' },
        { azimuth: 42, depth: 100, dip: -61, holeId: 'DH-001' },
      ],
    })

    const holes = effectiveDrillholes(snapshot, draft)
    const surveys = effectiveSurveysByHoleId(snapshot, draft)

    expect(holes).toHaveLength(1)
    expect(holes[0]?.name).toBe('dh-001')
    expect(holes[0]?.collar?.easting).toBe(501_000)
    expect(holes[0]?.surveyStationCount).toBe(2)
    expect(surveys['hole-1']?.map((station) => station.measuredDepth)).toEqual([0, 100])
  })

  it('joins collar and survey rows when the same hole uses different separators', () => {
    const formattedSnapshot: LocalProjectSnapshot = {
      ...snapshot,
      drillholes: [{ ...snapshot.drillholes[0]!, name: 'TT_2026_002GT' }],
    }
    const draft = createLocalDrillholeDraft({
      collar: [{ easting: 585_434.39, elevation: 991.66, holeId: 'TT_2026_002GT', northing: 5_461_562.18 }],
      survey: [
        { azimuth: 340, depth: 0, dip: 60, holeId: 'TT2026-002-GT' },
        { azimuth: 341, depth: 50, dip: 60.5, holeId: 'TT2026-002-GT' },
      ],
    })

    const holes = effectiveDrillholes(formattedSnapshot, draft)
    const surveys = effectiveSurveysByHoleId(formattedSnapshot, draft)

    expect(holes).toHaveLength(1)
    expect(holes[0]).toMatchObject({ id: 'hole-1', name: 'TT_2026_002GT', surveyStationCount: 2 })
    expect(surveys['hole-1']?.map((station) => station.measuredDepth)).toEqual([0, 50])
  })

  it('keeps the local snapshot and dirty draft available after a storage round trip', async () => {
    const key = `test-local-project-${Date.now()}`
    const draft = createLocalDrillholeDraft({ collar: [], survey: [] })
    await writeLocalProjectRecord({ draft, key, snapshot })

    await expect(readLocalProjectRecord(key)).resolves.toEqual({ draft, key, snapshot })
  })

  it('marks imported feature rows dirty until the user saves them to the Database', () => {
    const draft = createLocalTabularDraft({
      columns: ['Hole ID', 'Cu ppm'],
      fileName: 'xrf.csv',
      rows: [['DH-001', '1250']],
      section: 'xrf',
    })

    expect(draft).toMatchObject({ dirty: true, fileName: 'xrf.csv', section: 'xrf' })
    expect(draft.rows).toEqual([['DH-001', '1250']])
  })
})
