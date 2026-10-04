import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryProjectStorage } from './ProjectStorageContext.js'

afterEach(() => vi.unstubAllGlobals())
const address = { endpoint: 'local', projectId: 'test', tenantId: null }

describe('durable document saves', () => {
  it('waits for disk and retries a failed save without losing the in-memory value', async () => {
    const report = vi.fn()
    const write = vi.fn().mockRejectedValue(new Error('disk full'))
    vi.stubGlobal('window', { geoeyeDesktop: { writeProjectDocument: write } })
    const storage = new MemoryProjectStorage({}, address, report)
    storage.setItem('record', 'value')
    await expect(storage.flush()).rejects.toThrow('disk full')
    expect(storage.getItem('record')).toBe('value')
    expect(report).toHaveBeenCalledWith(expect.stringContaining('could not be saved'))
    write.mockResolvedValue(undefined)
    await expect(storage.flush()).resolves.toBeUndefined()
    expect(report).toHaveBeenLastCalledWith(null)
  })

  it('serializes writes and never retries an old value over a newer successful save', async () => {
    const saved: string[] = []
    vi.stubGlobal('window', { geoeyeDesktop: { writeProjectDocument: async ({ value }: { value: string }) => { if (value === 'old') throw new Error('offline disk'); saved.push(value) } } })
    const storage = new MemoryProjectStorage({}, address)
    storage.setItem('record', 'old')
    storage.setItem('record', 'new')
    await storage.flush()
    expect(saved).toEqual(['new'])
  })
})
