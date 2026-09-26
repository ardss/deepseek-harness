/**
 * XML 转义与总截断（移植自 ZCode notification.ts 的尾部工具函数）。
 * @module
 */

/** 终态通知的字符上界（ZCode 同值）：截断次序 result > reports > artifacts > guidance。 */
export const TASK_NOTIFICATION_MAX_CHARS = 120_000

/**
 * 全转义（<>&'"）：字段值那一路。
 * @param value - the value argument.
 * @returns the computed result.
 */
export function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/gu, (char) => {
    switch (char) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      case "'":
        return '&apos;'
      case '"':
        return '&quot;'
      default:
        return char
    }
  })
}

/**
 * 只转义 <>&：块里有要让模型照抄的 `run_id="…"` 时用（引号原样）。
 * @param value - the value argument.
 * @returns the computed result.
 */
export function escapeXmlText(value: string): string {
  return value.replace(/[<>&]/gu, (char) => {
    switch (char) {
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '&':
        return '&amp;'
      default:
        return char
    }
  })
}

/**
 * 超 120k 截断并打上显式 `[truncated]` 标记。
 * @param value - the value argument.
 * @returns the computed result.
 */
export function truncateTaskNotification(value: string): string {
  if (value.length <= TASK_NOTIFICATION_MAX_CHARS) return value
  return `${value.slice(0, TASK_NOTIFICATION_MAX_CHARS)}\n[truncated]`
}
