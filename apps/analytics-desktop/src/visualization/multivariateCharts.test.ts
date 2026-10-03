import { describe, expect, it } from 'vitest'
import { buildMultivariateRunRequest, calculateMultivariateRun, type MultivariateConfiguration } from '../analysis/multivariateEngine.js'
import type { EdaDataset } from '../data/edaDemo.js'
import {
  buildClusterProfilesOption,
  buildClusterScoresOption,
  buildExplainedVarianceOption,
  buildGroupComparisonOption,
  buildLoadingsOption,
  buildMultivariateCorrelationOption,
  buildPcaScoresOption,
} from './multivariateCharts.js'
import { GEOEYE_LINE_SMOOTHING } from './geoEyeTheme.js'

const dataset: EdaDataset = {
  dimensions: [{ key: 'lithology', label: 'Lithology' }],
  id: 'chart-test',
  name: 'Chart test',
  observations: [
    { depthFrom: 0, depthTo: 1, dimensions: { lithology: 'A' }, easting: 0, holeId: 'H1', id: 'row-a', joinKey: 'a', lithology: 'A', northing: 0, sampleId: 'A', sourceObservationId: 'source-a', values: { x: 1, y: 2, z: 8 } },
    { depthFrom: 1, depthTo: 2, dimensions: { lithology: 'A' }, easting: 0, holeId: 'H1', id: 'row-b', joinKey: 'b', lithology: 'A', northing: 0, sampleId: 'B', sourceObservationId: 'source-b', values: { x: 2, y: 4, z: 6 } },
    { depthFrom: 2, depthTo: 3, dimensions: { lithology: 'B' }, easting: 0, holeId: 'H2', id: 'row-c', joinKey: 'c', lithology: 'B', northing: 0, sampleId: 'C', sourceObservationId: 'source-c', values: { x: 3, y: 6, z: 4 } },
    { depthFrom: 3, depthTo: 4, dimensions: { lithology: 'B' }, easting: 0, holeId: 'H2', id: 'row-d', joinKey: 'd', lithology: 'B', northing: 0, sampleId: 'D', sourceObservationId: 'source-d', values: { x: 4, y: 8, z: 2 } },
  ],
  producer: 'Test',
  project: 'Test',
  snapshotAt: '2026-10-01T00:00:00.000Z',
  source: 'demo',
  support: 'Intervals',
  variables: [
    { decimals: 1, key: 'x', label: 'X', shortLabel: 'X', unit: 'ppm' },
    { decimals: 1, key: 'y', label: 'Y', shortLabel: 'Y', unit: 'ppm' },
    { decimals: 1, key: 'z', label: 'Z', shortLabel: 'Z', unit: 'ppm' },
  ],
}

const configuration: MultivariateConfiguration = {
  activeFilterKeys: [],
  clusterCount: 2,
  correlationMethod: 'pearson',
  datasetId: dataset.id,
  datasetName: dataset.name,
  filterValues: {},
  groupBy: 'lithology',
  method: 'full',
  missingPolicy: 'complete-case',
  scaling: 'standard',
  snapshotAt: dataset.snapshotAt,
  supportLabel: dataset.support,
  variableKeys: ['x', 'y', 'z'],
}

function seriesData(option: unknown) {
  if (typeof option !== 'object' || option === null || !('series' in option) || !Array.isArray(option.series)) return []
  return option.series.flatMap((series) => {
    if (typeof series !== 'object' || series === null || !('data' in series) || !Array.isArray(series.data)) return []
    return series.data
  })
}

describe('GeoEye multivariate chart options', () => {
  it('carries source observation IDs on every rendered mark', () => {
    const request = buildMultivariateRunRequest(configuration, dataset, 1, new Date('2026-10-01T01:00:00.000Z'))
    const result = calculateMultivariateRun(request, new Date('2026-10-01T01:00:01.000Z'))
    const options = [
      buildMultivariateCorrelationOption(result, dataset.variables, 'pearson'),
      buildExplainedVarianceOption(result),
      buildPcaScoresOption(result),
      buildLoadingsOption(result, dataset.variables),
      buildClusterScoresOption(result),
      buildClusterProfilesOption(result, dataset.variables),
      buildGroupComparisonOption(result),
    ]

    options.forEach((option) => {
      expect((option as Record<string, unknown>).toolbox).toBeUndefined()
      const data = seriesData(option)
      expect(data.length).toBeGreaterThan(0)
      data.forEach((item) => {
        expect(item).toEqual(expect.objectContaining({ sourceObservationIds: expect.any(Array) }))
        expect((item as { sourceObservationIds: string[] }).sourceObservationIds.length).toBeGreaterThan(0)
      })
    })
  })

  it('smooths cumulative and cluster-profile line series', () => {
    const request = buildMultivariateRunRequest(configuration, dataset, 1, new Date('2026-10-01T01:00:00.000Z'))
    const result = calculateMultivariateRun(request, new Date('2026-10-01T01:00:01.000Z'))
    const options = [buildExplainedVarianceOption(result), buildClusterProfilesOption(result, dataset.variables)]

    options.forEach((option) => {
      const lineSeries = (option as { series: Array<Record<string, unknown>> }).series.filter((series) => series.type === 'line')
      expect(lineSeries.length).toBeGreaterThan(0)
      expect(lineSeries.every((series) => series.smooth === GEOEYE_LINE_SMOOTHING)).toBe(true)
    })
  })

  it('prints the correlation coefficient directly in each matrix cell', () => {
    const request = buildMultivariateRunRequest(configuration, dataset, 1, new Date('2026-10-01T01:00:00.000Z'))
    const result = calculateMultivariateRun(request)
    const option = buildMultivariateCorrelationOption(result, dataset.variables, 'pearson') as Record<string, unknown>
    const series = (option.series as Array<Record<string, unknown>>)[0]
    const label = series?.label as { formatter?: (params: { data?: unknown }) => string; show?: boolean }
    const datum = (series?.data as unknown[])[0]

    expect(label.show).toBe(true)
    expect(label.formatter?.({ data: datum })).toBe('1.00')
  })

  it('supports selectable PCA axes, categorical coloring, and biplot vectors', () => {
    const request = buildMultivariateRunRequest(configuration, dataset, 1, new Date('2026-10-01T01:00:00.000Z'))
    const result = calculateMultivariateRun(request)
    const option = buildPcaScoresOption(result, { biplot: true, colorBy: 'lithology', variables: dataset.variables, xComponent: 0, yComponent: 2 }) as Record<string, unknown>
    const xAxis = option.xAxis as { name?: string }
    const yAxis = option.yAxis as { name?: string }
    const series = option.series as Array<{ markLine?: unknown }>

    expect(xAxis.name).toContain('PC1')
    expect(yAxis.name).toContain('PC3')
    expect(series.filter((item) => item.markLine !== undefined)).toHaveLength(dataset.variables.length)
  })
})
