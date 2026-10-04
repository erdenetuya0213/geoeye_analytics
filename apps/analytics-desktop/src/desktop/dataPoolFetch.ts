import { desktopBridge, type GeoEyeDesktopBridge } from './bridge.js'

function abortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError')
}

function waitForDesktopResponse<T>(request: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (signal === undefined || signal === null) return request
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    request.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.toString()
  return input.url
}

export function createDesktopDataPoolFetch(bridge: GeoEyeDesktopBridge): typeof globalThis.fetch {
  return async (input, init) => {
    const source = input instanceof Request ? input : undefined
    const headers = new Headers(source?.headers)
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value))
    const serializedHeaders: Record<string, string> = {}
    headers.forEach((value, name) => { serializedHeaders[name] = value })
    const body = init?.body ?? undefined
    if (body !== undefined && body !== null && typeof body !== 'string') {
      throw new TypeError('Desktop Database requests require a text body')
    }
    const response = await waitForDesktopResponse(
      bridge.requestDataPool({
        url: requestUrl(input),
        method: init?.method ?? source?.method ?? 'GET',
        ...(Object.keys(serializedHeaders).length === 0 ? {} : { headers: serializedHeaders }),
        ...(typeof body === 'string' ? { body } : {}),
      }),
      init?.signal,
    )
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

/**
 * Electron routes requests through the trusted main process so a secure Data
 * Pool never has to allow the unsafe `null` origin produced by a file:// page.
 */
export const dataPoolFetch: typeof globalThis.fetch = (input, init) => {
  const bridge = desktopBridge()
  return bridge === undefined
    ? globalThis.fetch(input, init)
    : createDesktopDataPoolFetch(bridge)(input, init)
}
