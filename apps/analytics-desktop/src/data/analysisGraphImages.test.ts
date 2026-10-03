import { describe, expect, it } from 'vitest'
import { barGraphImage, scatterGraphImage, svgElementPngGraphImage } from './analysisGraphImages.js'

describe('analysis graph PNG artifacts', () => {
  it('always emits PNG data for generated bar and scatter outcomes', () => {
    const images = [
      barGraphImage('classes', 'Class counts', [{ label: 'A', value: 4 }]),
      scatterGraphImage('scores', 'PCA scores', [{ x: 1, y: 2 }]),
    ]

    for (const image of images) {
      expect(image.mediaType).toBe('image/png')
      expect(image.imageDataUrl).toMatch(/^data:image\/png;base64,/)
    }
  })

  it('does not invent a stereonet image when no SVG element exists', async () => {
    await expect(svgElementPngGraphImage('stereonet', null)).resolves.toBeNull()
  })
})
