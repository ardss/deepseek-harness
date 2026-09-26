import { useMemo, useState, useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DynamicRunProjectionEvent, ExpertRunProjectionEvent, ProjectionRunStatus,
} from '@deepseek-ai/dsh-workflow-runs'
import { getSelection, subscribeSelection } from './selection.ts'
import { buildWorkflowSpine, type WorkflowRunFamily } from './workflow-timeline-model.ts'
import { canCancelRun, canResumeRun, projectionFrameStatus, truncateEventLine } from './workflow-run-panel.ts'
import type { WorkflowRunDetailKey } from './locales.ts'
import css from './WorkflowRunSidePane.module.css'

/**
 * run 详情侧板（迁移蓝图 §2.10 / §四.3）：状态头 + 竖脊线相位列表
 * （阶段=灯、并行=缩进、不画回边）+ Results / Artifacts 区 + 事件日志
 * （单行 200 字符截断）+ Cancel / Resume。数据是父会话投影的权威快照，
 * 不是本面板的本地查询缓存；独立事件日志 RPC 列为二期（蓝图 §四.8）。
 */

/** The tab id this plugin registers its body under (same as the type definition id). */
export const DETAIL_TAB_ID = '@deepseek-ai/dsh-client-ui-workflow-run-detail'

/** Registration-side business face for the side pane body. */
export interface WorkflowRunSidePaneInjected {
  /** Kill the run's host job on the human's behalf. */
  readonly killRun: (sessionId: SessionId, jobId: string) => Promise<boolean>
}

/** Body props of the detail tab. */
export type WorkflowRunSidePaneProps =
  PropsRuntime<'sidebar.right.pane.tab', typeof DETAIL_TAB_ID>
  & PropsLocale<'workflowRunDetail'>
  & PropsRenderSlots<'workflow-run.detail.artifact'>
  & WorkflowRunSidePaneInjected

const STATUS_KEYS: Record<ProjectionRunStatus, WorkflowRunDetailKey> = {
  running: 'status.running',
  completed: 'status.completed',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
  interrupted: 'status.interrupted',
}

