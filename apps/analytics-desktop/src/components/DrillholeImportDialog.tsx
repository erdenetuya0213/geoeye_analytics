import { Check, FileSpreadsheet, Upload, X } from 'lucide-react'
import { useState } from 'react'
import type { ImportSourceFile } from '../desktop/bridge.js'
import { readImportSource } from '../data/importSource.js'

export interface ImportedCollarRecord {
  crs?: string | undefined
  elevation: number
  easting: number
  holeId: string
  northing: number
}

export interface ImportedSurveyRecord {
  azimuth: number
  depth: number
  dip: number
  holeId: string
}

export interface DrillholeImportResult {
  collar: ImportedCollarRecord[]
  survey: ImportedSurveyRecord[]
}

type ImportKind = 'collar' | 'survey'

interface ParsedUpload {
  source: ImportSourceFile
  contents: string
  fileName: string
  headers: string[]
  mapping: Record<string, string>
  rows: string[][]
}

const fields = {
  collar: [
    { key: 'holeId', label: 'Hole ID', aliases: ['holeid', 'hole_id', 'borehole', 'boreholeid', 'bhid', 'id'] },
    { key: 'easting', label: 'Easting', aliases: ['easting', 'east', 'x', 'xcoord', 'xcoordinate'] },
    { key: 'northing', label: 'Northing', aliases: ['northing', 'north', 'y', 'ycoord', 'ycoordinate'] },
    { key: 'elevation', label: 'RL / elevation', aliases: ['rl', 'elevation', 'elev', 'z', 'reducedlevel'] },
    { key: 'crs', label: 'CRS (optional)', aliases: ['crs', 'epsg', 'epsgcode', 'coordinate_reference_system'], optional: true },
  ],
  survey: [
    { key: 'holeId', label: 'Hole ID', aliases: ['holeid', 'hole_id', 'borehole', 'boreholeid', 'bhid', 'id'] },
    { key: 'depth', label: 'Depth', aliases: ['depth', 'md', 'measureddepth', 'at'] },
    { key: 'azimuth', label: 'Azimuth', aliases: ['azimuth', 'azi', 'bearing'] },
    { key: 'dip', label: 'Dip', aliases: ['dip', 'inclination', 'incl', 'angle'] },
  ],
} as const

