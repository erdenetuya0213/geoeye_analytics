import { describe, expect, it } from 'vitest'
import { dataPoolEndpointCandidates } from './dataPoolLogin.js'

describe('dataPoolEndpointCandidates', () => {
  it('tries the standard reverse-proxy path after a bare host', () => {
    expect(dataPoolEndpointCandidates('https://analytics.example.com/')).toEqual([
      'https://analytics.example.com',
      'https://analytics.example.com/api',
    ])
  })

  it('keeps an explicit API path unchanged', () => {
    expect(dataPoolEndpointCandidates('http://127.0.0.1:8080/api')).toEqual([
      'http://127.0.0.1:8080/api',
    ])
  })
})