/** The detail side pane body: one selected run, or the empty hint. */
export function WorkflowRunSidePane(props: WorkflowRunSidePaneProps) {
  const { killRun, t } = props
  const selection = useSyncExternalStore(subscribeSelection, getSelection, getSelection)
  const [cancelArmed, setCancelArmed] = useState(false)
  const frame = selection?.data
  // 家族判别只用 selection 携带的注册 kind（面板写入时按 node.kind 判定），
  // 绝不靠载荷键启发式——全体可选键缺席的合法 expert 帧不是 dynamic 帧。
  const family: WorkflowRunFamily | undefined = selection?.family
  const dynamic = frame !== undefined && family === 'journal'
    ? frame as DynamicRunProjectionEvent
    : undefined
  const expert = frame !== undefined && family === 'expert'
    ? frame as ExpertRunProjectionEvent
    : undefined
  const spine = useMemo(() => frame === undefined || family === undefined ? [] : buildWorkflowSpine(frame, family), [frame, family])
  const { renderSlot } = props
  if (frame === undefined || selection === undefined) {
    return <div className={css.root} data-run-detail-empty>{t('pane.empty')}</div>
  }
  const status = projectionFrameStatus(frame, selection.family)
  const events = frame.events ?? []
  const reports = dynamic?.reports ?? []
  const resultPreview = dynamic?.resultPreview
  const reportPreview = expert?.reportPreview
  const artifacts = dynamic?.artifacts
  const expertArtifacts = expert?.artifacts
  const cancelAdmitted = canCancelRun(frame, selection.family)
  const resumeAdmitted = canResumeRun(frame)

  const fireCancel = (): void => {
    if (!cancelArmed || !cancelAdmitted || typeof frame.jobId !== 'string') return
    setCancelArmed(false)
    void killRun(selection.sessionId, frame.jobId)
  }

  return (
    <div className={css.root} data-run-detail data-run-status={status}>
      <header className={css.header}>
        <span className={css.title}>{selection.label}</span>
        <span className={css.statusTail} data-status={status}>{t(STATUS_KEYS[status])}</span>
      </header>

      <div className={css.meta}>
        {dynamic?.resumedFrom === undefined
          ? null
          : <div className={css.metaLine}><span>{t('lineage.resumedFrom')}</span>{dynamic.resumedFrom}</div>}
        {dynamic?.supersededBy === undefined
          ? null
          : <div className={css.metaLine}><span>{t('lineage.supersededBy')}</span>{dynamic.supersededBy}</div>}
        {expert?.task !== undefined
          ? <div className={css.metaLine}><span>{t('expert.task')}</span>{expert.task}</div>
          : null}
        {expert?.pauseReason !== undefined
          ? (
            <div className={css.metaLine}>
              <span>{t('expert.pauseReason')}</span>
              {expert.pauseReason}
            </div>
          )
          : null}
        {expert?.recoveryActions !== undefined
          ? (
            <div className={css.metaLine}>
              <span>{t('expert.recoveryActions')}</span>
              {expert.recoveryActions.join(' · ')}
            </div>
          )
          : null}
        {dynamic?.error !== undefined
          ? (
            <div className={css.error}>
              <span>{dynamic.error.code}</span>
              <span>{dynamic.error.message}</span>
            </div>
          )
          : null}
        {expert?.failure !== undefined
          ? (
            <div className={css.error}>
              <span>{expert.failure.kind}</span>
              <span>{expert.failure.message}</span>
            </div>
          )
          : null}
      </div>

      {spine.length > 0 && (
        <section className={css.section} data-spine>
          <span className={css.sectionTitle}>{t('spine.title')}</span>
          <ol className={css.spineList}>
            {spine.map(station => (
              <li key={station.name} className={css.spineItem} data-spine-state={station.state}>
                <span className={css.spineDot} aria-hidden />
                <span className={css.spineName}>{station.name}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {reports.length > 0 && (
        <section className={css.section} data-results>
          <span className={css.sectionTitle}>{t('results.title')}</span>
          {reports.map((report, index) => (
            <div key={index} className={css.resultRow}>{report.text}</div>
          ))}
        </section>
      )}
      {(resultPreview !== undefined || reportPreview !== undefined) && (
        <section className={css.section} data-result-preview>
          <span className={css.sectionTitle}>{reportPreview !== undefined ? t('expert.report') : t('results.title')}</span>
          <div className={css.resultRow}>{resultPreview ?? reportPreview}</div>
        </section>
      )}

      {((artifacts !== undefined && artifacts.length > 0) || (expertArtifacts !== undefined && expertArtifacts.length > 0)) && (
        <section className={css.section} data-artifacts>
          <span className={css.sectionTitle}>{t('artifacts.title')}</span>
          {(artifacts ?? []).map(artifact => (
            <div key={artifact.id} className={css.artifactBlock}>
              <span className={css.artifactTitle}>{artifact.title ?? artifact.id}</span>
              {artifact.preset !== undefined && renderSlot !== undefined
                ? renderSlot('workflow-run.detail.artifact', { artifact, entries: artifact.preset.entries },
                  { entryKey: artifact.preset.kind })
                : artifact.description !== undefined
                  ? <div className={css.resultRow}>{artifact.description}</div>
                  : null}
            </div>
          ))}
          {(expertArtifacts ?? []).map(artifact => (
            <div key={artifact.path} className={css.artifactBlock}>
              <span className={css.artifactTitle}>{artifact.label}</span>
              <div className={css.resultRow}>{artifact.path}</div>
            </div>
          ))}
        </section>
      )}

      {events.length > 0 && (
        <section className={css.section} data-events>
          <span className={css.sectionTitle}>{t('events.title')}</span>
          {events.map(event => (
            <div key={event.seq} className={css.eventRow}>
              <span className={css.eventType}>{event.type}</span>
              <span className={css.eventSummary}>{truncateEventLine(event.summary)}</span>
            </div>
          ))}
        </section>
      )}

      <div className={css.actions} data-actions>
        {cancelAdmitted && (
          cancelArmed
            ? (
              <>
                <button type="button" className={css.button} onClick={fireCancel}>{t('action.cancel.confirm')}</button>
                <button type="button" className={css.button} onClick={() => { setCancelArmed(false) }}>
                  {t('action.cancel.dismiss')}
                </button>
              </>
            )
            : (
              <button type="button" className={css.button} onClick={() => { setCancelArmed(true) }}>
                {t('action.cancel')}
              </button>
            )
        )}
        {resumeAdmitted && <span className={css.resumeHint}>{t('action.resume.hint')}</span>}
      </div>
    </div>
  )
}