function normalized(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

function parseCsv(text: string) {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    const next = text[index + 1]
    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      row.push(cell.trim())
      cell = ''
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && next === '\n') index += 1
      row.push(cell.trim())
      if (row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ''
    } else {
      cell += character
    }
  }

  row.push(cell.trim())
  if (row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

function createMapping(kind: ImportKind, headers: string[]) {
  const normalizedHeaders = headers.map((header) => normalized(header))
  return Object.fromEntries(fields[kind].map((field) => {
    const index = normalizedHeaders.findIndex((header) => field.aliases.some((alias) => normalized(alias) === header))
    return [field.key, index >= 0 ? headers[index] ?? '' : '']
  }))
}

function valueFor(upload: ParsedUpload, row: string[], field: string) {
  const header = upload.mapping[field] ?? ''
  const index = upload.headers.indexOf(header)
  return index >= 0 ? row[index] ?? '' : ''
}

function numeric(value: string) {
  const parsed = Number(value.replace(/,/g, '').replace(/°/g, ''))
  return Number.isFinite(parsed) ? parsed : 0
}

function mappingComplete(kind: ImportKind, upload: ParsedUpload | null) {
  return upload !== null && fields[kind].every((field) => ('optional' in field && field.optional) || upload.mapping[field.key] !== '')
}

function normalizeCrs(value: string) {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  if (/^\d{4,6}$/.test(trimmed)) return `EPSG:${trimmed}`
  const epsg = /^epsg\s*[: ]\s*(\d{4,6})$/i.exec(trimmed)
  return epsg === null ? trimmed : `EPSG:${epsg[1]}`
}

interface DrillholeImportDialogProps {
  onClose: () => void
  onImport: (result: DrillholeImportResult, files: ImportSourceFile[]) => Promise<void>
}

export function DrillholeImportDialog({ onClose, onImport }: DrillholeImportDialogProps) {
  const [uploads, setUploads] = useState<Record<ImportKind, ParsedUpload | null>>({ collar: null, survey: null })
  const [errors, setErrors] = useState<Record<ImportKind, string>>({ collar: '', survey: '' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const readFile = async (kind: ImportKind, file: File | undefined) => {
    if (file === undefined) return
    let source: ImportSourceFile
    try { source = await readImportSource(file) } catch (error) { setErrors(current => ({ ...current, [kind]: error instanceof Error ? error.message : 'The CSV could not be read.' })); return }
    const { contents } = source
    const parsed = parseCsv(contents)
    const headers = parsed[0] ?? []
    const rows = parsed.slice(1)
    if (headers.length < 2 || rows.length === 0) {
      setErrors((current) => ({ ...current, [kind]: 'No CSV records found' }))
      return
    }
    setErrors((current) => ({ ...current, [kind]: '' }))
    setUploads((current) => ({ ...current, [kind]: { source, contents, fileName: file.name, headers, rows, mapping: createMapping(kind, headers) } }))
  }

  const updateMapping = (kind: ImportKind, field: string, header: string) => {
    setUploads((current) => {
      const upload = current[kind]
      if (upload === null) return current
      return { ...current, [kind]: { ...upload, mapping: { ...upload.mapping, [field]: header } } }
    })
  }

  const canImport = mappingComplete('collar', uploads.collar) && mappingComplete('survey', uploads.survey)

  const completeImport = async () => {
    const collarUpload = uploads.collar
    const surveyUpload = uploads.survey
    if (collarUpload === null || surveyUpload === null || !canImport) return
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try { await onImport({
      collar: collarUpload.rows.map((row) => ({
        crs: normalizeCrs(valueFor(collarUpload, row, 'crs')),
        holeId: valueFor(collarUpload, row, 'holeId'),
        easting: numeric(valueFor(collarUpload, row, 'easting')),
        northing: numeric(valueFor(collarUpload, row, 'northing')),
        elevation: numeric(valueFor(collarUpload, row, 'elevation')),
      })).filter((record) => record.holeId !== ''),
      survey: surveyUpload.rows.map((row) => ({
        holeId: valueFor(surveyUpload, row, 'holeId'),
        depth: numeric(valueFor(surveyUpload, row, 'depth')),
        azimuth: numeric(valueFor(surveyUpload, row, 'azimuth')),
        dip: numeric(valueFor(surveyUpload, row, 'dip')),
      })).filter((record) => record.holeId !== ''),
    }, [collarUpload, surveyUpload].map(upload => upload.source))
    } catch (error) { setSaveError(error instanceof Error ? error.message : 'Import could not be saved.') }
    finally { setSaving(false) }
  }

  return (
    <div className="dialog-backdrop csv-dialog-backdrop" role="presentation">
      <section aria-labelledby="csv-import-title" aria-modal="true" className="csv-import-dialog" role="dialog">
        <header className="csv-import-header">
          <FileSpreadsheet size={22} />
          <h2 id="csv-import-title">Import collar + survey CSV</h2>
          <button aria-label="Close CSV import" className="icon-button" disabled={saving} onClick={onClose} type="button"><X size={17} /></button>
        </header>

        <div className="csv-import-body">
          <div className="csv-file-grid">
            {(['collar', 'survey'] as const).map((kind) => {
              const upload = uploads[kind]
              return (
                <label className={`csv-file-card ${upload === null ? '' : 'has-file'}`} key={kind}>
                  <input accept=".csv,text/csv" aria-label={`Choose ${kind} CSV`} onChange={(event) => void readFile(kind, event.target.files?.[0])} type="file" />
                  <Upload size={19} />
                  <span><strong>{kind === 'collar' ? 'Collar CSV' : 'Survey CSV'}</strong><small>{upload?.fileName ?? 'Choose a .csv file'}</small></span>
                  {upload === null ? null : <Check size={16} />}
                  {errors[kind] === '' ? null : <em>{errors[kind]}</em>}
                </label>
              )
            })}
          </div>

          <div className="csv-mapping-grid">
            {(['collar', 'survey'] as const).map((kind) => {
              const upload = uploads[kind]
              const matched = upload === null ? 0 : fields[kind].filter((field) => upload.mapping[field.key] !== '').length
              return (
                <section className="csv-mapping-panel" key={kind}>
                  <div className="csv-mapping-title"><strong>{kind === 'collar' ? 'Collar columns' : 'Survey columns'}</strong><span>{matched} mapped</span></div>
                  {fields[kind].map((field) => (
                    <label className="csv-map-row" key={field.key}>
                      <span>{field.label}</span>
                      <select aria-label={`${kind} ${field.label} column`} disabled={upload === null} onChange={(event) => updateMapping(kind, field.key, event.target.value)} value={upload?.mapping[field.key] ?? ''}>
                        <option value="">Select source column</option>
                        {upload?.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                      </select>
                    </label>
                  ))}
                  {upload === null ? <p>Select a CSV to detect columns.</p> : mappingComplete(kind, upload) ? <p className="mapping-ok"><Check size={13} /> Ready · {upload.rows.length} rows</p> : <p className="mapping-needed">Map the unmatched required headers manually.</p>}
                </section>
              )
            })}
          </div>

          <div className="csv-preview-strip">
            <span><small>Collar preview</small><strong>{uploads.collar?.rows.slice(0, 2).map((row) => row.slice(0, 3).join(' · ')).join('  /  ') || 'Waiting for file'}</strong></span>
            <span><small>Survey preview</small><strong>{uploads.survey?.rows.slice(0, 2).map((row) => row.slice(0, 3).join(' · ')).join('  /  ') || 'Waiting for file'}</strong></span>
          </div>
        </div>

        <footer className="csv-import-footer">
          {saveError !== null ? <p role="alert">{saveError}</p> : null}
          <span>{canImport ? 'Both files are mapped and ready.' : 'Two mapped CSV files are required.'}</span>
          <button className="button button-secondary" disabled={saving} onClick={onClose} type="button">Cancel</button>
          <button className="button button-primary" disabled={!canImport || saving} onClick={() => void completeImport()} type="button">{saving ? 'Saving files…' : 'Import records'}</button>
        </footer>
      </section>
    </div>
  )
}
