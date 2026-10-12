import { DataPoolError } from '@geoeye/datapool-client'
import { describe, expect, it, vi } from 'vitest'
import { clientForLocalRefresh, connectionStateWhileChecking, dataPoolReconnectDelay, restoreManagedConnection, shouldRetryDataPoolConnection } from './dataPoolConnection.js'
import type { ConnectionSettings } from '../types.js'

describe('Database reconnect policy', () => {
  it('keeps the workspace connected during repeated focus checks, but shows checking on a disconnected startup', () => {
    expect(connectionStateWhileChecking('connected')).toBe('connected')
    expect(connectionStateWhileChecking('unavailable')).toBe('checking')
    expect(connectionStateWhileChecking('checking')).toBe('checking')
  })

  it('does not recreate a healthy managed session on focus, and does switch when the account or endpoint changes', () => {
    const current: ConnectionSettings = { version: 1, endpoint: 'http://127.0.0.1:8080', accountId: 'account-1', managed: true, token: '' }
    const same = { endpoint: current.endpoint, accountId: 'account-1' }
    expect(restoreManagedConnection(current, same)).toBe(current)
    const changed = restoreManagedConnection(current, { ...same, accountId: 'account-2' })
    expect(changed).not.toBe(current)
    expect(changed.accountId).toBe('account-2')
    expect(restoreManagedConnection(current, { ...same, endpoint: 'https://other.example' }).endpoint).toBe('https://other.example')
  })
  it('retries temporary startup and network failures with a bounded backoff', () => {
    expect(shouldRetryDataPoolConnection(new TypeError('fetch failed'))).toBe(true)
    expect(shouldRetryDataPoolConnection(new DataPoolError('Unavailable', 503))).toBe(true)
    expect([0, 1, 2, 3, 20].map(dataPoolReconnectDelay)).toEqual([1_000, 3_000, 10_000, 30_000, 30_000])
  })

  it('does not loop when credentials or project authorization need attention', () => {
    expect(shouldRetryDataPoolConnection(new DataPoolError('Unauthorized', 401))).toBe(false)
    expect(shouldRetryDataPoolConnection(new DataPoolError('Forbidden', 403))).toBe(false)
  })
})

describe('explicit local refresh connection', () => {
  const settings: ConnectionSettings = { version: 1, endpoint: 'http://127.0.0.1:8080', accountId: 'account-1', managed: true, token: '' }
  it('connects an offline managed workspace on demand', async () => {
    const connect = vi.fn().mockResolvedValue({ endpoint: settings.endpoint, accountId: settings.accountId })
    expect(await clientForLocalRefresh(settings, connect)).toBeDefined()
    expect(connect).toHaveBeenCalledOnce()
  })
  it('reports missing configuration rather than silently skipping', async () => {
    await expect(clientForLocalRefresh(settings, async () => null)).rejects.toThrow('has not been configured')
  })
  it('rejects a different account or server before loading project data', async () => {
    await expect(clientForLocalRefresh(settings, async () => ({ endpoint: settings.endpoint, accountId: 'another' }))).rejects.toThrow('account or server changed')
    await expect(clientForLocalRefresh(settings, async () => ({ endpoint: 'https://another.example', accountId: 'account-1' }))).rejects.toThrow('account or server changed')
  })
  it('propagates a connection failure for the refresh message', async () => {
    await expect(clientForLocalRefresh(settings, async () => { throw new Error('Server unavailable') })).rejects.toThrow('Server unavailable')
  })
})
