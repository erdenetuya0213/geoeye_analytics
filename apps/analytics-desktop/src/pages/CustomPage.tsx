import { useState } from 'react'
import { ArrowLeft, LayoutTemplate, Mountain, Plus } from 'lucide-react'
import { MineralAssessmentWorkspace } from '../components/MineralAssessmentPanel.js'
import { usePersistentState } from '../state/persistentState.js'
import type { SectionId } from '../types.js'

interface CustomTemplate { id: string; title: string; summary: string; tags: string[]; icon: React.ReactNode; render: (onNavigate: (s: SectionId) => void) => React.ReactNode }

/** Use-case-specific analyses live here as templates; the general tools (Statistics, Domain, Variography…) stay general. */
const templates: CustomTemplate[] = [
  {
    id: 'mineral-system', title: 'Mineral-system assessment', tags: ['exploration', 'targeting', 'evidence'],
    summary: 'Scores evidence layers against mineral-system models and ranks investigation priorities.',
    icon: <Mountain size={18} />, render: (onNavigate) => <MineralAssessmentWorkspace onNavigate={onNavigate} />,
  },
]

export function CustomPage({ onNavigate }: { onNavigate: (section: SectionId) => void }) {
  const [activeId, setActiveId] = usePersistentState<string | null>('custom.activeTemplate', null)
  const [query, setQuery] = useState('')
  const active = templates.find((t) => t.id === activeId) ?? null
  const visible = templates.filter((t) => `${t.title} ${t.summary} ${t.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()))

  if (active !== null) return <div className="page custom-page">
    <header className="custom-active-header"><button className="ghost" onClick={() => setActiveId(null)} type="button"><ArrowLeft size={14} /> Templates</button><span><LayoutTemplate size={14} /> Custom · {active.title}</span></header>
    <div className="page multivariate-page">{active.render(onNavigate)}</div>
  </div>

  return <div className="page domain-page domain-simple-page custom-page">
    <h1 className="sr-only">Custom analyses</h1>
    <header className="domain-simple-header">
      <div><span><LayoutTemplate size={18} /></span><div><p className="eyebrow">Tailored workflows</p><h2>Custom templates</h2><small>Use-case-specific analyses built for a project or client. The general tools stay general.</small></div></div>
      <input aria-label="Search templates" className="custom-search" onChange={(e) => setQuery(e.target.value)} placeholder="Search templates…" value={query} />
    </header>
    <section className="custom-grid">
      {visible.map((t) => <button className="panel custom-card" key={t.id} onClick={() => setActiveId(t.id)} type="button">
        <span className="custom-card-icon">{t.icon}</span><strong>{t.title}</strong><p>{t.summary}</p><div className="custom-tags">{t.tags.map((tag) => <em key={tag}>{tag}</em>)}</div>
      </button>)}
      <div className="panel custom-card is-placeholder"><span className="custom-card-icon"><Plus size={18} /></span><strong>New template</strong><p>Coming next: compose a template from dataset, variables, and analysis steps, then save it for the team.</p></div>
    </section>
  </div>
}
