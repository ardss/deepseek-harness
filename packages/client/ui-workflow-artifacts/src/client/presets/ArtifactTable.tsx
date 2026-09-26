import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowArtifactsKey } from '../locales.ts'
import type { TableView } from './spec.ts'
import css from './preset.module.css'

/** PropsRuntime narrowed to the table registration of the artifact slot. */
export type ArtifactTableProps =
  PropsRuntime<'workflow-run.detail.artifact', 'table'>
  & { readonly t: (key: WorkflowArtifactsKey) => string }

/** Render one table view. */
export function ArtifactTable({ view, t }: ArtifactTableProps & { readonly view: TableView }) {
  if (view.rows.length === 0) return <div className={css.empty}>{t('table.empty')}</div>
  return (
    <table className={css.table} data-artifact-table>
      <thead>
        <tr>
          {view.columns.map(column => <th key={column.key}>{column.title}</th>)}
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row, rowIndex) => (
          <tr key={rowIndex}>
            {view.columns.map((column) => {
              const value = row[column.key]
              return (
                <td key={column.key}>
                  {value === undefined || value === null
                    ? ''
                    : typeof value === 'object' ? JSON.stringify(value) : String(value)}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
