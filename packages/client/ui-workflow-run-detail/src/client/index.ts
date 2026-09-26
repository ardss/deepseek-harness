/**
 * Browser plugin: the workflow run detail side pane.
 *
 * Two-stage registration into the right Sidebar, exactly as a shipped type:
 * the page type into `ctx.sidebarRightTabs`, the body into the keyed
 * `sidebar.right.pane.tab` seat under the same id. The pane's data is the
 * latest selection pushed by the in-chat projection panel over the optional
 * `workflowRunDetail` service face (declared by ui-workflow-run); opening the
 * pane is `ctx.sidebarRight.openTab(kind)`.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { JobId } from '@deepseek-ai/dsh-jobs/brand'
import type {} from '@deepseek-ai/dsh-api-job-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { WorkflowRunDetailSelection } from './selection.ts'
import { setSelection } from './selection.ts'
import { WorkflowRunSidePane, type WorkflowRunSidePaneInjected } from './WorkflowRunSidePane.tsx'
import { DETAIL_TAB_ID } from './WorkflowRunSidePane.tsx'
import { en, NS, zh, type WorkflowRunDetailKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-workflow-artifacts/client'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workflow run detail pane copy. */
    workflowRunDetail: WorkflowRunDetailKey
  }
}

export type { WorkflowRunDetailSelection } from './selection.ts'
export type { WorkflowRunSidePaneInjected } from './WorkflowRunSidePane.tsx'

/** Required services: the tab registry, the slot registry, and dictionaries. */
export const inject = ['slots', 'locale', 'sidebarRightTabs']

/** Client plugin body: register the page type, its body, its title, and dictionaries. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow-run-detail: dictionaries')
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: DETAIL_TAB_ID,
    kind: DETAIL_TAB_ID,
    // 页型 tab 的 chip 文案固定；openTab 前选中数据已写入 selection store。
    title: () => 'Workflow runs',
  }), 'ui-workflow-run-detail: page type')

  const injected = (): WorkflowRunSidePaneInjected => ({
    killRun: async (sessionId, jobId) => {
      const jobs = ctx.get('jobs')
      if (jobs === undefined) return false
      return (await jobs.kill(sessionId, jobId as JobId)).ok
    },
  })

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    {
      name: 'sidebar.right.pane.tab',
      key: DETAIL_TAB_ID,
      locale: NS,
      children: {
        'workflow-run.detail.artifact': { kind: 'keyed', scope: 'session' },
      },
      inject: injected,
    },
    WorkflowRunSidePane,
  )), 'ui-workflow-run-detail: body')

  ctx.effect(() => ctx.reflect.provide('workflowRunDetail', {
    open: (selection: WorkflowRunDetailSelection) => {
      setSelection(selection)
      ctx.sidebarRight.openTab(DETAIL_TAB_ID)
    },
  }), 'ui-workflow-run-detail: selection face')
}
