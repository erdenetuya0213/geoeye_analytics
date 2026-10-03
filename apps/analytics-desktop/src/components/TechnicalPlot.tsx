import type { AnalyticalSeriesResult, VariogramAnalysisResult } from '../analysis/chartResults.js'
import { buildAnalyticalSeriesOption, buildVariogramOption } from '../visualization/chartOptions.js'
import { GeoEyeChart } from './GeoEyeChart.js'

export interface TechnicalPlotProps {
  result: AnalyticalSeriesResult | VariogramAnalysisResult
  status: string
  subtitle: string
  title: string
  xTitle: string
  yTitle: string
}

export function TechnicalPlot({ result, status, subtitle, title, xTitle, yTitle }: TechnicalPlotProps) {
  const option = result.kind === 'variogram'
    ? buildVariogramOption(result, { x: xTitle, y: yTitle })
    : buildAnalyticalSeriesOption(result, { x: xTitle, y: yTitle })

  return (
    <article className="technical-plot">
      <header className="technical-plot-heading">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
        </div>
        <span>{status}</span>
      </header>
      <div className="technical-plot-chart">
        <GeoEyeChart ariaLabel={`${title}: ${subtitle}`} clickSelection="replace" option={option} />
      </div>
    </article>
  )
}
