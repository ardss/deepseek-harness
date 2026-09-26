/**
 * 侧板选中 run 的最小可观察存储（单页 tab，同 pane 内去重；选中即整帧替换）。
 * ui-workflow-run 的投影面板经 `workflowRunDetail` 服务 face 把选中写入这里，
 * 侧板 body 订阅读取——数据不落 slot 参数，避免把投影快照塞进导航 params。
 */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  DynamicRunProjectionEvent, ExpertRunProjectionEvent,
} from '@deepseek-ai/dsh-workflow-runs'

/** One run selection handed over from the in-chat projection panel. */
export interface WorkflowRunDetailSelection {
  readonly sessionId: SessionId
  readonly runId: string
  readonly label: string
  readonly family: 'journal' | 'expert'
  readonly data: DynamicRunProjectionEvent | ExpertRunProjectionEvent
}

let current: WorkflowRunDetailSelection | undefined
const listeners = new Set<() => void>()

/**
 * Documents the declaration above the tags.
 * @returns the current selection, when one was pushed.
 * @returns the computed result.
 */
export function getSelection(): WorkflowRunDetailSelection | undefined {
  return current
}

/**
 * Documents the declaration above the tags.
 * @param selection - the selection to show; the pane reveals itself via `openTab`.
 * @param selection - the selection argument.
 */
export function setSelection(selection: WorkflowRunDetailSelection): void {
  current = selection
  for (const listener of [...listeners]) listener()
}

/**
 * Documents the declaration above the tags.
 * @param listener - change callback. @returns the unsubscribe function.
 * @param listener - the listener argument.
 * @returns the computed result.
 */
export function subscribeSelection(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
