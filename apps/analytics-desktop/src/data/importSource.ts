import type { ImportSourceFile } from '../desktop/bridge.js'

/** Archive the exact bytes; accept UTF-8 and legacy Windows CSV exports. */
export async function readImportSource(file: File): Promise<ImportSourceFile> {
  if (file.size > 64 * 1024 * 1024) throw new Error('CSV files must be 64 MB or smaller.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  let contents: string
  try {
    contents = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    contents = new TextDecoder('windows-1252').decode(bytes)
  }
  return { name: file.name, contents, base64: btoa(chunks.join('')) }
}
