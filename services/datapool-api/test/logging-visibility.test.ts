import { describe, expect, it } from 'vitest'
import { structureModelId, visibleStructure } from '../src/logging-visibility.js'

describe('authoritative Field structure visibility', () => {
  const id = 'gs:001256d18a7b4569cbff3e91cb362b66'
  const uuid = 'b44b4092-7f8b-5117-a9b8-31972d326b16'
  it('uses the same generated ID mapping as Cloud API', () => expect(structureModelId(id)).toBe(uuid))
  it('honors current and legacy dismissal records', () => {
    expect(visibleStructure({id:uuid, source:'model', row_bbox_json:{dismissedStructureIds:[id]}, stage3_rqd_json:null})).toBe(false)
    expect(visibleStructure({id:uuid, source:'model', row_bbox_json:null, stage3_rqd_json:{dismissed_structure_ids:[id]}})).toBe(false)
  })
  it('does not suppress an unrelated observation or relog/manual record', () => {
    expect(visibleStructure({id:uuid, source:'model', row_bbox_json:{dismissedStructureIds:['another']}, stage3_rqd_json:null})).toBe(true)
    expect(visibleStructure({id:uuid, source:'manual', row_bbox_json:{dismissedStructureIds:[id]}, stage3_rqd_json:null})).toBe(true)
  })
})
