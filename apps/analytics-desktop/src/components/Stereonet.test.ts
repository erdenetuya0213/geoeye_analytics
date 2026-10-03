import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { StructurePoint } from '../analysis/structureAnalysis.js'
import { createStereonetTrapezoid, densityInfluence, getStereonetDipRings, isBoundaryComplete, pointInPolygon, polygonArea, projectStructurePoint, Stereonet } from './Stereonet.js'

const point: StructurePoint = {
  alpha: 42,
  beta: 180,
  depth: 100,
  dipDirection: 135,
  holeId: 'TEST-001',
  id: 'TEST-POINT',
  setId: 'J1',
  structureType: 'joint',
  trueDip: 60,
  x: 0,
  y: 0,
}

function distanceFromCentre(coordinate: { x: number; y: number }) {
  return Math.hypot(coordinate.x - 50, coordinate.y - 50)
}

describe('stereonet projections', () => {
  it('moves observations inward when switching from equal-area to equal-angle', () => {
    const equalAreaRadius = distanceFromCentre(projectStructurePoint(point, 'equalArea'))
    const equalAngleRadius = distanceFromCentre(projectStructurePoint(point, 'equalAngle'))

    expect(equalAreaRadius).toBeCloseTo(44 * Math.SQRT2 * Math.sin(Math.PI / 6), 6)
    expect(equalAngleRadius).toBeCloseTo(44 * Math.tan(Math.PI / 6), 6)
    expect(equalAngleRadius).toBeLessThan(equalAreaRadius)
  })

  it('reprojects every dip ring with the selected projection', () => {
    const equalAreaRings = getStereonetDipRings('equalArea')
    const equalAngleRings = getStereonetDipRings('equalAngle')

    expect(equalAreaRings.map((ring) => ring.dip)).toEqual([15, 30, 45, 60, 75])
    equalAreaRings.forEach((ring, index) => {
      expect(equalAngleRings[index]?.radius).toBeLessThan(ring.radius)
    })
    expect(equalAreaRings[2]?.radius).toBeCloseTo(23.8126284, 6)
    expect(equalAngleRings[2]?.radius).toBeCloseTo(18.2253967, 6)
  })
})

describe('stereonet density distributions', () => {
  it('uses a constant one-percent spherical count circle for Schmidt density', () => {
    expect(densityInfluence(1, 'schmidt', 1)).toBe(1)
    expect(densityInfluence(.991, 'schmidt', 1)).toBe(1)
    expect(densityInfluence(.989, 'schmidt', 1)).toBe(0)
  })

  it('uses a smooth, finite spherical influence for Fisher density', () => {
    const centre = densityInfluence(1, 'fisher', 1)
    const shoulder = densityInfluence(.99, 'fisher', 1)
    const outside = densityInfluence(.95, 'fisher', 1)

    expect(centre).toBe(1)
    expect(shoulder).toBeGreaterThan(0)
    expect(shoulder).toBeLessThan(centre)
    expect(outside).toBe(0)
  })
})

describe('stereonet point presentation', () => {
  it('uses one high-contrast marker without selection rings', () => {
    const markup = renderToStaticMarkup(createElement(Stereonet, {
      categories: [{ color: '#31968b', id: 'J1' }],
      colorBy: 'jointSet',
      plotMode: 'poles',
      points: [point],
      selectedIds: new Set([point.id]),
    }))

    expect(markup).toContain('stereonet-point')
    expect(markup).toContain('is-selected')
    expect(markup).not.toContain('stereonet-selection-ring')
    expect(markup).toContain('fill="color-mix(in oklch, #31968b 82%, var(--foreground))"')
    expect(markup).toContain('stroke="var(--foreground)"')
  })
})

describe('closed lasso geometry', () => {
  const boundary = [
    { x: 20, y: 20 },
    { x: 80, y: 20 },
    { x: 80, y: 80 },
    { x: 20, y: 80 },
  ]

  it('treats an open vertex list as a closed selection boundary', () => {
    expect(pointInPolygon({ x: 50, y: 50 }, boundary)).toBe(true)
    expect(pointInPolygon({ x: 10, y: 50 }, boundary)).toBe(false)
  })

  it('rejects collapsed pointer strokes by area', () => {
    expect(polygonArea(boundary)).toBe(3600)
    expect(polygonArea([{ x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }])).toBe(0)
  })

  it('creates a smooth radial trapezoid aligned to concentric stereonet circles', () => {
    const trapezoid = createStereonetTrapezoid({ x: 50, y: 30 }, { x: 75, y: 50 })
    expect(trapezoid.length).toBeGreaterThan(80)
    expect(isBoundaryComplete('trapezoid', trapezoid)).toBe(true)
    trapezoid.forEach((coordinate) => {
      const radius = distanceFromCentre(coordinate)
      expect(Math.min(Math.abs(radius - 20), Math.abs(radius - 25))).toBeLessThan(1e-8)
    })
  })

  it('rejects radial drags without both angular and radial extent', () => {
    expect(createStereonetTrapezoid({ x: 50, y: 30 }, { x: 50, y: 10 })).toEqual([])
    expect(createStereonetTrapezoid({ x: 50, y: 30 }, { x: 70, y: 50 })).toEqual([])
  })
})
