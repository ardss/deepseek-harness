/**
 * 内联脚本草稿落盘（ZCode workflow-drafts.ts 的对等）：内联脚本**无论编译成败**都写成
 * `<cwd>/.dsh/workflow-drafts/` 下的文件——编不过的脚本走不到确认窗，工具结果是它唯一
 * 必经的地方，不写就等于「唯一需要被编辑的那份脚本反而没有文件」。
 * @module
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 已写下的草稿：模型面只看相对（或绝对）的 path。 */
export interface WorkflowDraft {
  path: string
}

/** 从名字（或缺省名）铸一个文件名安全的段。 */
function sanitize(name: string): string {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 64) : 'workflow'
}

/**
 * 写一份草稿；目录不可写时返回 undefined（调用方文案退回「没有可编辑文件」那一路）。
 * @param options - the options argument.
 * @returns the computed result.
 */
export async function writeWorkflowDraft(options: {
  cwd: string
  name: string
  source: string
}): Promise<WorkflowDraft | undefined> {
  const dir = join(options.cwd, '.dsh', 'workflow-drafts')
  try {
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${sanitize(options.name)}-${Date.now()}.ts`)
    await writeFile(path, options.source, 'utf8')
    return { path }
  } catch {
    return undefined
  }
}

/**
 * 把绝对路径写成模型面的写法：在工作目录下则相对化，否则保留绝对（跨盘/越界都安全）。
 * @param absolute - the absolute argument.
 * @param cwd - the cwd argument.
 * @returns the computed result.
 */
export function describeWorkflowScriptPath(absolute: string, cwd: string): string {
  const normalizedAbsolute = absolute.replaceAll('\\', '/')
  const normalizedCwd = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  if (normalizedAbsolute.startsWith(`${normalizedCwd}/`)) {
    return normalizedAbsolute.slice(normalizedCwd.length + 1)
  }
  return normalizedAbsolute
}
