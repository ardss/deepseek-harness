/**
 * 时间线视图模型纯函数（对齐 ZCode timeline-model 的「一个模型，三处消费」：
 * 迷你轨、卡上横轨、详情竖脊线共用；本包先服务竖脊线）。
 * 输入一帧投影，输出站点序列；不画回边，不做 React。
 */

import type {
  DynamicRunProjectionEvent, ExpertRunProjectionEvent, ProjectionRunStatus,
} from '@deepseek-ai/dsh-workflow-runs'

/** One spine station. */
export interface TimelineStation {
  readonly name: string
  readonly state: 'pending' | 'active' | 'done' | 'failed'
}

/** Local five-word projection status (client keeps host packages type-only). */
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

/** Local expert-to-projection status map. */
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
 * 家族判别一律走调用方已知的注册 kind（`journal-workflow-run` / `expert-workflow-run`
 * 节点注册时即知道自己的族），绝不靠载荷键启发式猜——协议允许 expert 帧的全体可选键
 * 缺席，那种合法帧会被启发式误判成 dynamic 帧。
 */
export type WorkflowRunFamily = 'journal' | 'expert'

/**
 * Build the vertical spine stations for one projection frame.
 * @param frame - the current projection snapshot.
 * @param family - the run family, from the node's registered kind.
 * @returns stations in declaration order; the current phase is the active lamp.
 */
export function buildWorkflowSpine(
  frame: DynamicRunProjectionEvent | ExpertRunProjectionEvent,
  family: WorkflowRunFamily,
): readonly TimelineStation[] {
  if (family === 'expert') {
    const expertFrame = frame as ExpertRunProjectionEvent
    const phases = expertFrame.phases ?? []
    const status = expertStatus(expertFrame)
    return phases.map(phase => ({
      name: phase.phase,
      state: phase.status === 'completed'
        ? 'done'
        : phase.status === 'active'
          ? 'active'
          : phase.status === 'failed'
            ? 'failed'
            : status === 'completed' ? 'done' : 'pending',
    }))
  }
  const dynamicFrame = frame as DynamicRunProjectionEvent
  const names = dynamicFrame.phaseNames ?? []
  const current = dynamicFrame.currentPhase
  const status = dynamicStatus(dynamicFrame)
  const currentIndex = current === undefined ? -1 : names.indexOf(current)
  return names.map((name, index) => ({
    name,
    state: status === 'completed' || (currentIndex >= 0 && index < currentIndex)
      ? 'done'
      : index === currentIndex
        ? status === 'failed' ? 'failed' : 'active'
        : 'pending',
  }))
}

/**
 * Member-granularity rows for the detail pane (nodes if present, else empty).
 * @param frame - the frame argument.
 * @returns the computed result.
 */
export function buildWorkflowMemberRows(
  frame: DynamicRunProjectionEvent | ExpertRunProjectionEvent,
): readonly { readonly id: string; readonly label: string; readonly done: boolean }[] {
  const nodes = frame.nodes ?? []
  return nodes.map(node => ({
    id: node.id,
    label: node.label,
    done: node.status === 'completed',
  }))
}
