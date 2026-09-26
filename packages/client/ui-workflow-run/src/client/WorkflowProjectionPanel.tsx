import { useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import {
  DisclosureRow, IconChevronRightOutlineRegular, StateDot,
  type DisclosureRowProps, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type {
  DynamicRunProjectionEvent, ExpertRunProjectionEvent, ProjectionRunStatus,
} from '@deepseek-ai/dsh-workflow-runs'
import type { WorkflowProjectionKey } from './locales.ts'
import css from './WorkflowProjectionPanel.module.css'

/**
 * 会话内投影面板（迁移蓝图 §2.10 / §四.2）：journal / expert 两族 run 的
 * Results 区、artifact 药丸条、pendingQuestion 行、Cancel / Resume / 详情按钮组。
 * 按钮可用性只读投影位：`resumable` 是 host 单信源，UI 不推导；
 * Cancel 仅在 running 且宿主给了 jobId 时可用（两press 确认）。
 */

/** Selection handed to the detail side pane. */
export interface WorkflowRunDetailSelection {
  readonly sessionId: SessionId
  readonly runId: string
  readonly label: string
  readonly family: 'journal' | 'expert'
  readonly data: DynamicRunProjectionEvent | ExpertRunProjectionEvent
}

/** Registration-side business face for the projection panels. */
export interface WorkflowProjectionInjected {
  /** Open one member's child session (kept from the member panel). */
  readonly openSession?: (target: SessionTarget) => void
  /** Kill the run's host job; resolves true when the registry admitted the request. */
  readonly killRun: (sessionId: SessionId, jobId: string) => Promise<boolean>
  /** Open the detail side pane for this run. */
  readonly openDetail: (selection: WorkflowRunDetailSelection) => void
}

/** Props for the dynamic-engine projection panel. */
export type JournalRunPanelProps =
  PropsRuntime<'conversation.chat.node', 'journal-workflow-run'>
  & PropsLocale<'workflowProjection'>
  & WorkflowProjectionInjected

/** Props for the expert-engine projection panel. */
export type ExpertRunPanelProps =
  PropsRuntime<'conversation.chat.node', 'expert-workflow-run'>
  & PropsLocale<'workflowProjection'>
  & WorkflowProjectionInjected

type ProjectionFrame = DynamicRunProjectionEvent | ExpertRunProjectionEvent

const STATUS_KEYS: Record<ProjectionRunStatus, WorkflowProjectionKey> = {
  running: 'status.running',
  completed: 'status.completed',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
  interrupted: 'status.interrupted',
}

/** Local copy of the blueprint's engine-to-projection status map (type-only import of the vocabulary keeps the client bundle free of host packages). */
function dynamicStatus(frame: DynamicRunProjectionEvent): ProjectionRunStatus {
  if (frame.status === 'completed') return 'completed'
  if (frame.status === 'errored') return 'failed'
  if (frame.status === 'stopped') {
    if (frame.stopReason === 'interrupted') return 'interrupted'
    if (frame.stopReason === 'model' || frame.stopReason === 'provider') return 'failed'
    return 'cancelled'
  }
  return 'running'
}

/** Local copy of the blueprint's expert-to-projection status map. */
function expertStatus(frame: ExpertRunProjectionEvent): ProjectionRunStatus {
  switch (frame.status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'paused': return 'interrupted'
    default: return 'running'
  }
}

/**
 * 家族判别只用节点注册时的 kind（`expert-workflow-run` / `journal-workflow-run`），
 * 绝不猜载荷键——协议允许 expert 帧的全体可选键缺席，那种合法帧用启发式会被
 * 误判成 dynamic 帧（paused 会被映射成 Running）。
 */
function projectionStatus(frame: ProjectionFrame, family: 'journal' | 'expert'): ProjectionRunStatus {
  return family === 'expert' ? expertStatus(frame as ExpertRunProjectionEvent) : dynamicStatus(frame as DynamicRunProjectionEvent)
}

function dotState(status: ProjectionRunStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'cancelled':
    case 'interrupted': return 'warning'
    /* v8 ignore next -- ProjectionRunStatus is closed and every variant is handled above. */
    default: return status satisfies never
  }
}

type DisclosureProps = Omit<DisclosureRowProps, 'expandable'>

function StatusDisclosure(props: DisclosureProps) {
  return <DisclosureRow {...props} expandable />
}

function preventPendingHeaderFocus(event: MouseEvent<HTMLElement>): void {
  const header = event.currentTarget.querySelector('[data-disclosure-row]')
  /* v8 ignore next -- DisclosureRow always renders its header before the content. */
  if (header === null) throw new Error('Missing disclosure header')
  if (header.contains(event.target as Node)) event.preventDefault()
}

function Line({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className={css.line}>
      <span className={css.lineLabel}>{label}</span>
      <span className={css.lineValue}>{children}</span>
    </div>
  )
}

/** Render one dynamic or expert run projection as a keyed Chat node. */
export function WorkflowProjectionPanel(props: JournalRunPanelProps | ExpertRunPanelProps) {
  const { sessionId, killRun, openDetail, t } = props
  const frame: ProjectionFrame = props.node.data
  // 注册即知族：props.node.kind 是注册时的字面量 kind，不是从载荷反推的。
  const family: 'journal' | 'expert' = props.node.kind === 'expert-workflow-run' ? 'expert' : 'journal'
  const expert = family === 'expert' ? frame as ExpertRunProjectionEvent : undefined
  const dynamic = family === 'journal' ? frame as DynamicRunProjectionEvent : undefined
  const status = projectionStatus(frame, family)
  const [open, setOpen] = useState(() => status !== 'completed')
  const [cancelArmed, setCancelArmed] = useState(false)
  const pending = dynamic?.pendingQuestions ?? []
  const reports = dynamic?.reports ?? []
  const phaseNames = dynamic?.phaseNames ?? []
  const trackNames = phaseNames.length > 0
    ? phaseNames
    : expert?.phases?.map(phase => phase.phase) ?? []
  const artifacts = [
    ...(dynamic?.artifacts ?? []).map(artifact => ({
      key: artifact.id,
      title: artifact.title ?? artifact.id,
      primary: artifact.primary === true,
      presetKind: artifact.preset?.kind,
    })),
    ...(expert?.artifacts ?? []).map(artifact => ({
      key: artifact.path,
      title: artifact.label,
      primary: false,
      presetKind: undefined as 'chart' | 'table' | 'metrics' | 'board' | undefined,
    })),
  ]
  const jobAdmitted = status === 'running' && typeof frame.jobId === 'string'
  // resumable 单信源：只读 host 算好的位，UI 绝不按 status 推导。
  const resumable = frame.resumable === true
  const detailSelection = useMemo<WorkflowRunDetailSelection>(() => ({
    sessionId,
    runId: frame.runId,
    label: frame.label,
    family,
    data: frame,
  }), [sessionId, frame, family])

  const confirmCancel = (): void => {
    if (!jobAdmitted) return
    setCancelArmed(true)
  }
  const fireCancel = (): void => {
    if (!cancelArmed || typeof frame.jobId !== 'string') return
    setCancelArmed(false)
    void killRun(sessionId, frame.jobId)
  }

  return (
    <section
      className={css.root}
      data-workflow-projection
      data-run-status={status}
      onMouseDownCapture={open ? undefined : preventPendingHeaderFocus}
    >
      <StatusDisclosure
        icon={<IconChevronRightOutlineRegular />}
        title={t('run.title', { name: frame.label })}
        open={open}
        onToggle={() => { setOpen(value => !value) }}
        expandOnRowClick
        previewChevron={false}
        keepContentWhenOpen
        rowClassName={css.runHeader}
        titleClassName={css.runTitle}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            {frame.currentPhase === undefined
              ? null
              : <span className={css.currentPhase} data-current-phase>{frame.currentPhase}</span>}
            <span className={css.statusTail} data-status={status}>
              <StateDot state={dotState(status)} />
              <span>{t(STATUS_KEYS[status])}</span>
            </span>
          </>
        )}
      >
        <div className={css.body}>
          <div className={css.trackRow} data-phase-track>
            {trackNames.map(phase => (
              <span
                key={phase}
                className={css.trackStop}
                data-track-stop={phase}
                data-track-current={phase === frame.currentPhase || undefined}
              >
                <StateDot state={phase === frame.currentPhase ? 'ongoing' : 'done'} />
                <span className={css.trackName}>{phase}</span>
              </span>
            ))}
          </div>

          {dynamic?.resumedFrom === undefined
            ? null
            : <Line label={t('lineage.resumedFrom')}>{dynamic.resumedFrom}</Line>}
          {dynamic?.supersededBy === undefined
            ? null
            : <Line label={t('lineage.supersededBy')}>{dynamic.supersededBy}</Line>}
          {expert?.task === undefined
            ? null
            : <Line label={t('expert.task')}>{expert.task}</Line>}
          {expert?.pauseReason === undefined
            ? null
            : <Line label={t('expert.pauseReason')}>{expert.pauseReason}</Line>}
          {expert?.recoveryActions === undefined
            ? null
            : <Line label={t('expert.recoveryActions')}>{expert.recoveryActions.join(' · ')}</Line>}
          {dynamic?.error !== undefined
            ? (
              <div className={css.error} data-run-error>
                <span className={css.errorCode}>{dynamic.error.code}</span>
                <span>{dynamic.error.message}</span>
              </div>
            )
            : null}
          {expert?.failure === undefined
            ? null
            : (
              <div className={css.error} data-run-error>
                <span className={css.errorCode}>{expert.failure.kind}</span>
                <span>{expert.failure.message}</span>
              </div>
            )}

          {pending.length > 0 && (
            <div className={css.questions} data-pending-questions>
              {pending.map(question => (
                <div key={question.questionId} className={css.questionRow}>
                  <span className={css.questionActor}>
                    {question.actorName ?? question.actor ?? t('question.anonymous')}
                  </span>
                  <span className={css.questionText}>{question.question}</span>
                </div>
              ))}
              <span className={css.questionHint}>{t('question.hint')}</span>
            </div>
          )}

          {reports.length > 0 && (
            <div className={css.results} data-results>
              <span className={css.sectionTitle}>{t('results.title')}</span>
              {reports.map((report, index) => (
                <div key={index} className={css.resultRow}>{report.text}</div>
              ))}
            </div>
          )}

          {artifacts.length > 0 && (
            <div className={css.artifacts} data-artifacts>
              <span className={css.sectionTitle}>{t('artifacts.title')}</span>
              <div className={css.artifactStrip}>
                {artifacts.map(artifact => (
                  <span key={artifact.key} className={css.artifactPill} data-artifact-pill>
                    {artifact.primary
                      ? <span className={css.primaryMark}>{t('artifact.primary')}</span>
                      : null}
                    <span>{artifact.title}</span>
                    {artifact.presetKind !== undefined
                      ? <span className={css.presetKind}>{artifact.presetKind}</span>
                      : null}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className={css.actions} data-actions>
            {jobAdmitted && (
              cancelArmed
                ? (
                  <>
                    <button type="button" className={css.button} data-cancel-confirm onClick={fireCancel}>
                      {t('action.cancel.confirm')}
                    </button>
                    <button type="button" className={css.button} onClick={() => { setCancelArmed(false) }}>
                      {t('action.cancel.dismiss')}
                    </button>
                  </>
                )
                : (
                  <button type="button" className={css.button} data-cancel onClick={confirmCancel}>
                    {t('action.cancel')}
                  </button>
                )
            )}
            {resumable && <span className={css.resumeHint} data-resume-hint>{t('action.resume.hint')}</span>}
            <button
              type="button"
              className={css.button}
              data-open-detail
              onClick={() => { openDetail(detailSelection) }}
            >
              {t('action.detail')}
            </button>
          </div>
        </div>
      </StatusDisclosure>
    </section>
  )
}
