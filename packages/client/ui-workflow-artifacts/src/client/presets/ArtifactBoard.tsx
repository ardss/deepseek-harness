import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkflowArtifactsKey } from '../locales.ts'
import type { BoardColumnView } from './spec.ts'
import css from './preset.module.css'

/** PropsRuntime narrowed to the board registration of the artifact slot. */
export type ArtifactBoardProps =
  PropsRuntime<'workflow-run.detail.artifact', 'board'>
  & { readonly t: (key: WorkflowArtifactsKey) => string }

/** Render board columns; same-key cards moved/updated by the entry stream collapse to their latest state. */
export function ArtifactBoard({ view, t }: ArtifactBoardProps & { readonly view: readonly BoardColumnView[] }) {
  if (view.length === 0) return <div className={css.empty}>{t('board.empty')}</div>
  return (
    <div className={css.boardGrid} data-artifact-board>
      {view.map(column => (
        <div key={column.key} className={css.boardColumn}>
          <div className={css.boardColumnTitle}>{column.title}</div>
          {column.cards.map(card => (
            <div key={card.id} className={css.boardCard}>
              <div className={css.boardCardTitle}>{card.title}</div>
              {card.detail !== undefined && <div className={css.boardCardDetail}>{card.detail}</div>}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
