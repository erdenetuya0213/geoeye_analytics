import { describe, expect, it } from 'vitest'
import { confidenceBand, controlLines, fitRegression, referenceLineSeries, statsBoxGraphic, type StatsSource } from './chartAnnotations.js'
import { chartSettingsFor } from './chartSettings.js'

const summary: StatsSource = {
  coefficientOfVariation: 0.5,
  count: 120,
  geometricMean: 1.8,
  kurtosis: 0.4,
  logMean: 0.59,
  logVariance: 0.2,
  maximum: 9.5,
  mean: 2.1,
  median: 1.9,
  minimum: 0.1,
  missing: 3,
  p95: 5.4,
  q1: 1.2,
  q3: 2.8,
  skewness: 1.2,
  standardDeviation: 1.05,
  variance: 1.1,
}

function textOf(graphic: ReturnType<typeof statsBoxGraphic>) {
  const children = graphic?.[0]?.children ?? []
  return children.flatMap((child) => 'style' in child && typeof child.style.text === 'string' ? [child.style.text] : [])
}

describe('statsBoxGraphic', () => {
  it('is absent until it is switched on', () => {
    expect(statsBoxGraphic(summary, { ...chartSettingsFor('scatter'), statsBox: false }, 'top-right')).toBeUndefined()
  })

  it('writes the chosen statistics as aligned label and value columns', () => {
    const settings = { ...chartSettingsFor('histogram'), decimals: 2, stats: ['count' as const, 'mean' as const, 'skewness' as const] }
    const [labels, values] = textOf(statsBoxGraphic(summary, settings, 'top-right'))
    expect(labels?.split('\n')).toEqual(['Count', 'Mean', 'Skewness'])
    expect(values?.split('\n')).toEqual(['120', '2.10', '1.20'])
  })

  it('keeps counts as integers whatever the decimals', () => {
    const settings = { ...chartSettingsFor('histogram'), decimals: 4, stats: ['count' as const] }
    expect(textOf(statsBoxGraphic(summary, settings, 'top-right'))[1]).toBe('120')
  })

  it('places the box in the requested corner', () => {
    const settings = { ...chartSettingsFor('histogram'), statsCorner: 'bottom-left' as const }
    const box = statsBoxGraphic(summary, settings, 'bottom-left')?.[0] as Record<string, unknown>
    expect(box.bottom).toBe(12)
    // A left-hand box is inset past the y-axis labels.
    expect(box.left).toBe(58)
    expect(box.right).toBeUndefined()
  })
})

describe('referenceLineSeries', () => {
  it('is empty without a selection', () => {
    expect(referenceLineSeries(summary, chartSettingsFor('histogram'), 'x')).toEqual([])
  })

  it('draws the chosen lines on the requested axis', () => {
    const settings = { ...chartSettingsFor('histogram'), referenceLines: ['mean' as const, 'median' as const] }
    const [series] = referenceLineSeries(summary, settings, 'x')
    const lines = series?.markLine.data ?? []
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ xAxis: 2.1 })
    expect(lines[1]).toMatchObject({ xAxis: 1.9 })
  })

  it('skips a statistic the population does not have', () => {
    const settings = { ...chartSettingsFor('histogram'), referenceLines: ['geometricMean' as const] }
    expect(referenceLineSeries({ ...summary, geometricMean: null }, settings, 'y')).toEqual([])
  })
})

