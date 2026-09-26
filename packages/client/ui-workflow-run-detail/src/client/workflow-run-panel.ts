/**
 * run 动作谓词与截断常量（信源纪律：`resumable` 只读 host 算好的投影位，
 * 绝不按 status + 失败码自行推导——两处谓词会漂移：按钮亮着但命令被拒）。
 */

import type { DynamicRunProjectionEvent, ExpertRunProjectionEvent } from '@deepseek-ai/dsh-workflow-runs'
import type { WorkflowRunFamily } from './workflow-timeline-model.ts'

/** 事件日志单行字符上限（绝不把整条 journal 灌进 DOM）。 */
export const EVENT_LINE_LIMIT = 200

/** 本地五态投影（client 保持对宿主包 type-only）。 */
type FrameStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

function dynamicStatus(frame: DynamicRunProjectionEvent): FrameStatus {
  if (frame.status === 'completed') return 'completed'
  if (frame.status === 'errored') return 'failed'
  if (frame.status === 'stopped') {
    if (frame.stopReason === 'interrupted') return 'interrupted'
    if (frame.stopReason === 'model' || frame.stopReason === 'provider') return 'failed'
    return 'cancelled'
  }
  return 'running'
}

function expertStatus(frame: ExpertRunProjectionEvent): FrameStatus {
  switch (frame.status) {
    case 'completed': return 'completed'
    case 'failed': return 'failed'
    case 'cancelled': return 'cancelled'
    case 'paused': return 'interrupted'
    default: return 'running'
  }
}

/**
 * Current five-word projection status of a frame (family from the registered node kind).
 * @param frame - the frame argument.
 * @param family - the family argument.
 * @returns the computed result.
 */
export function projectionFrameStatus(
  frame: DynamicRunProjectionEvent | ExpertRunProjectionEvent,
  family: WorkflowRunFamily,
): FrameStatus {
  return family === 'expert'
    ? expertStatus(frame as ExpertRunProjectionEvent)
    : dynamicStatus(frame as DynamicRunProjectionEvent)
}

/**
 * Cancel admission: running only, and only when the host published a job id.
 * Run 缺席（投影被上限淘汰）同样不可取消。
 * @param frame - the frame argument.
 * @param family - the family argument.
 * @returns the computed result.
 */
export function canCancelRun(
  frame: DynamicRunProjectionEvent | ExpertRunProjectionEvent,
  family: WorkflowRunFamily,
): frame is (DynamicRunProjectionEvent & { jobId: string }) | (ExpertRunProjectionEvent & { jobId: string }) {
  return projectionFrameStatus(frame, family) === 'running' && typeof frame.jobId === 'string'
}

/**
 * Resume availability: the host-computed single-source bit alone.
 * 投影缺席或位不在场一律不可恢复——宁可少一个按钮，不给出一个点下去必被拒的控件。
 * @param frame - the frame argument.
 * @returns the computed result.
 */
export function canResumeRun(frame: DynamicRunProjectionEvent | ExpertRunProjectionEvent): boolean {
  return frame.resumable === true
}

/**
 * One-line event summary truncated to the DOM-safe limit.
 * @param summary - raw summary text.
 * @returns the truncated one-liner.
 */
export function truncateEventLine(summary: string): string {
  if (summary.length <= EVENT_LINE_LIMIT) return summary
  return `${summary.slice(0, EVENT_LINE_LIMIT)}…`
}
