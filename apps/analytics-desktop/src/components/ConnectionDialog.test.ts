import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ConnectionDialog, connectionErrorMessage } from './ConnectionDialog.js'

describe('configured Database connection', () => {
  it('shows the configured server without email/password/server entry fields', () => {
    const markup = renderToStaticMarkup(createElement(ConnectionDialog, {
      initialSettings: { version: 1, endpoint: 'http://127.0.0.1:8080', token: '', managed: true },
      onClose: vi.fn(), onSave: vi.fn(),
    }))
    expect(markup).toContain('http://127.0.0.1:8080')
    expect(markup).toContain('No additional sign-in required')
    expect(markup).toContain('GeoEye Field authentication stays unchanged')
    expect(markup).not.toContain('<input')
    expect(markup).not.toContain('type="password"')
  })
  it('explains an unavailable API without asking for credentials', () => {
    expect(connectionErrorMessage(new Error('offline'))).toContain('Start the local staging API')
  })
})
