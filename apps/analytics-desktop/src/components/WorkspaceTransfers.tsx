import { useEffect, useRef, useState } from 'react'
import { desktopBridge, type SyncOperation } from '../desktop/bridge.js'
import { useDataPoolWorkspace } from '../state/DataPoolWorkspaceContext.js'
import { drillholeSyncRequests } from '../data/syncOutbox.js'
import { readLocalProjectRecord } from '../data/localProjectDb.js'

export function WorkspaceTransfers() {
  const workspace = useDataPoolWorkspace()
  const bridge = desktopBridge()
  const address = workspace.storageAddress
  const [operations, setOperations] = useState<SyncOperation[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [retryEnabled, setRetryEnabled] = useState(false)
  const inFlight = useRef(false)
  const identity = JSON.stringify(address)
  const current = useRef(identity)
  current.current = identity
  const pending = Number(workspace.localDrillholeDraft?.dirty === true) + Object.values(workspace.localTabularDrafts).filter(draft => draft?.dirty).length

  useEffect(() => {
    let active = true
    setRetryEnabled(false)
    setBusy(false)
    setNotice(null)
    setOperations([])
    if (bridge && address && !workspace.localLoading) {
      void bridge.syncStatus({ address }).then(rows => { if (active) setOperations(rows) }).catch(error => { if (active) setNotice(String(error)) })
    }
    return () => { active = false }
  }, [bridge, identity, workspace.localLoading])

  const run = async (enqueue: boolean) => {
    if (!bridge || !address || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    setNotice(null)
    try {
      if (!workspace.project?.canWrite || !workspace.connected) throw new Error('Connect with write access to this project before syncing.')
      if (enqueue) {
        // Read the durable record, never the potentially stale screen state.
        const record = await readLocalProjectRecord('', address)
        if (!record) throw new Error('Save or refresh the local project first.')
        const errors: string[] = []
        if (record.draft?.dirty) {
          try {
            if (!record.snapshot) throw new Error('Refresh the local Database copy before syncing drillholes.')
            await bridge.enqueueSync({ address, entity: 'drillholes', version: record.draft.updatedAt, requests: drillholeSyncRequests(address.projectId, record.draft, record.snapshot) })
          } catch (error) { errors.push(error instanceof Error ? error.message : String(error)) }
        }
        for (const draft of Object.values(record.tabularDrafts ?? {})) {
          if (!draft?.dirty) continue
          await bridge.enqueueSync({ address, entity: draft.section, version: draft.updatedAt, requests: [{ path: `/v1/projects/${encodeURIComponent(address.projectId)}/tabular-imports`, method: 'POST', body: JSON.stringify({ section: draft.section, fileName: draft.fileName, columns: draft.columns, rows: draft.rows }) }] })
        }
        if (current.current === identity && errors.length) setNotice(errors.join(' '))
      }
      const rows = await bridge.runSync({ address })
      if (current.current === identity) {
        setOperations(rows)
        setRetryEnabled(rows.some(row => row.state === 'retry' || row.state === 'sending'))
        await workspace.reloadLocalProject()
      }
    } catch (error) {
      if (current.current === identity) { setNotice(error instanceof Error ? error.message : String(error)); setRetryEnabled(false) }
    } finally { inFlight.current = false; if (current.current === identity) setBusy(false) }
  }

  useEffect(() => {
    if (!retryEnabled || busy) return
    const timer = window.setTimeout(() => { void run(false) }, 5000)
    return () => window.clearTimeout(timer)
  }, [retryEnabled, busy, operations, identity])

  const exportProject = async () => {
    if (!bridge || !address || inFlight.current) return
    inFlight.current = true
    setBusy(true)
    try {
      const record = await bridge.readProjectRecord(address)
      if (!record) throw new Error('There is no saved local project to export.')
      const file = await bridge.exportWorkspaceFile({ address, name: 'project-snapshot.json', contents: JSON.stringify({ format: 'geoeye-project-export', version: 1, exportedAt: new Date().toISOString(), record }, null, 2) })
      if (current.current === identity) setNotice(`Export saved: ${file}`)
    } catch (error) { if (current.current === identity) setNotice(String(error)) }
    finally { inFlight.current = false; if (current.current === identity) setBusy(false) }
  }

  if (!bridge || !address) return null
  return <section className="panel">
    <div className="panel-heading"><div><p className="eyebrow">Local files and sync</p><h2>{pending} unpublished imports</h2></div>
      <button className="button button-secondary" disabled={busy || workspace.localLoading} onClick={() => void exportProject()} type="button">Export project JSON</button>
      <button className="button button-primary" disabled={busy || workspace.localLoading || !workspace.connected || !workspace.project?.canWrite} onClick={() => void run(true)} type="button">{busy ? 'Working…' : 'Sync pending imports'}</button>
      {retryEnabled ? <button className="button button-secondary" onClick={() => setRetryEnabled(false)} type="button">Pause retries</button> : null}
    </div>
    <p className="pool-live-note">Source CSVs: imports · Exports: exports · Transfer status: sync. Each folder is grouped by tenant and project. Retries run while this page is open; the queue survives closing the app.</p>
    {notice ? <p className="pool-live-note" role="status">{notice}</p> : null}
    {operations.filter(row => row.state !== 'sent' && row.state !== 'cancelled').map(row => <div className="pool-live-note" key={row.id}>
      <strong>{row.entity}: {row.state}</strong> · {row.lastError ?? 'Waiting to send'}
      {row.nextAttemptAt && row.state === 'retry' ? ` · Retry after ${new Date(row.nextAttemptAt).toLocaleTimeString()}` : ''}
      {row.state === 'needs-review' ? <button className="button button-secondary" disabled={busy} type="button" onClick={() => {
        if (!window.confirm('Check the Database first: this upload may already have arrived. Retry can create another dataset version. Retry this transfer?')) return
        void bridge.retrySync({ address, id: row.id }).then(() => run(false)).catch(error => setNotice(String(error)))
      }}>Retry after review</button> : null}
      {row.state !== 'sending' ? <button className="button button-secondary" disabled={busy} type="button" onClick={() => {
        if (!window.confirm('Remove this pending transfer from the queue? Local imported data and any data already received by the Database will remain unchanged.')) return
        setRetryEnabled(false)
        void bridge.cancelSync({ address, id: row.id }).then(rows => { if (current.current === identity) setOperations(rows) }).catch(error => setNotice(String(error)))
      }}>Remove from queue</button> : null}
    </div>)}
  </section>
}
