/**
 * @deepseek-ai/dsh-workflow-expert-core — 专家工作流引擎内核。
 *
 * 职责（迁移蓝图 §2.2）：相位状态机、WorkflowGraphScheduler（DAG 调度）、
 * artifact 播种（seedGraphFromPhaseArtifact）、快照持久化端口（WorkflowStorePort）
 * 与断点 resume 生命周期（reconcile / cancel / reopen / seed / prompt update）。
 * 零宿主 I/O：所有副作用经 WorkflowStorePort 与 runner 端口注入。
 *
 * run 状态词汇来自 `@deepseek-ai/dsh-workflow-runs`（expert 词汇），与既有
 * `@deepseek-ai/dsh-workflow` 的 CLOSED union 互斥，不得混写。
 */

export {
  BUILT_IN_EXPERT_WORKFLOW_DEFINITION_ID,
  BUILT_IN_EXPERT_WORKFLOW_DEFINITION_VERSION,
  BUILT_IN_EXPERT_WORKFLOW_KIND,
  DEFAULT_EXPERT_WORKFLOW_STRATEGY,
  createExpertWorkflowDefinition,
} from './definition.js'
export * from './expert.js'
export {
  cancelWorkflowSnapshot,
  applyWorkflowGraphSeed,
  applyWorkflowNodePromptUpdates,
  reopenWorkflowGraphNode,
  reconcileWorkflowSnapshotForResume,
} from './lifecycle.js'
export { WorkflowSchedulerEventLog } from './scheduler/events.js'
export {
  areExecutableNodesComplete,
  blockedExecutableNodes,
  orderedReadyExecutableNodes,
  readyExecutableNodes,
} from './scheduler/graph.js'
export { runWorkflowNode } from './scheduler/node-runner.js'
export { checkCollectionPlanners } from './scheduler/collection-planner.js'
export { WorkflowGraphScheduler } from './scheduler.js'
export type {
  WorkflowGraphSchedulerDeps,
  WorkflowGraphSchedulerRunOptions,
  WorkflowGraphSchedulerRunResult,
} from './scheduler/types.js'
