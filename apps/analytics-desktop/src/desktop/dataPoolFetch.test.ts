import { describe, expect, it, vi } from 'vitest'
import type { GeoEyeDesktopBridge } from './bridge.js'
import { createDesktopDataPoolFetch } from './dataPoolFetch.js'

describe('createDesktopDataPoolFetch', () => {
  it('routes JSON Database requests through the desktop bridge', async () => {
    const requestDataPool = vi.fn().mockResolvedValue({
      body: JSON.stringify({ status: 'ok' }),
      headers: { 'content-type': 'application/json' },
      status: 200,
      statusText: 'OK',
    })
    const bridge = { requestDataPool } as unknown as GeoEyeDesktopBridge
    const response = await createDesktopDataPoolFetch(bridge)('https://analytics.example.com/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
    })

    expect(requestDataPool).toHaveBeenCalledWith({
      url: 'https://analytics.example.com/api/v1/auth/login',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.com', password: 'secret' }),
    })
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ok' })
  })
})
