interface DownholeCorrelationWorkspaceProps {
  embedded?: boolean
}

export function DownholeCorrelationWorkspace({ embedded = false }: DownholeCorrelationWorkspaceProps) {
  return (
    <div className={`correlation-page ${embedded ? 'is-embedded' : 'page'}`}>
      <section className="panel eda-state">
        <strong>No downhole correlation is available.</strong>
        <span>Import or synchronize drillhole and interval data before opening this view.</span>
      </section>
    </div>
  )
}

export function DownholeCorrelationPage() {
  return <DownholeCorrelationWorkspace />
}