describe('fitRegression', () => {
  const line = Array.from({ length: 20 }, (_, index) => ({ x: index + 1, y: 3 * (index + 1) + 2 }))

  it('recovers a straight line by least squares', () => {
    const fit = fitRegression(line, chartSettingsFor('scatter'))
    expect(fit?.slope).toBeCloseTo(3, 8)
    expect(fit?.intercept).toBeCloseTo(2, 8)
    expect(fit?.rSquared).toBeCloseTo(1, 8)
    expect(fit?.label).toContain('y = 3.0000x')
  })

  it('agrees with least squares on a perfect fit but differs on scattered data', () => {
    const settings = { ...chartSettingsFor('scatter'), regressionMethod: 'reduced-major-axis' as const }
    expect(fitRegression(line, settings)?.slope).toBeCloseTo(3, 8)
    const noisy = [{ x: 1, y: 2 }, { x: 2, y: 1 }, { x: 3, y: 4 }, { x: 4, y: 3 }, { x: 5, y: 6 }]
    const ordinary = fitRegression(noisy, chartSettingsFor('scatter'))
    const major = fitRegression(noisy, settings)
    expect((major?.slope ?? 0) > (ordinary?.slope ?? 0)).toBe(true)
  })

  it('recovers a power law', () => {
    const points = Array.from({ length: 12 }, (_, index) => ({ x: index + 1, y: 2 * (index + 1) ** 1.5 }))
    const fit = fitRegression(points, { ...chartSettingsFor('scatter'), regressionModel: 'power' })
    expect(fit?.slope).toBeCloseTo(1.5, 6)
    expect(fit?.at(4)).toBeCloseTo(16, 5)
  })

  it('recovers an exponential', () => {
    const points = Array.from({ length: 12 }, (_, index) => ({ x: index, y: 5 * Math.exp(0.3 * index) }))
    const fit = fitRegression(points, { ...chartSettingsFor('scatter'), regressionModel: 'exponential' })
    expect(fit?.slope).toBeCloseTo(0.3, 6)
  })

  it('recovers a quadratic', () => {
    const points = Array.from({ length: 15 }, (_, index) => ({ x: index - 7, y: 2 * (index - 7) ** 2 - 3 * (index - 7) + 1 }))
    const fit = fitRegression(points, { ...chartSettingsFor('scatter'), regressionModel: 'quadratic' })
    expect(fit?.at(2)).toBeCloseTo(2 * 4 - 6 + 1, 6)
    expect(fit?.rSquared).toBeCloseTo(1, 8)
  })

  it('returns nothing when regression is off or there are too few points', () => {
    expect(fitRegression(line, { ...chartSettingsFor('scatter'), regressionMethod: 'none' })).toBeNull()
    expect(fitRegression(line.slice(0, 1), chartSettingsFor('scatter'))).toBeNull()
    expect(fitRegression(line.slice(0, 2), { ...chartSettingsFor('scatter'), regressionModel: 'quadratic' })).toBeNull()
  })
})

describe('confidenceBand', () => {
  it('is narrowest at the mean of x and widens towards the ends', () => {
    const points = Array.from({ length: 30 }, (_, index) => ({ x: index, y: index + (index % 3) - 1 }))
    const fit = fitRegression(points, chartSettingsFor('scatter'))
    const band = confidenceBand(points, fit!, 95)
    const width = (index: number) => (band[index]?.upper ?? 0) - (band[index]?.lower ?? 0)
    expect(width(Math.floor(band.length / 2))).toBeLessThan(width(0))
    expect(width(Math.floor(band.length / 2))).toBeLessThan(width(band.length - 1))
  })

  it('widens with the confidence level', () => {
    const points = Array.from({ length: 30 }, (_, index) => ({ x: index, y: index + (index % 3) - 1 }))
    const fit = fitRegression(points, chartSettingsFor('scatter'))!
    const narrow = confidenceBand(points, fit, 90)[0]
    const wide = confidenceBand(points, fit, 99)[0]
    expect((wide?.upper ?? 0) - (wide?.lower ?? 0)).toBeGreaterThan((narrow?.upper ?? 0) - (narrow?.lower ?? 0))
  })
})

describe('controlLines', () => {
  const points = [{ x: 100, y: 100 }, { x: 100, y: 105 }, { x: 100, y: 130 }]

  it('is absent when switched off', () => {
    expect(controlLines(points, chartSettingsFor('scatter'))).toBeNull()
  })

  it('counts points inside a percentage envelope', () => {
    const result = controlLines(points, { ...chartSettingsFor('scatter'), controlLineMode: 'percent', controlLineValue: 10 })
    expect(result).toMatchObject({ inside: 2, outside: 1 })
  })

  it('counts points inside a fixed envelope', () => {
    const result = controlLines(points, { ...chartSettingsFor('scatter'), controlLineMode: 'fixed', controlLineValue: 3 })
    expect(result).toMatchObject({ inside: 1, outside: 2 })
    expect(result?.isInside({ x: 10, y: 12 })).toBe(true)
  })
})
