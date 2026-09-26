/**
 * 已保存工作流的定义存取（ZCode list-saved-workflows 的对等）：项目 `<cwd>/.dsh/workflows/`
 * + 全局 `~/.dsh/workflows/`。这些是**可按名运行的定义**，不是历史 run（历史走
 * ListWorkflowRuns）。读不了的文件进 `invalid` 指名列出——named so they can be fixed,
 * not silently skipped。
 * @module
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 全局 scope 的家目录探针（可注入；测试用它把全局目录指进临时目录）。 */
export interface SavedStoreOptions {
  /** 覆盖全局根（默认 os.homedir()；Windows 下 HOME 不参与 homedir() 的解析）。 */
  homeDir?: string
}
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

/** 一份保存的定义（落盘为 JSON 文档）。 */
export interface SavedWorkflowDefinition {
  name: string
  scope: 'project' | 'global'
  script: string
  description?: string
  args?: JsonValue
}

/** 一份读不了的保存文件（指名不静默跳过）。 */
export interface InvalidSavedWorkflow {
  scope: 'project' | 'global'
  path: string
  reason: string
}

/**
 * 保存定义的文件名安全段（导出供工具面把名字规范化后回显）。
 * @param name - the name argument.
 * @returns the computed result.
 */
export function savedWorkflowFileName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (cleaned.length === 0) throw new Error('workflow name must contain safe characters (A-Za-z0-9._-)')
  return cleaned.slice(0, 64)
}

/** 保存定义的文件名安全段。 */
function sanitize(name: string): string {
  return savedWorkflowFileName(name)
}

function scopeDir(scope: 'project' | 'global', cwd: string, options?: SavedStoreOptions): string {
  const home = options?.homeDir ?? homedir()
  return scope === 'project' ? join(cwd, '.dsh', 'workflows') : join(home, '.dsh', 'workflows')
}

/**
 * 按名落盘一份定义（写侧工具的正文；alwaysAsk 门在工具面）。
 * @param definition - the definition argument.
 * @param cwd - the cwd argument.
 * @param options - the options argument.
 * @returns the computed result.
 */
export async function saveWorkflowDefinition(
  definition: SavedWorkflowDefinition,
  cwd: string,
  options?: SavedStoreOptions,
): Promise<string> {
  const dir = scopeDir(definition.scope, cwd, options)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${sanitize(definition.name)}.json`)
  await writeFile(
    path,
    JSON.stringify({ ...definition, scope: undefined } satisfies Record<string, unknown>, null, 2),
    'utf8',
  )
  return path
}

/**
 * 列出两个 scope 的全部保存定义与读不了的文件。
 * @param cwd - the cwd argument.
 * @param options - the options argument.
 * @returns the computed result.
 */
export async function listSavedWorkflows(cwd: string, options?: SavedStoreOptions): Promise<{
  workflows: SavedWorkflowDefinition[]
  invalid: InvalidSavedWorkflow[]
}> {
  const workflows: SavedWorkflowDefinition[] = []
  const invalid: InvalidSavedWorkflow[] = []
  const scopes = ['project', 'global'] as const
  for (const scope of scopes) {
    const dir = scopeDir(scope, cwd, options)
    let entries: string[]
    try {
      entries = await readdir(dir)
    } catch {
      continue
    }
    for (const entry of entries.sort()) {
      if (!entry.endsWith('.json')) continue
      const path = join(dir, entry)
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (
          typeof parsed !== 'object' || parsed === null ||
          typeof (parsed as Record<string, unknown>)['name'] !== 'string' ||
          typeof (parsed as Record<string, unknown>)['script'] !== 'string'
        ) {
          invalid.push({ scope, path, reason: 'not a saved workflow definition (name/script missing)' })
          continue
        }
        const record = parsed as Record<string, unknown>
        workflows.push({
          name: record['name'] as string,
          scope,
          script: record['script'] as string,
          ...typeof record['description'] === 'string' ? { description: record['description'] as string } : {},
          ...record['args'] !== undefined ? { args: record['args'] as JsonValue } : {},
        })
      } catch (error: unknown) {
        invalid.push({ scope, path, reason: String(error) })
      }
    }
  }
  return { workflows, invalid }
}

/**
 * 按名读一份定义（project 先于 global）；找不到返回 undefined。
 * @param name - the name argument.
 * @param cwd - the cwd argument.
 * @param options - the options argument.
 * @returns the computed result.
 */
export async function readSavedWorkflow(
  name: string,
  cwd: string,
  options?: SavedStoreOptions,
): Promise<SavedWorkflowDefinition | undefined> {
  for (const scope of ['project', 'global'] as const) {
    const path = join(scopeDir(scope, cwd, options), `${sanitize(name)}.json`)
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
      if (
        typeof parsed === 'object' && parsed !== null &&
        typeof (parsed as Record<string, unknown>)['script'] === 'string'
      ) {
        const record = parsed as Record<string, unknown>
        return {
          name: typeof record['name'] === 'string' ? record['name'] : name,
          scope,
          script: record['script'] as string,
          ...typeof record['description'] === 'string' ? { description: record['description'] as string } : {},
          ...record['args'] !== undefined ? { args: record['args'] as JsonValue } : {},
        }
      }
    } catch {
      // 换下一个 scope
    }
  }
  return undefined
}
