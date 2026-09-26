/**
 * Browser plugin: register the four artifact preset bodies into the keyed
 * `workflow-run.detail.artifact` seat owned by the workflow run detail pane,
 * plus this package's dictionaries. The body is the same lenient dispatcher
 * for every key; the key only decides which preset the pane dispatches to.
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { WorkflowArtifactBody } from './WorkflowArtifactBody.tsx'
import { en, NS, zh, type WorkflowArtifactsKey } from './locales.ts'
import './contract.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workflow artifact preset board copy. */
    workflowArtifacts: WorkflowArtifactsKey
  }
}

/** Required services: the keyed seat and dictionaries. */
export const inject = ['slots', 'locale']

/** The four preset keys, in dispatch order. */
export const PRESET_KINDS = ['chart', 'table', 'metrics', 'board'] as const

/** Client plugin body: register the dictionaries and the four keyed preset bodies. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-workflow-artifacts: dictionaries')
  for (const key of PRESET_KINDS) {
    ctx.slots.inject('workflow-run.detail.artifact', () => ctx.slots.register(
      { name: 'workflow-run.detail.artifact', key, locale: NS },
      WorkflowArtifactBody,
    ))
  }
}

export { parseArtifactPreset } from './presets/spec.ts'
export type {
  BoardCard, BoardColumnView, ChartView, MetricTile, ParsedArtifactPreset, PresetRow, TableView,
} from './presets/spec.ts'
export type { WorkflowArtifactsKey } from './locales.ts'
export type { WorkflowArtifactBodyProps } from './WorkflowArtifactBody.tsx'
