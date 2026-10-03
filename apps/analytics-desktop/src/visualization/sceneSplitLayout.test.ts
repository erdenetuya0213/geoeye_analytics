import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SCENE_SPLIT_RATIO,
  DEFAULT_SCENE_SPLIT_LAYOUT,
  clampSceneSplitRatio,
  parseSceneSplitLayout,
  parseSceneSplitRatio,
} from './sceneSplitLayout.js'

describe('3D scene split layout', () => {
  it('keeps the divider inside usable pane limits', () => {
    expect(clampSceneSplitRatio(10)).toBe(25)
    expect(clampSceneSplitRatio(63)).toBe(63)
    expect(clampSceneSplitRatio(90)).toBe(75)
  })

  it('restores a valid persisted ratio and rejects invalid storage', () => {
    expect(parseSceneSplitRatio('58.5')).toBe(58.5)
    expect(parseSceneSplitRatio('100')).toBe(75)
    expect(parseSceneSplitRatio('not-a-number')).toBe(DEFAULT_SCENE_SPLIT_RATIO)
    expect(parseSceneSplitRatio(null)).toBe(DEFAULT_SCENE_SPLIT_RATIO)
  })

  it('restores the Dispatch-style pane count and both divider positions', () => {
    expect(parseSceneSplitLayout('{"count":4,"column":62,"row":41}')).toEqual({ count: 4, column: 62, row: 41 })
    expect(parseSceneSplitLayout('{"count":3,"column":4,"row":96}')).toEqual({ count: 3, column: 25, row: 75 })
    expect(parseSceneSplitLayout('{"count":8,"column":50,"row":50}')).toEqual(DEFAULT_SCENE_SPLIT_LAYOUT)
    expect(parseSceneSplitLayout('invalid')).toEqual(DEFAULT_SCENE_SPLIT_LAYOUT)
  })
})
