import { expect, it } from 'vitest'
import { readImportSource } from './importSource.js'

it('archives byte-exact CSV contents including UTF-8 BOM and CRLF', async () => {
  const bytes = new Uint8Array([239, 187, 191, ...new TextEncoder().encode('hole,x\r\nA,1\r\n')])
  const result = await readImportSource(new File([bytes], 'collar.csv'))
  expect(result.contents).toBe('hole,x\r\nA,1\r\n')
  expect(Buffer.from(result.base64!, 'base64')).toEqual(Buffer.from(bytes))
})

it('reads squared units from Windows-1252 laboratory exports without changing archived bytes', async () => {
  const bytes = new Uint8Array([...new TextEncoder().encode('De'), 0xb2, ...new TextEncoder().encode(' (mm'), 0xb2, ...new TextEncoder().encode(')\r\n3969\r\n')])
  const result = await readImportSource(new File([bytes], 'point-load.csv'))
  expect(result.contents).toBe('De² (mm²)\r\n3969\r\n')
  expect(Buffer.from(result.base64!, 'base64')).toEqual(Buffer.from(bytes))
})
