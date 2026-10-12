import { expect, it } from 'vitest'
import { toggleRowSelection, toggleVisibleSelection } from './rowSelection.js'
it('selects individual rows without changing the previous selection', () => {
  const previous = new Set(['a'])
  expect([...toggleRowSelection(previous, 'b')]).toEqual(['a', 'b'])
  expect([...toggleRowSelection(previous, 'a')]).toEqual([])
  expect([...previous]).toEqual(['a'])
})
it('Select All affects the search results and preserves hidden selections', () => {
  const selected = toggleVisibleSelection(new Set(['hidden', 'a']), ['a', 'b'])
  expect([...selected]).toEqual(['hidden', 'a', 'b'])
  expect([...toggleVisibleSelection(selected, ['a', 'b'])]).toEqual(['hidden'])
  expect([...toggleVisibleSelection(selected, [])]).toEqual(['hidden', 'a', 'b'])
})
it('row indexes distinguish duplicate CSV rows during selection and deletion', () => {
  const rows = [['DH1', '10'], ['DH1', '10'], ['DH2', '20']]
  const selected = toggleRowSelection(new Set<number>(), 1)
  expect(rows.filter((_, index) => !selected.has(index))).toEqual([['DH1', '10'], ['DH2', '20']])
})
