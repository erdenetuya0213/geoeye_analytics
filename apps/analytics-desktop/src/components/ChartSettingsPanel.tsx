import {
  chartControlGroups,
  type ChartControlGroup,
  referenceLineLabels,
  statLabels,
  type ChartKind,
  type ChartSettings,
  type ReferenceLineKey,
  type StatKey,
} from '../visualization/chartSettings.js'

export interface ColorByOption {
  key: string
  label: string
}

interface ChartSettingsPanelProps {
  colorByOptions?: readonly ColorByOption[] | undefined
  kind: ChartKind
  onChange: (settings: ChartSettings) => void
  settings: ChartSettings
}

const statOrder: StatKey[] = [
  'count', 'missing', 'mean', 'median', 'standardDeviation', 'variance', 'coefficientOfVariation',
  'minimum', 'q1', 'q3', 'p95', 'maximum', 'skewness', 'kurtosis', 'geometricMean', 'logMean', 'logVariance',
]

const referenceOrder: ReferenceLineKey[] = ['mean', 'median', 'geometricMean', 'q1', 'q3', 'p95']

function Group({ children, title }: { children: React.ReactNode; title: string }) {
  return <section className="chart-settings-group"><h4>{title}</h4><div>{children}</div></section>
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return <label className="chart-settings-toggle"><input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" /><span>{label}</span></label>
}

function Choice<T extends string>({ label, onChange, options, value }: {
  label: string
  onChange: (value: T) => void
  options: ReadonlyArray<{ label: string; value: T }>
  value: T
}) {
  return <label className="chart-settings-field"><span>{label}</span><select onChange={(event) => onChange(event.target.value as T)} value={value}>{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
}

function NumberField({ label, max, min, onChange, step = 1, value }: {
  label: string
  max?: number
  min?: number
  onChange: (value: number) => void
  step?: number
  value: number
}) {
  return <label className="chart-settings-field"><span>{label}</span><input max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} step={step} type="number" value={value} /></label>
}

