/**
 * 本包拥有的插槽契约：`workflow-run.detail.artifact`。宿主（ui-workflow-run-detail
 * 的侧板 body）以 renderSlot 按预置种类分发（entryKey = chart | table | metrics |
 * board），本包按同 key 注册四类 body。owner 载荷保持最小：产物元数据 + 条目流。
 */

import type { DynamicWorkflowRunArtifact } from '@deepseek-ai/dsh-workflow-runs'
import type {} from '@deepseek-ai/dsh-client-ui-slots'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One artifact preset body, dispatched by the preset kind. */
    'workflow-run.detail.artifact': {
      kind: 'keyed'
      scope: 'session'
      owner: {
        /** 产物元数据（含引擎侧已校验的 preset 载荷）。 */
        readonly artifact: DynamicWorkflowRunArtifact
        /** report(item, artifactId) 条目流的最小投影。 */
        readonly entries: readonly unknown[]
      }
    }
  }
}
