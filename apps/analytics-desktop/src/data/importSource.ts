import type { ImportSourceFile } from '../desktop/bridge.js'

/** Preserve the exact original bytes (including BOM); parse a separate UTF-8 view. */
export async function readImportSource(file: File): Promise<ImportSourceFile> {
  if (file.size > 64 * 1024 * 1024) throw new Error('CSV files must be 64 MB or smaller.')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const chunks: string[] = []
  for (let offset = 0; offset < bytes.length; offset += 8192) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 8192)))
  return { name: file.name, contents: new TextDecoder().decode(bytes), base64: btoa(chunks.join('')) }
}
