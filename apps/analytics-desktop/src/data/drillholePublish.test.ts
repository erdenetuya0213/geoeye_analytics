import { describe, expect, it } from 'vitest'
import { planDrillholePublish } from './drillholePublish.js'

const holes = [
  { id: 'hole-103', name: 'UDD-103' },
  { id: 'hole-104', name: 'UDD-104' },
]

describe('planDrillholePublish', () => {
  it('matches hole names regardless of case and spacing and sorts stations by depth', () => {
    const plan = planDrillholePublish({
      collar: [{ holeId: ' udd-103 ', easting: 512345.6, northing: 5300120.1, elevation: 1420.5 }],
      survey: [
        { holeId: 'UDD-103', depth: 30, azimuth: 271.5, dip: -59.2 },
        { holeId: 'udd-103', depth: 0, azimuth: 360, dip: -60 },
      ],
    }, holes)

    expect(plan.collars).toEqual([
      { holeId: 'hole-103', holeName: 'UDD-103', easting: 512345.6, northing: 5300120.1, elevation: 1420.5 },
    ])
    expect(plan.surveys).toEqual([{
      holeId: 'hole-103',
      holeName: 'UDD-103',
      stations: [
        { measuredDepth: 0, azimuth: 0, dip: -60 },
        { measuredDepth: 30, azimuth: 271.5, dip: -59.2 },
      ],
    }])
    expect(plan.unknownHoles).toEqual([])
    expect(plan.rejected).toEqual([])
  })

  it('matches collar and survey identifiers despite underscores and hyphens', () => {
    const plan = planDrillholePublish({
      collar: [{ holeId: 'TT_2026_002GT', easting: 585_434.39, northing: 5_461_562.18, elevation: 991.66 }],
      survey: [{ holeId: 'TT2026-002-GT', depth: 0, azimuth: 340, dip: 60 }],
    }, [{ id: 'hole-gt-2', name: 'TT_2026_002GT' }])

    expect(plan.collars[0]?.holeId).toBe('hole-gt-2')
    expect(plan.surveys[0]).toMatchObject({ holeId: 'hole-gt-2', stations: [{ measuredDepth: 0 }] })
    expect(plan.unknownHoles).toEqual([])
  })

  it('reports holes that the Data Pool project does not contain', () => {
    const plan = planDrillholePublish({
      collar: [{ holeId: 'GOR-DD-018', easting: 1, northing: 2, elevation: 3 }],
      survey: [{ holeId: 'GOR-DD-017', depth: 0, azimuth: 10, dip: -60 }],
    }, holes)

    expect(plan.collars).toEqual([])
    expect(plan.surveys).toEqual([])
    expect(plan.unknownHoles).toEqual(['GOR-DD-017', 'GOR-DD-018'])
  })

  it('rejects a whole survey when any station is invalid', () => {
    const plan = planDrillholePublish({
      collar: [],
      survey: [
        { holeId: 'UDD-103', depth: 0, azimuth: 270, dip: -60 },
        { holeId: 'UDD-103', depth: 30, azimuth: 400, dip: -60 },
        { holeId: 'UDD-104', depth: 10, azimuth: 90, dip: -55 },
        { holeId: 'UDD-104', depth: 10, azimuth: 91, dip: -56 },
      ],
    }, holes)

    expect(plan.surveys).toEqual([])
    expect(plan.rejected).toEqual([
      'UDD-103: azimuth 400 is outside 0-360',
      'UDD-104: depth 10 appears more than once',
    ])
  })

  it('rejects blank collar coordinates and duplicate collar rows', () => {
    const plan = planDrillholePublish({
      collar: [
        { holeId: 'UDD-103', easting: 0, northing: 0, elevation: 0 },
        { holeId: 'UDD-104', easting: 512000, northing: 5300000, elevation: 1400 },
        { holeId: 'UDD-104', easting: 512001, northing: 5300001, elevation: 1401 },
      ],
      survey: [],
    }, holes)

    expect(plan.collars).toEqual([])
    expect(plan.rejected).toEqual([
      'UDD-103: collar coordinates are missing or not numeric',
      'UDD-104: more than one collar row',
    ])
  })
})
