import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SignOutDialog } from './SignOutDialog.js'

describe('SignOutDialog', () => {
  it('keeps cancellation available before credentials are cleared', () => {
    const markup = renderToStaticMarkup(createElement(SignOutDialog, {
      onCancel: vi.fn(),
      onConfirm: vi.fn(),
    }))

    expect(markup).toContain('role="alertdialog"')
    expect(markup).toContain('>Cancel</button>')
    expect(markup).toContain('>Sign out</button>')
    expect(markup).toContain('enter your email and password')
  })
})
