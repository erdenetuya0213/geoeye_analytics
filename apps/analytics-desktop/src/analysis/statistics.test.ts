import { describe, expect, it } from 'vitest'
import { shapeStatistics } from './statistics.js'

describe('shapeStatistics', () => {
  it('reports a symmetric sample as unskewed', () => {
    const result = shapeStatistics([1, 2, 3, 4, 5])
    expect(result.skewness).toBeCloseTo(0, 10)
  })

  it('reports positive skewness for a right-tailed sample', () => {
    const result = shapeStatistics([1, 1, 1, 2, 2, 3, 12])
    expect(result.skewness ?? 0).toBeGreaterThan(1)
  })

  it('reports excess kurtosis, so a normal-like sample sits near zero', () => {
    const uniform = shapeStatistics([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
    expect(uniform.kurtosis ?? 0).toBeLessThan(0)
  })

  it('derives the geometric mean from the log mean', () => {
    const result = shapeStatistics([1, 10, 100])
    expect(result.geometricMean).toBeCloseTo(10, 10)
    expect(result.logMean).toBeCloseTo(Math.log(10), 10)
  })

  it('ignores non-positive values in the log statistics but keeps them in the moments', () => {
    const result = shapeStatistics([0, 1, 10, 100])
    expect(result.geometricMean).toBeCloseTo(10, 10)
    expect(result.skewness).not.toBeNull()
  })

  it('returns nulls when no positive value remains', () => {
    const result = shapeStatistics([-3, -2, -1])
    expect(result.geometricMean).toBeNull()
    expect(result.logVariance).toBeNull()
  })

  it('applies weights, so a repeated value and its weight agree', () => {
    const weighted = shapeStatistics([1, 2, 3], [1, 2, 1])
    const repeated = shapeStatistics([1, 2, 2, 3])
    expect(weighted.skewness).toBeCloseTo(repeated.skewness ?? 0, 10)
    expect(weighted.kurtosis).toBeCloseTo(repeated.kurtosis ?? 0, 10)
  })

  it('needs two samples', () => {
    expect(shapeStatistics([5]).skewness).toBeNull()
  })
})
