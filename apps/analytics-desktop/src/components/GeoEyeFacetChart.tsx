import type { EChartsCoreOption } from 'echarts/core'
import { GeoEyeChart, type GeoEyeChartProps } from './GeoEyeChart.js'

export interface GeoEyeChartFacet<TResult> {
  id: string
  result: TResult
  subtitle?: string
  title: string
}

interface GeoEyeFacetChartProps<TResult> {
  ariaLabel: string
  buildOption: (result: TResult) => EChartsCoreOption
  chartProps?: Pick<GeoEyeChartProps, 'brushSelection' | 'clickSelection' | 'loading' | 'renderer'>
  facets: readonly GeoEyeChartFacet<TResult>[]
  onFacetClick?: (facet: GeoEyeChartFacet<TResult>) => void
}

function fitFacetAxis(axis: unknown, nameGap: number): unknown {
  if (Array.isArray(axis)) return axis.map((item) => fitFacetAxis(item, nameGap))
  if (typeof axis !== 'object' || axis === null) return axis
  const record = axis as Record<string, unknown>
  return {
    ...record,
    axisLabel: { ...(record.axisLabel as object | undefined), fontSize: 10, hideOverlap: true, margin: 9 },
    nameGap,
    nameTextStyle: { ...(record.nameTextStyle as object | undefined), fontSize: 10, lineHeight: 12, padding: 0 },
  }
}

export function fitFacetOption(option: EChartsCoreOption): EChartsCoreOption {
  const record = option as Record<string, unknown>
  const grid = typeof record.grid === 'object' && record.grid !== null
    ? {
        ...(record.grid as Record<string, unknown>),
        bottom: 12,
        containLabel: false,
        left: 12,
        outerBoundsContain: 'all',
        outerBoundsMode: 'same',
        right: 12,
        top: 52,
      }
    : {
        bottom: 12,
        containLabel: false,
        left: 12,
        outerBoundsContain: 'all',
        outerBoundsMode: 'same',
        right: 12,
        top: 52,
      }
  return {
    ...record,
    grid,
    xAxis: fitFacetAxis(record.xAxis, 30),
    yAxis: fitFacetAxis(record.yAxis, 34),
  } as EChartsCoreOption
}

export function GeoEyeFacetChart<TResult>({
  ariaLabel,
  buildOption,
  chartProps,
  facets,
  onFacetClick,
}: GeoEyeFacetChartProps<TResult>) {
  return (
    <div aria-label={ariaLabel} className="geoeye-facet-grid" role="group">
      {facets.map((facet) => (
        <section className="geoeye-facet" key={facet.id}>
          <header>
            {onFacetClick === undefined
              ? <span><strong>{facet.title}</strong>{facet.subtitle === undefined ? null : <small>{facet.subtitle}</small>}</span>
              : <button onClick={() => onFacetClick(facet)} type="button"><strong>{facet.title}</strong>{facet.subtitle === undefined ? null : <small>{facet.subtitle}</small>}</button>}
          </header>
          <div className="geoeye-facet-canvas">
            <GeoEyeChart
              ariaLabel={`${facet.title}${facet.subtitle === undefined ? '' : `: ${facet.subtitle}`}`}
              option={fitFacetOption(buildOption(facet.result))}
              {...chartProps}
            />
          </div>
        </section>
      ))}
    </div>
  )
}
