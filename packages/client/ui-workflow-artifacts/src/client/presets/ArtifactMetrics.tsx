import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowArtifactsKey } from '../locales.ts'
import type { MetricTile } from './spec.ts'
import css from './preset.module.css'

/** PropsRuntime narrowed to the metrics registration of the artifact slot. */
export type ArtifactMetricsProps =
  PropsRuntime<'workflow-run.detail.artifact', 'metrics'>
  & { readonly t: (key: WorkflowArtifactsKey) => string }

/** Render metric tiles (each tile shows the latest value of its field). */
export function ArtifactMetrics({ view, t }: ArtifactMetricsProps & { readonly view: readonly MetricTile[] }) {
  if (view.length === 0) return <div className={css.empty}>{t('metrics.empty')}</div>
  return (
    <div className={css.metricsGrid} data-artifact-metrics>
      {view.map(tile => (
        <div key={tile.key} className={css.metricTile}>
          <div>
            <span className={css.metricValue}>{tile.value}</span>
            {tile.unit !== undefined && <span className={css.metricUnit}>{tile.unit}</span>}
          </div>
          <div className={css.metricTitle}>{tile.title}</div>
        </div>
      ))}
    </div>
  )
}
