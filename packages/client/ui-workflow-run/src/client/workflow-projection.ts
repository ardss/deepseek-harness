/**
 * journal / expert 两族 run 投影的 Chat 节点定义（迁移蓝图 §2.10）。
 *
 * 数据面：宿主以 `ignorable: true` 的 opaque 会话事件（journal-run/updated、
 * expert-run/updated）携带整帧投影快照；本文件把每个 run 的事件折叠成一个
 * 持久带 id（= runId，冷恢复后稳定）的 Chat 节点，载荷即
 * `@deepseek-ai/dsh-workflow-runs` 的投影词汇。事件族持久化契约见蓝图
 * §2.10：进度不进 model 面 history，折叠节点由 opaque 载荷跨冷恢复重建。
 */

import type {
  ConversationLocation, ConversationNodeDefinition, ConversationStartMatch,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionEventLike } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {
  DynamicRunProjectionEvent,
  ExpertRunProjectionEvent,
} from '@deepseek-ai/dsh-workflow-runs'

/** Host event family carrying dynamic-run projection frames (emitted `ignorable`). */
export const JOURNAL_RUN_EVENT_TYPE = 'journal-run/updated' as const

/** Host event family carrying expert-run projection frames (emitted `ignorable`). */
export const EXPERT_RUN_EVENT_TYPE = 'expert-run/updated' as const

/** Keyed Chat payload for one dynamic (journal-engine) workflow run. */
export type JournalWorkflowRunChatData = DynamicRunProjectionEvent

/** Keyed Chat payload for one expert-engine workflow run. */
export type ExpertWorkflowRunChatData = ExpertRunProjectionEvent

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Host-side bounded projection snapshot for one dynamic workflow run. */
    'journal-run/updated': DynamicRunProjectionEvent
    /** Host-side bounded projection snapshot for one expert workflow run. */
    'expert-run/updated': ExpertRunProjectionEvent
  }
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Durable dynamic-engine workflow run projection node. */
    'journal-workflow-run': JournalWorkflowRunChatData
    /** Durable expert-engine workflow run projection node. */
    'expert-workflow-run': ExpertWorkflowRunChatData
  }
}

/**
 * Narrow a session event to the journal projection payload.
 * @param event - the event argument.
 * @returns the computed result.
 */
export function isJournalRunEvent(
  event: SessionEventLike,
): event is SessionEvent<'journal-run/updated'> {
  return event.type === JOURNAL_RUN_EVENT_TYPE
}

/**
 * Narrow a session event to the expert projection payload.
 * @param event - the event argument.
 * @returns the computed result.
 */
export function isExpertRunEvent(
  event: SessionEventLike,
): event is SessionEvent<'expert-run/updated'> {
  return event.type === EXPERT_RUN_EVENT_TYPE
}

/**
 * Whether the conversation location is closed (used to degrade a still-open
 * projection whose producing session ended without a terminal frame).
 * @param location - resolved event location.
 * @returns whether the surrounding turn/step is closed.
 */
export function projectionLocationClosed(location: ConversationLocation): boolean {
  if (location.kind === 'step') {
    return location.step.status === 'closed' || location.turn.status === 'closed'
  }
  return location.kind === 'turn' && location.turn.status === 'closed'
}

/** Build one projection node definition against one event family. */
function projectionDefinition<
  Kind extends 'journal-workflow-run' | 'expert-workflow-run',
  Data extends JournalWorkflowRunChatData | ExpertWorkflowRunChatData,
>(
  kind: Kind,
  accepts: (event: SessionEventLike) => event is SessionEvent & { data: Data },
): ConversationNodeDefinition<Data> {
  return {
    kind,
    target: 'chat',
    match: (event) => {
      if (!accepts(event)) return null
      return { id: String(event.data.runId), role: 'start' }
    },
    start: (_context, match: ConversationStartMatch): Data => {
      if (!accepts(match.event)) {
        throw new Error(`${kind} start requires ${JOURNAL_RUN_EVENT_TYPE}/${EXPERT_RUN_EVENT_TYPE}`)
      }
      return match.event.data
    },
    update: (context, match): Data => accepts(match.event) ? match.event.data : context.state,
    buildViewNode: (context): ChatConversationViewNode | null => {
      if (context.start === undefined) return null
      return {
        key: context.key,
        kind,
        id: context.id,
        target: 'chat',
        anchorSeq: context.start.event.seq,
        location: context.start.location,
        visibility: 'visible',
        data: context.state,
      }
    },
  }
}

/** Dynamic-engine run projection folded into one keyed Chat node. */
export const journalRunDefinition: ConversationNodeDefinition<JournalWorkflowRunChatData> =
  projectionDefinition('journal-workflow-run', isJournalRunEvent)

/** Expert-engine run projection folded into one keyed Chat node. */
export const expertRunDefinition: ConversationNodeDefinition<ExpertWorkflowRunChatData> =
  projectionDefinition('expert-workflow-run', isExpertRunEvent)
