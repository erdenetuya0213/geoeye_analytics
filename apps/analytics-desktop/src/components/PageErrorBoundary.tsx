import { Component, type ReactNode } from 'react'

interface Props { children: ReactNode; resetKey: string }
interface State { error: Error | null }

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }
  static getDerivedStateFromError(error: Error): State { return { error } }
  componentDidUpdate(prev: Props) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  componentDidCatch(error: Error, info: { componentStack?: string }) { console.error('[page]', error, info.componentStack) }
  render() {
    if (this.state.error === null) return this.props.children
    return <div className="page"><section className="panel" role="alert" style={{ padding: 20 }}>
      <h2 style={{ margin: '0 0 8px' }}>This page hit an error</h2>
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, margin: '0 0 12px' }}>{this.state.error.message}{'\n'}{this.state.error.stack?.split('\n').slice(1, 6).join('\n')}</pre>
      <button className="button button-secondary" onClick={() => this.setState({ error: null })} type="button">Try again</button>
    </section></div>
  }
}
