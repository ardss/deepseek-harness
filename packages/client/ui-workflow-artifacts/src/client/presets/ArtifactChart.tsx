import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowArtifactsKey } from '../locales.ts'
import type { ChartView } from './spec.ts'
import css from './preset.module.css'

/** PropsRuntime narrowed to the chart registration of the artifact slot. */
export type ArtifactChartProps =
  PropsRuntime<'workflow-run.detail.artifact', 'chart'>
  & { readonly t: (key: WorkflowArtifactsKey) => string }

const COLORS = ['#4c8fd6', '#d64c6f', '#4cd68f', '#d6a94c', '#9b4cd6']
const WIDTH = 320
const HEIGHT = 140
const PADDING = 20

/** Render one chart view as a plain SVG (no chart dependency; degrade-safe by construction). */
export function ArtifactChart({ view }: ArtifactChartProps & { readonly view: ChartView }) {
  const numeric = view.series.map(series => view.rows
    .map(row => row[series.key])
    .filter((value): value is number => typeof value === 'number'))
  const maxValue = Math.max(1, ...numeric.flat())
  const count = Math.max(1, view.rows.length)
  const x = (index: number): number =>
    PADDING + (index * (WIDTH - 2 * PADDING)) / Math.max(1, count - 1)
  const y = (value: number): number =>
    HEIGHT - PADDING - (value * (HEIGHT - 2 * PADDING)) / maxValue
  const isBar = view.kind === 'bar'
  const barWidth = Math.max(4, (WIDTH - 2 * PADDING) / count / (view.series.length + 1))

  return (
    <svg className={css.chartSvg} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" data-artifact-chart={view.kind}>
      <line className={css.chartAxis} x1={PADDING} y1={HEIGHT - PADDING} x2={WIDTH - PADDING} y2={HEIGHT - PADDING} />
      <line className={css.chartAxis} x1={PADDING} y1={PADDING} x2={PADDING} y2={HEIGHT - PADDING} />
      {view.series.map((series, seriesIndex) => {
        const color = COLORS[seriesIndex % COLORS.length]
        if (isBar) {
          return (
            <g key={series.key}>
              {view.rows.map((row, index) => {
                const value = row[series.key]
                if (typeof value !== 'number') return null
                const top = y(value)
                return (
                  <rect
                    key={index}
                    className={css.chartBar}
                    x={x(index) - barWidth / 2 + seriesIndex * barWidth}
                    y={top}
                    width={barWidth - 1}
                    height={HEIGHT - PADDING - top}
                    fill={color}
                  />
                )
              })}
            </g>
          )
        }
        const points = view.rows
          .map((row, index) => {
            const value = row[series.key]
            return typeof value === 'number' ? `${x(index)},${y(value)}` : null
          })
          .filter((point): point is string => point !== null)
          .join(' ')
        return <polyline key={series.key} className={css.chartLine} points={points} stroke={color} />
      })}
      {view.rows.map((row, index) => {
        const label = row[view.xKey]
        if (typeof label !== 'string' || label === '') return null
        return (
          <text key={index} className={css.chartLabel} x={x(index)} y={HEIGHT - 4} textAnchor="middle">
            {label.length > 8 ? `${label.slice(0, 7)}…` : label}
          </text>
        )
      })}
    </svg>
  )
}
