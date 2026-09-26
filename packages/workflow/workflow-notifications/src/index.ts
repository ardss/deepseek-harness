/**
 * @deepseek-ai/dsh-workflow-notifications — 动态工作流通知铸造（纯函数，零 I/O）。
 *
 * 从 ZCode `core/src/runtime-task/notification.ts` 与 `workflow-notification-copy.ts`
 * 全量移植：终态 `<task-notification>` XML（local_workflow 形状）、六终态 deliveryGuidance、
 * provider 停下表驱动 `<error>`、escalation / stall 两条 run 中通知，以及被通知、
 * GetWorkflowRun 截面与 UI manifest 三处共用的 artifact 行投影。
 *
 * 本包只产文本；投递（jobs completion delivery / notice）由 tool-dynamic-workflow 负责。
 */

export {
  TASK_NOTIFICATION_MAX_CHARS,
  escapeXml,
  escapeXmlText,
  truncateTaskNotification,
} from './xml.ts'
export type { TaskNotificationInput } from './task-notification.ts'
export {
  formatWorkflowTaskNotification,
  STOP_TOOL_NAME,
  workflowDeliveryGuidance,
} from './task-notification.ts'
export type {
  WorkflowEscalationNotificationInput,
  WorkflowStallNotificationInput,
} from './copy.ts'
export {
  formatWorkflowEscalationNotification,
  formatWorkflowProviderStopError,
  formatWorkflowStallNotification,
} from './copy.ts'
export {
  WORKFLOW_ARTIFACTS_INTROSPECTION_MAX_LINES,
  WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES,
  buildWorkflowArtifactsSection,
  formatPublishedArtifactLine,
  primaryFirst,
} from './artifacts-line.ts'
export type { PublishedArtifactSummary } from './artifacts-line.ts'
