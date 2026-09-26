/** `workflowRun` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowRun'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'run.title': '{name}',
  'run.members.one': '{count} 个成员',
  'run.members.other': '{count} 个成员',
  'run.empty': '没有启动成员',
  'phase.unassigned': '未分阶段',
  'phase.empty': '空阶段名',
  'statusCount.running': '运行中 {count}',
  'statusCount.completed': '已完成 {count}',
  'statusCount.failed': '失败 {count}',
  'statusCount.cancelled': '已取消 {count}',
  'statusCount.interrupted': '已中断 {count}',
  'member.empty': '空成员名',
  'member.open': '打开 {name}',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.interrupted': '已中断',
}

/** English dictionary (same key set). */
export const en: Record<WorkflowRunKey, string> = {
  'run.title': '{name}',
  'run.members.one': '{count} member',
  'run.members.other': '{count} members',
  'run.empty': 'No members started',
  'phase.unassigned': 'Unphased',
  'phase.empty': 'Empty phase name',
  'statusCount.running': 'Running {count}',
  'statusCount.completed': 'Completed {count}',
  'statusCount.failed': 'Failed {count}',
  'statusCount.cancelled': 'Cancelled {count}',
  'statusCount.interrupted': 'Interrupted {count}',
  'member.empty': 'Empty member name',
  'member.open': 'Open {name}',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
}

/** Union of this namespace's dictionary keys. */
export type WorkflowRunKey = keyof typeof zh

/** Namespace for the journal / expert projection panels (this plugin, second seat). */
export const PROJECTION_NS = 'workflowProjection'

/** Simplified Chinese dictionary for the projection panels (the key-set source of truth). */
export const projectionZh = {
  'run.title': '{name}',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.interrupted': '已中断',
  'lineage.resumedFrom': '由…恢复：',
  'lineage.supersededBy': '已被取代：',
  'expert.task': '任务',
  'expert.pauseReason': '暂停原因',
  'expert.recoveryActions': '恢复动作',
  'question.anonymous': '子代理',
  'question.hint': '正等待你的回答：让模型调用 ResolveWorkflowQuestion 提交答案。',
  'results.title': '结果',
  'artifacts.title': '产物',
  'artifact.primary': '交付物',
  'action.cancel': '取消',
  'action.cancel.confirm': '确认取消',
  'action.cancel.dismiss': '再想想',
  'action.resume.hint': '已停止且可恢复：让模型调用 ResumeWorkflowRun。',
  'action.detail': '详情',
}

/** English dictionary (same key set). */
export const projectionEn: Record<WorkflowProjectionKey, string> = {
  'run.title': '{name}',
  'status.running': 'Running',
  'status.completed': 'Completed',
  'status.failed': 'Failed',
  'status.cancelled': 'Cancelled',
  'status.interrupted': 'Interrupted',
  'lineage.resumedFrom': 'Resumed from:',
  'lineage.supersededBy': 'Superseded by:',
  'expert.task': 'Task',
  'expert.pauseReason': 'Paused',
  'expert.recoveryActions': 'Recovery actions',
  'question.anonymous': 'Actor',
  'question.hint': 'Waiting for your answer: ask the model to call ResolveWorkflowQuestion.',
  'results.title': 'Results',
  'artifacts.title': 'Artifacts',
  'artifact.primary': 'primary',
  'action.cancel': 'Cancel',
  'action.cancel.confirm': 'Confirm cancel',
  'action.cancel.dismiss': 'Keep it',
  'action.resume.hint': 'Stopped and resumable: ask the model to call ResumeWorkflowRun.',
  'action.detail': 'Details',
}

/** Union of the projection namespace's dictionary keys. */
export type WorkflowProjectionKey = keyof typeof projectionZh
