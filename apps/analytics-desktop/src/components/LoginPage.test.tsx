import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { LoginPage } from './LoginPage.js'

describe('LoginPage', () => {
  it('renders a complete first-launch account gate without demo navigation', () => {
    const markup = renderToStaticMarkup(createElement(LoginPage, {
      onActivated: vi.fn(),
    }))

    expect(markup).toContain('<main class="login-page">')
    expect(markup).toContain('Sign in offline')
    expect(markup).toContain('type="email"')
    expect(markup).toContain('Activation key')
    expect(markup).not.toContain('type="password"')
    expect(markup).not.toContain('GeoEye Database address')
    expect(markup).toContain('Your key is verified on this computer')
    expect(markup).not.toContain('Demo workspace')
    expect(markup).not.toContain('Sample data')
  })
})
