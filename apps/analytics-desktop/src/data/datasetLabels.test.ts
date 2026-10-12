import { describe, expect, it } from 'vitest'
import { datasetDisplayLabel, fieldLoggingDisplayLabel } from './datasetLabels.js'

describe('live and saved dataset labels', () => {
  it('keeps a stable Live label when internal revisions change', () => {
    for (const version of [1, 35, 99]) {
      const template = { id: 'auto', name: 'Structure auto', version }
      expect(fieldLoggingDisplayLabel(template)).toBe('Structure auto · Live')
      expect(template.version).toBe(version)
      expect(datasetDisplayLabel({ name: template.name, currentVersion: version, sourceSystem: 'field.logging_structure' }))
        .toBe('Structure auto · Live')
    }
  })

  it('preserves saved CSV and analysis versions', () => {
    expect(fieldLoggingDisplayLabel({ id: 'auto:generated:v4', name: 'Structure auto', version: 4 }))
      .toBe('Structure auto · CSV v4')
    expect(datasetDisplayLabel({ name: 'RMR comparison', currentVersion: 2, sourceSystem: 'analytics.rmr76' }))
      .toBe('RMR comparison · v2')
  })
})
