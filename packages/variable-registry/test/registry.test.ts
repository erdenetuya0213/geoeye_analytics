import { describe, expect, it } from 'vitest'
import { CORE_VARIABLES, VariableRegistry } from '../src/index.js'

describe('VariableRegistry', () => {
  it('loads the baseline catalog and resolves a semantic key', () => {
    const registry = new VariableRegistry(CORE_VARIABLES)

    expect(registry.require('structure.alpha')).toMatchObject({
      dataType: 'numeric',
      canonicalUnit: 'deg',
      origin: 'primary',
    })
  })

  it('rejects duplicate keys', () => {
    expect(() => new VariableRegistry([CORE_VARIABLES[0], CORE_VARIABLES[0]])).toThrow(
      'Duplicate variable key',
    )
  })

  it('finds variables by analysis family', () => {
    const registry = new VariableRegistry(CORE_VARIABLES)
    const keys = registry.compatibleWith('structure').map((item) => item.key)

    expect(keys).toContain('structure.true_dip')
    expect(keys).not.toContain('assay.au')
  })

  it('registers RMR76 score and class metadata for derived-field consumers', () => {
    const registry = new VariableRegistry(CORE_VARIABLES)

    expect(registry.require('geotech.rmr76')).toMatchObject({
      dataType: 'numeric',
      metadata: { method: 'Bieniawski 1976', scoreType: 'bounded_ordinal_score' },
      origin: 'derived',
    })
    expect(registry.require('geotech.rmr76_class')).toMatchObject({ dataType: 'category', origin: 'derived' })
  })
})