export function ChartSettingsPanel({ colorByOptions, kind, onChange, settings }: ChartSettingsPanelProps) {
  const set = <K extends keyof ChartSettings>(key: K, value: ChartSettings[K]) => onChange({ ...settings, [key]: value })
  const toggleItem = <T extends string>(list: readonly T[], item: T) => list.includes(item) ? list.filter((candidate) => candidate !== item) : [...list, item]
  const groups = chartControlGroups[kind]

  const panels: Partial<Record<ChartControlGroup, React.ReactNode>> = {}

  panels.axes = <Group key="axes" title="Axes">
      <Toggle checked={settings.logX} label="Log X" onChange={(value) => set('logX', value)} />
      <Toggle checked={settings.logY} label="Log Y" onChange={(value) => set('logY', value)} />
      {kind === 'scatter' || kind === 'qq' ? <Toggle checked={settings.sameScale} label="Same scale on both axes" onChange={(value) => set('sameScale', value)} /> : null}
      {kind === 'scatter' ? <>
        <Choice label="Transform X" onChange={(value) => set('transformX', value)} options={transformOptions} value={settings.transformX} />
        <Choice label="Transform Y" onChange={(value) => set('transformY', value)} options={transformOptions} value={settings.transformY} />
      </> : null}
    </Group>

  panels.distribution = <Group key="distribution" title="Distribution">
      <Choice label="Frequency" onChange={(value) => set('frequencyMode', value)} options={[{ label: 'Relative (%)', value: 'relative' }, { label: 'Count', value: 'count' }]} value={settings.frequencyMode} />
      <Toggle checked={settings.cumulative} label="Cumulative curve" onChange={(value) => set('cumulative', value)} />
      <Choice label="Fit curve" onChange={(value) => set('fitCurve', value)} options={[{ label: 'None', value: 'none' }, { label: 'Normal', value: 'normal' }, { label: 'Lognormal', value: 'lognormal' }]} value={settings.fitCurve} />
      <label className="chart-settings-field"><span>Bins</span><input min={2} max={80} onChange={(event) => set('binCount', event.target.value === '' ? null : Number(event.target.value))} placeholder="auto" type="number" value={settings.binCount ?? ''} /></label>
    </Group>

  panels.box = <Group key="box" title="Box">
      <Choice label="Whiskers" onChange={(value) => set('whiskerMode', value)} options={[{ label: 'Minimum to maximum', value: 'min-max' }, { label: '1.5 × IQR (Tukey)', value: 'tukey' }, { label: 'Percentile', value: 'percentile' }]} value={settings.whiskerMode} />
      {settings.whiskerMode === 'percentile' ? <NumberField label="Lower percentile" max={25} min={1} onChange={(value) => set('whiskerPercent', value)} value={settings.whiskerPercent} /> : null}
      <Toggle checked={settings.showOutliers} label="Show outliers" onChange={(value) => set('showOutliers', value)} />
      <Toggle checked={settings.showPoints} label="Show data points" onChange={(value) => set('showPoints', value)} />
      <Toggle checked={settings.showPopulationSize} label="Show population size" onChange={(value) => set('showPopulationSize', value)} />
    </Group>

  panels.marks = <Group key="marks" title="Marks">
      <Choice label="Symbol" onChange={(value) => set('symbol', value)} options={[{ label: 'Circle', value: 'circle' }, { label: 'Cross', value: 'cross' }, { label: 'Plus', value: 'plus' }, { label: 'Dot', value: 'dot' }, { label: 'None', value: 'none' }]} value={settings.symbol} />
      <NumberField label="Size" max={20} min={2} onChange={(value) => set('symbolSize', value)} value={settings.symbolSize} />
      <NumberField label="Opacity" max={1} min={0.1} onChange={(value) => set('opacity', value)} step={0.05} value={settings.opacity} />
      {colorByOptions === undefined || colorByOptions.length === 0 ? null : <Choice
        label="Colour by"
        onChange={(value) => set('colorBy', value === '' ? null : value)}
        options={[{ label: 'Single colour', value: '' }, ...colorByOptions.map((option) => ({ label: option.label, value: option.key }))]}
        value={settings.colorBy ?? ''}
      />}
    </Group>

  panels.regression = <Group key="regression" title="Regression">
      <Choice label="Line" onChange={(value) => set('regressionMethod', value)} options={[{ label: 'None', value: 'none' }, { label: 'Least squares', value: 'least-squares' }, { label: 'Reduced major axis', value: 'reduced-major-axis' }]} value={settings.regressionMethod} />
      {settings.regressionMethod === 'none' ? null : <>
        <Choice label="Model" onChange={(value) => set('regressionModel', value)} options={[{ label: 'Linear', value: 'linear' }, { label: 'Power', value: 'power' }, { label: 'Exponential', value: 'exponential' }, { label: 'Quadratic', value: 'quadratic' }]} value={settings.regressionModel} />
        <Toggle checked={settings.showEquation} label="Show equation" onChange={(value) => set('showEquation', value)} />
        <Choice
          label="Confidence"
          onChange={(value) => set('confidence', value === '' ? null : Number(value))}
          options={[{ label: 'None', value: '' }, { label: '90 %', value: '90' }, { label: '95 %', value: '95' }, { label: '99 %', value: '99' }]}
          value={settings.confidence === null ? '' : String(settings.confidence)}
        />
      </>}
      <Toggle checked={settings.showOneToOne} label="Show 1:1 line" onChange={(value) => set('showOneToOne', value)} />
      <Choice label="Control lines" onChange={(value) => set('controlLineMode', value)} options={[{ label: 'None', value: 'none' }, { label: '% difference', value: 'percent' }, { label: 'Fixed value', value: 'fixed' }]} value={settings.controlLineMode} />
      {settings.controlLineMode === 'none' ? null : <>
        <NumberField label={settings.controlLineMode === 'percent' ? 'Difference (%)' : 'Difference'} min={0} onChange={(value) => set('controlLineValue', value)} step={settings.controlLineMode === 'percent' ? 1 : 0.1} value={settings.controlLineValue} />
        <Toggle checked={settings.colorByControlLines} label="Colour points inside / outside" onChange={(value) => set('colorByControlLines', value)} />
      </>}
    </Group>

  panels.matrix = <Group key="matrix" title="Matrix">
      <Choice label="Display" onChange={(value) => set('matrixShape', value)} options={[{ label: 'Full', value: 'full' }, { label: 'Lower triangle', value: 'lower' }, { label: 'Upper triangle', value: 'upper' }]} value={settings.matrixShape} />
      <Choice label="Transform" onChange={(value) => set('transformX', value)} options={transformOptions} value={settings.transformX} />
      <NumberField label="Decimals" max={4} min={1} onChange={(value) => set('decimals', value)} value={settings.decimals} />
      <NumberField label="Dim below |r|" max={1} min={0} onChange={(value) => set('matrixThreshold', value)} step={0.05} value={settings.matrixThreshold} />
    </Group>

  panels.statistics = kind === 'matrix' ? null : <Group key="statistics" title="Statistics">
      <Toggle checked={settings.statsBox} label="Stats box on plot" onChange={(value) => set('statsBox', value)} />
      {settings.statsBox ? <>
        <Choice label="Position" onChange={(value) => set('statsCorner', value)} options={[{ label: 'Automatic (emptiest corner)', value: 'auto' }, { label: 'Top right', value: 'top-right' }, { label: 'Top left', value: 'top-left' }, { label: 'Bottom right', value: 'bottom-right' }, { label: 'Bottom left', value: 'bottom-left' }]} value={settings.statsCorner} />
        <NumberField label="Decimals" max={6} min={0} onChange={(value) => set('decimals', value)} value={settings.decimals} />
        <div className="chart-settings-checks">{statOrder.map((key) => <Toggle checked={settings.stats.includes(key)} key={key} label={statLabels[key]} onChange={() => set('stats', toggleItem(settings.stats, key))} />)}</div>
      </> : null}
    </Group>

  panels.reference = <Group key="reference" title="Reference lines">
      <div className="chart-settings-checks">{referenceOrder.map((key) => <Toggle checked={settings.referenceLines.includes(key)} key={key} label={referenceLineLabels[key]} onChange={() => set('referenceLines', toggleItem(settings.referenceLines, key))} />)}</div>
    </Group>

  return <div aria-label="Chart settings" className="chart-settings-panel" role="dialog">
    {groups.map((group) => panels[group] ?? null)}
  </div>
}

const transformOptions = [
  { label: 'None', value: 'none' as const },
  { label: 'Log', value: 'log' as const },
  { label: 'Rank', value: 'rank' as const },
  { label: 'Normal scores', value: 'normal-scores' as const },
]
