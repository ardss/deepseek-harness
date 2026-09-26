/** Browser plugin for durable workflow-run Conversation Nodes. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type { SessionTarget } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { WorkflowRunDetailSelection, WorkflowProjectionInjected } from './WorkflowProjectionPanel.tsx'
import { WorkflowProjectionPanel } from './WorkflowProjectionPanel.tsx'
import { WorkflowRunPanel, type WorkflowRunInjected } from './WorkflowRunPanel.tsx'
import {
  en, NS, PROJECTION_NS, projectionEn, projectionZh,
  type WorkflowProjectionKey, type WorkflowRunKey, zh,
} from './locales.ts'
import { workflowRunDefinition } from './workflow-definition.ts'
import { expertRunDefinition, journalRunDefinition } from './workflow-projection.ts'

/** The optional detail side-pane face contributed by ui-workflow-run-detail. */
export interface WorkflowRunDetailFace {
  /** Open (or focus) the side pane on one run projection. */
  open(selection: WorkflowRunDetailSelection): void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Durable workflow-run node copy. */
    workflowRun: WorkflowRunKey
    /** journal / expert projection panel copy. */
    workflowProjection: WorkflowProjectionKey
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional: present only when ui-workflow-run-detail is loaded. */
    workflowRunDetail: WorkflowRunDetailFace | undefined
  }
}

/** Required services for Definitions, keyed renderers, navigation, and copy. */
export const inject = ['uiConversation', 'uiWorkspace', 'slots', 'sessions', 'locale']

/** Register the workflow Definitions, dictionaries, and keyed Chat renderers. */
export function apply(ctx: ClientContext): void {
  ctx.uiConversation.events.register(workflowRunDefinition)
  ctx.uiConversation.events.register(journalRunDefinition)
  ctx.uiConversation.events.register(expertRunDefinition)
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow-run: dictionaries')
  ctx.effect(
    () => ctx.locale.register(PROJECTION_NS, { zh: projectionZh, en: projectionEn }),
    'ui-workflow-run: projection dictionaries',
  )

  const injected = (): WorkflowRunInjected & WorkflowProjectionInjected => ({
    openSession: (target: SessionTarget) => { ctx.uiWorkspace.openSession(target) },
    killRun: async (sessionId, jobId) => {
      const jobs = ctx.get('jobs')
      if (jobs === undefined) return false
      return (await jobs.kill(sessionId, jobId as JobId)).ok
    },
    openDetail: (selection) => { ctx.get('workflowRunDetail')?.open(selection) },
  })

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'workflow-run',
    locale: NS,
    inject: injected,
  }, WorkflowRunPanel))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'journal-workflow-run',
    locale: PROJECTION_NS,
    inject: injected,
  }, WorkflowProjectionPanel))
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'expert-workflow-run',
    locale: PROJECTION_NS,
    inject: injected,
  }, WorkflowProjectionPanel))
}
