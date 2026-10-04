import { expect, it } from 'vitest'
import { readImportSource } from './importSource.js'

it('archives byte-exact CSV contents including UTF-8 BOM and CRLF', async () => {
  const bytes = new Uint8Array([239, 187, 191, ...new TextEncoder().encode('hole,x\r\nA,1\r\n')])
  const result = await readImportSource(new File([bytes], 'collar.csv'))
  expect(result.contents).toBe('hole,x\r\nA,1\r\n')
  expect(Buffer.from(result.base64!, 'base64')).toEqual(Buffer.from(bytes))
})
