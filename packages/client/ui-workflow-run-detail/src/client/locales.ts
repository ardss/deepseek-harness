/** `workflowRunDetail` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowRunDetail'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.title': '工作流运行',
  'pane.empty': '在会话中的工作流运行上点「详情」查看进度。',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.interrupted': '已中断',
  'spine.title': '阶段',
  'members.title': '成员',
  'results.title': '结果',
  'artifacts.title': '产物',
  'events.title': '事件日志',
  'expert.task': '任务',
  'expert.pauseReason': '暂停原因',
  'expert.recoveryActions': '恢复动作',
  'expert.report': '报告',
  'lineage.resumedFrom': '由…恢复：',
  'lineage.supersededBy': '已被取代：',
  'action.cancel': '取消',
  'action.cancel.confirm': '确认取消',
  'action.cancel.dismiss': '再想想',
  'action.resume.hint': '已停止且可恢复：让模型调用 ResumeWorkflowRun。',
}

/** English dictionary (same key set). */
export const en: Record<WorkflowRunDetailKey, string> = {
  'tab.title': 'Workflow runs',
  'pane.empty': 'Pick "Details" on a workflow run in the conversation to follow it here.',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
  'spine.title': 'Phases',
  'members.title': 'Members',
  'results.title': 'Results',
  'artifacts.title': 'Artifacts',
  'events.title': 'Event log',
  'expert.task': 'Task',
  'expert.pauseReason': 'Paused',
  'expert.recoveryActions': 'Recovery actions',
  'expert.report': 'Report',
  'lineage.resumedFrom': 'Resumed from:',
  'lineage.supersededBy': 'Superseded by:',
  'action.cancel': 'Cancel',
  'action.cancel.confirm': 'Confirm cancel',
  'action.cancel.dismiss': 'Keep it',
  'action.resume.hint': 'Stopped and resumable: ask the model to call ResumeWorkflowRun.',
}

/** Union of this namespace's dictionary keys. */
export type WorkflowRunDetailKey = keyof typeof zh
