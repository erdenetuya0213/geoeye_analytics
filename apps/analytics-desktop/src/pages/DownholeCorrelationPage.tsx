import { ChevronDown, Link2, SlidersHorizontal } from 'lucide-react'
import type { DownholeTrackResult } from '../analysis/chartResults.js'
import { GeoEyeFacetChart } from '../components/GeoEyeFacetChart.js'
import { DownholeCorrelationIcon } from '../components/GeoEyeIcons.js'
import { buildDownholeTrackOption } from '../visualization/chartOptions.js'
import { usePersistentState } from '../state/persistentState.js'

const holes = [
  { id: 'GOR-DD-014', depth: 286, x: '0 m', segments: [18, 32, 20, 45, 26, 39, 28] },
  { id: 'GOR-DD-016', depth: 312, x: '68 m', segments: [25, 28, 34, 31, 42, 30, 26] },
  { id: 'GOR-DD-017', depth: 274, x: '141 m', segments: [14, 40, 24, 38, 28, 35, 33] },
  { id: 'GOR-DD-018', depth: 328, x: '216 m', segments: [28, 24, 37, 29, 45, 27, 31] },
] as const

const downholeResults = holes.map((hole): DownholeTrackResult => {
  let depth = 0
  const points = hole.segments.map((length, index) => {
    depth += length
    return {
      depth: Math.min(depth, hole.depth),
      sourceObservationIds: [`downhole:${hole.id}:${index}`],
      value: 0.18 + ((length * 17 + index * 11) % 115) / 100,
    }
  })
  return {
    holeId: hole.id,
    kind: 'downhole-track',
    tracks: [
      { colorRole: 'primary', name: 'Au assay', points },
      {
        colorRole: 'accent',
        name: 'Declustered trend',
        points: points.map((point, index) => ({
          ...point,
          value: (point.value + (points[index - 1]?.value ?? point.value) + (points[index + 1]?.value ?? point.value)) / 3,
        })),
      },
    ],
  }
})

interface DownholeCorrelationWorkspaceProps {
  embedded?: boolean
}

export function DownholeCorrelationWorkspace({ embedded = false }: DownholeCorrelationWorkspaceProps) {
  const [focusedHole, setFocusedHole] = usePersistentState<string>('downholeCorrelation.focusedHole', holes[1].id)

  return (
    <div className={`correlation-page ${embedded ? 'is-embedded' : 'page'}`}>
      <section className="panel correlation-stage">
        <header className="correlation-stage-header">
          <div className="correlation-title">
            <span><DownholeCorrelationIcon size={25} /></span>
            <div><p className="eyebrow">Statistics · Sectional view</p><h1>Downhole correlation</h1></div>
          </div>
          <div className="correlation-controls">
            <button className="correlation-select" type="button"><span>Section</span><strong>North fence · OR-12</strong><ChevronDown size={15} /></button>
            <button className="correlation-select" type="button"><span>Datum</span><strong>Collar RL</strong><ChevronDown size={15} /></button>
            <button className="button button-secondary" type="button"><SlidersHorizontal size={15} /> Display</button>
          </div>
        </header>

        <div className="correlation-workspace">
          <aside className="correlation-index">
            <div className="correlation-index-heading"><span>Drillholes</span><b>{holes.length}</b></div>
            {holes.map((hole) => (
              <button className={focusedHole === hole.id ? 'is-active' : ''} key={hole.id} onClick={() => setFocusedHole(hole.id)} type="button">
                <DownholeCorrelationIcon size={18} />
                <span><strong>{hole.id}</strong><small>{hole.depth} m · {hole.x}</small></span>
              </button>
            ))}
            <div className="correlation-source">
              <span>Tracks</span>
              <strong>Lithology</strong>
              <strong>Au assay</strong>
              <strong>Field logging</strong>
            </div>
          </aside>

          <div className="correlation-canvas">
            <div className="correlation-canvas-toolbar">
              <div className="correlation-legend">
                <span><i className="tone-oxide" /> Oxide</span>
                <span><i className="tone-volcanic" /> Volcanic</span>
                <span><i className="tone-intrusive" /> Intrusive</span>
                <span><i className="tone-mineral" /> Mineralised</span>
                <span><i className="tone-fault" /> Fault</span>
              </div>
              <span className="correlation-link-status"><Link2 size={13} /> 4 tie sets</span>
            </div>

            <div className="correlation-plot">
              <GeoEyeFacetChart
                ariaLabel="Downhole analytical tracks"
                buildOption={(result) => buildDownholeTrackOption(result, 'Au (g/t)')}
                facets={downholeResults.map((result) => ({
                  id: result.holeId,
                  result,
                  subtitle: `${holes.find((hole) => hole.id === result.holeId)?.depth ?? 0} m${focusedHole === result.holeId ? ' · focused' : ''}`,
                  title: result.holeId,
                }))}
                onFacetClick={(facet) => setFocusedHole(facet.id)}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export function DownholeCorrelationPage() {
  return <DownholeCorrelationWorkspace />
}
