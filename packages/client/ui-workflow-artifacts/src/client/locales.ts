/** `workflowArtifacts` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'workflowArtifacts'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'unrenderable.title': '无法渲染该看板',
  'unrenderable.hint': 'spec 无法解析或与数据不匹配；数据仍安全地保存在 run 记录中。',
  'chart.title': '图表',
  'table.empty': '没有条目',
  'metrics.empty': '没有指标',
  'board.empty': '没有卡片',
}

/** English dictionary (same key set). */
export const en: Record<WorkflowArtifactsKey, string> = {
  'unrenderable.title': 'This board cannot be rendered',
  'unrenderable.hint': 'The spec failed to parse or does not match its data; the data itself remains safe in the run record.',
  'chart.title': 'Chart',
  'table.empty': 'No entries',
  'metrics.empty': 'No metrics',
  'board.empty': 'No cards',
}

/** Union of this namespace's dictionary keys. */
export type WorkflowArtifactsKey = keyof typeof zh
