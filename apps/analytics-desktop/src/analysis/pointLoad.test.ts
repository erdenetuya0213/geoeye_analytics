import { describe, expect, it } from 'vitest'
import { calculatePointLoadIndex } from './pointLoad.js'

describe('point-load strength index', () => {
  it('calculates Is and leaves a 50 mm specimen unchanged', () => {
    expect(calculatePointLoadIndex(10, 50)).toEqual({
      correctionFactor: 1,
      is50Mpa: 4,
      isMpa: 4,
    })
  })

  it('applies the equivalent-diameter size correction', () => {
    const result = calculatePointLoadIndex(7.5, 42)
    expect(result.isMpa).toBeCloseTo(4.2517, 4)
    expect(result.correctionFactor).toBeCloseTo(0.9245, 4)
    expect(result.is50Mpa).toBeCloseTo(3.9309, 4)
  })

  it.each([[0, 50], [-1, 50], [10, 0], [10, Number.NaN]])(
    'rejects invalid inputs (%s, %s)',
    (load, diameter) => expect(() => calculatePointLoadIndex(load, diameter)).toThrow(RangeError),
  )
})
