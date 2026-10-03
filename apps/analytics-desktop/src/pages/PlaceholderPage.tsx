import { Construction } from 'lucide-react'
import type { SectionId } from '../types.js'

type PlaceholderSection = Exclude<SectionId, 'overview' | 'data-pool' | 'drillholes' | 'field-logging' | 'laboratory' | 'strength' | 'xrf' | 'spectral' | 'structure' | 'view-3d'>

const details: Record<PlaceholderSection, { title: string; next: string }> = {
  'spatial-reference': { title: 'Spatial reference', next: 'Coordinate systems and project extents' },
  explore: { title: 'Statistics', next: 'Summary, distributions, relationships, spatial trends, and declustering' },
  domain: { title: 'Domain', next: 'Population and boundary analysis' },
  grade: { title: 'Grade', next: 'Compositing, declustering, and cut-off scenarios' },
  variography: { title: 'Variography', next: 'Directional continuity and model fitting' },
  geotechnical: { title: 'Geotechnical', next: 'RMR, RQD, and rock-mass domains' },
  multivariate: { title: 'Multivariate', next: 'PCA, clustering, and feature relationships' },
}

interface PlaceholderPageProps {
  section: PlaceholderSection
}

export function PlaceholderPage({ section }: PlaceholderPageProps) {
  const detail = details[section]
  return (
    <div className="page placeholder-page module-placeholder-page">
      <section className="panel module-placeholder-stage">
        <div className="module-placeholder-title"><Construction size={18} /><h1>{detail.title}</h1><span>Planned module</span></div>
        <div className="module-placeholder-body"><strong>{detail.next}</strong></div>
      </section>
    </div>
  )
}
