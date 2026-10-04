/**
 * Turns a collar/survey CSV import into Data Pool writes.
 *
 * Collar and survey rows are matched to drillholes that Field already created.
 * Nothing is sent for a hole unless every one of its rows is valid, so a bad
 * file can never replace a good survey with a partial one.
 */

export interface PublishHole {
  id: string
  name: string
}

export interface PublishCollarRow {
  holeId: string
  easting: number
  northing: number
  elevation: number
}

export interface PublishSurveyRow {
  holeId: string
  depth: number
  azimuth: number
  dip: number
}

export interface PlannedCollar {
  holeId: string
  holeName: string
  easting: number
  northing: number
  elevation: number
}

export interface PlannedSurvey {
  holeId: string
  holeName: string
  stations: Array<{ measuredDepth: number; azimuth: number; dip: number }>
}

export interface DrillholePublishPlan {
  collars: PlannedCollar[]
  surveys: PlannedSurvey[]
  /** Hole names in the files that do not exist in the Data Pool project. */
  unknownHoles: string[]
  /** One line per rejected hole, ready to show to the user. */
  rejected: string[]
}

function holeKey(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** Azimuth 360 is the same bearing as 0; anything else out of range is an error. */
function normalizedAzimuth(azimuth: number): number | null {
  if (!Number.isFinite(azimuth) || azimuth < 0 || azimuth > 360) return null
  return azimuth === 360 ? 0 : azimuth
}

export function planDrillholePublish(
  input: { collar: readonly PublishCollarRow[]; survey: readonly PublishSurveyRow[] },
  holes: readonly PublishHole[],
): DrillholePublishPlan {
  const known = new Map(holes.map((hole) => [holeKey(hole.name), hole]))
  const unknown = new Set<string>()
  const rejected: string[] = []

  const collarRows = new Map<string, { hole: PublishHole; rows: PublishCollarRow[] }>()
  for (const row of input.collar) {
    const hole = known.get(holeKey(row.holeId))
    if (hole === undefined) {
      unknown.add(row.holeId.trim())
      continue
    }
    const group = collarRows.get(hole.id) ?? { hole, rows: [] }
    group.rows.push(row)
    collarRows.set(hole.id, group)
  }

  const collars: PlannedCollar[] = []
  for (const { hole, rows } of collarRows.values()) {
    const row = rows[0]
    if (row === undefined) continue
    if (rows.length > 1) {
      rejected.push(`${hole.name}: more than one collar row`)
      continue
    }
    const finite = [row.easting, row.northing, row.elevation].every(Number.isFinite)
    // The CSV reader turns blank or unreadable cells into 0, so a 0/0 position is a missing one.
    if (!finite || (row.easting === 0 && row.northing === 0)) {
      rejected.push(`${hole.name}: collar coordinates are missing or not numeric`)
      continue
    }
    collars.push({
      holeId: hole.id,
      holeName: hole.name,
      easting: row.easting,
      northing: row.northing,
      elevation: row.elevation,
    })
  }

  const grouped = new Map<string, { hole: PublishHole; rows: PublishSurveyRow[] }>()
  for (const row of input.survey) {
    const hole = known.get(holeKey(row.holeId))
    if (hole === undefined) {
      unknown.add(row.holeId.trim())
      continue
    }
    const group = grouped.get(hole.id) ?? { hole, rows: [] }
    group.rows.push(row)
    grouped.set(hole.id, group)
  }

  const surveys: PlannedSurvey[] = []
  for (const { hole, rows } of grouped.values()) {
    const stations: PlannedSurvey['stations'] = []
    const depths = new Set<number>()
    let problem: string | null = null
    for (const row of rows) {
      const azimuth = normalizedAzimuth(row.azimuth)
      if (!Number.isFinite(row.depth) || row.depth < 0) problem = 'a survey depth is negative or not numeric'
      else if (azimuth === null) problem = `azimuth ${row.azimuth} is outside 0-360`
      else if (!Number.isFinite(row.dip) || row.dip < -90 || row.dip > 90) problem = `dip ${row.dip} is outside -90 to 90`
      else if (depths.has(row.depth)) problem = `depth ${row.depth} appears more than once`
      if (problem !== null || azimuth === null) break
      depths.add(row.depth)
      stations.push({ measuredDepth: row.depth, azimuth, dip: row.dip })
    }
    if (problem !== null) {
      rejected.push(`${hole.name}: ${problem}`)
      continue
    }
    stations.sort((left, right) => left.measuredDepth - right.measuredDepth)
    surveys.push({ holeId: hole.id, holeName: hole.name, stations })
  }

  return {
    collars,
    surveys,
    unknownHoles: [...unknown].filter((name) => name !== '').sort((left, right) => left.localeCompare(right)),
    rejected,
  }
}
