/**
 * 预置看板 spec 的宽松二次解析（对齐 ZCode workflow-artifacts/presets/spec.ts 的
 * 解析原则）：引擎侧已做 zod 权威校验，渲染器不该对坏 spec 抛异常把整个侧板炸掉
 * ——能渲染就归一化，不能就降级成一张「无法渲染」的卡。
 *
 * 所有解析器只读 `artifact.preset`（spec 原文 + 条目流），产出纯视图模型；
 * 任何一步形状不符都返回 `{ ok: false }`，绝不抛出。
 */

import type { DynamicWorkflowRunArtifact } from '@deepseek-ai/dsh-workflow-runs'

/** One parsed record: entries that are plain objects. */
export type PresetRow = Readonly<Record<string, unknown>>

/**
 * Collect the object-shaped entries; non-object entries are skipped, not fatal.
 * @param entries - the entries argument.
 * @returns the computed result.
 */
export function objectRows(entries: readonly unknown[]): readonly PresetRow[] {
  return entries.filter((entry): entry is PresetRow =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry))
}

/** Read a string field from a loose spec record. */
function specString(spec: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = spec[key]
    if (typeof value === 'string' && value !== '') return value
  }
  return undefined
}

/** Read a string-array field from a loose spec record. */
function specStrings(spec: Record<string, unknown>, keys: readonly string[]): readonly string[] {
  for (const key of keys) {
    const value = spec[key]
    if (typeof value === 'string' && value !== '') return [value]
    if (Array.isArray(value) && value.every(item => typeof item === 'string')) {
      return value as readonly string[]
    }
  }
  return []
}

// ============================================================
// chart
// ============================================================

/** Normalized chart view model. */
export interface ChartView {
  readonly kind: 'line' | 'bar'
  readonly xKey: string
  readonly series: readonly { readonly key: string }[]
  readonly rows: readonly PresetRow[]
}

/**
 * Parse a chart spec: x key, one or more y keys; missing y keys fall back to
 * every numeric column other than x of the first usable row.
 * @param spec - the spec argument.
 * @param entries - the entries argument.
 * @returns the computed result.
 */
export function parseChartSpec(
  spec: unknown,
  entries: readonly unknown[],
): { ok: true; view: ChartView } | { ok: false; reason: string } {
  if (typeof spec !== 'object' || spec === null) return { ok: false, reason: 'spec is not an object' }
  const record = spec as Record<string, unknown>
  const rows = objectRows(entries)
  if (rows.length === 0) return { ok: false, reason: 'no object entries' }
  const xKey = specString(record, ['x', 'xKey', 'xField']) ?? 'x'
  const declared = specStrings(record, ['y', 'yKeys', 'yFields', 'series'])
  const yKeys = declared.length > 0
    ? declared
    : Object.keys(rows[0]!).filter(key => key !== xKey && typeof rows[0]![key] === 'number')
  if (yKeys.length === 0) return { ok: false, reason: 'no numeric series' }
  const chartKind = specString(record, ['type', 'kind', 'chart', 'mode'])
  return {
    ok: true,
    view: {
      kind: chartKind === 'bar' ? 'bar' : 'line',
      xKey,
      series: yKeys.map(key => ({ key })),
      rows,
    },
  }
}

// ============================================================
// table
// ============================================================

/** Normalized table view model. */
export interface TableView {
  readonly columns: readonly { readonly key: string; readonly title: string }[]
  /** Rows after key-based upsert (last entry per key wins); order of first appearance. */
  readonly rows: readonly PresetRow[]
}

/**
 * Parse a table spec: declared columns, or the first row's keys; optional upsert key.
 * @param spec - the spec argument.
 * @param entries - the entries argument.
 * @returns the computed result.
 */
export function parseTableSpec(
  spec: unknown,
  entries: readonly unknown[],
): { ok: true; view: TableView } | { ok: false; reason: string } {
  const rows = objectRows(entries)
  if (rows.length === 0) return { ok: false, reason: 'no object entries' }
  const record = typeof spec === 'object' && spec !== null ? spec as Record<string, unknown> : {}
  const upsertKey = specString(record, ['key', 'keyField', 'idKey'])
  const seen = new Map<string, PresetRow>()
  for (const row of rows) {
    const identity = upsertKey === undefined ? undefined : row[upsertKey]
    const mapKey = typeof identity === 'string' || typeof identity === 'number'
      ? String(identity)
      : undefined
    if (mapKey === undefined) continue
    seen.set(mapKey, row)
  }
  const effective = upsertKey === undefined || seen.size === 0 ? rows : [...seen.values()]
  const declared = specStrings(record, ['columns']).map(key => ({ key, title: key }))
  const columnList = Array.isArray(record.columns) && record.columns.length > 0
    ? record.columns.flatMap((column) => {
      if (typeof column === 'string' && column !== '') return [{ key: column, title: column }]
      if (typeof column === 'object' && column !== null) {
        const entry = column as Record<string, unknown>
        const key = typeof entry.key === 'string' ? entry.key : undefined
        if (key !== undefined) {
          return [{
            key,
            title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : key,
          }]
        }
      }
      return []
    })
    : declared.length > 0
      ? declared
      : Object.keys(rows[0]!).map(key => ({ key, title: key }))
  if (columnList.length === 0) return { ok: false, reason: 'no columns' }
  return { ok: true, view: { columns: columnList, rows: effective } }
}

// ============================================================
// metrics
// ============================================================

/** Normalized metrics tile. */
export interface MetricTile {
  readonly key: string
  readonly title: string
  readonly unit?: string
  readonly value: string
}

/**
 * Parse a metrics spec: each tile takes the LAST entry carrying its field.
 * @param spec - the spec argument.
 * @param entries - the entries argument.
 * @returns the computed result.
 */
export function parseMetricsSpec(
  spec: unknown,
  entries: readonly unknown[],
): { ok: true; view: readonly MetricTile[] } | { ok: false; reason: string } {
  const rows = objectRows(entries)
  if (rows.length === 0) return { ok: false, reason: 'no object entries' }
  const record = typeof spec === 'object' && spec !== null ? spec as Record<string, unknown> : {}
  const tileDefs = Array.isArray(record.tiles) && record.tiles.length > 0
    ? record.tiles.flatMap((tile) => {
      if (typeof tile === 'string' && tile !== '') return [{ key: tile, title: tile, unit: undefined as string | undefined }]
      if (typeof tile === 'object' && tile !== null) {
        const entry = tile as Record<string, unknown>
        const key = typeof entry.key === 'string' ? entry.key : undefined
        if (key !== undefined) {
          return [{
            key,
            title: typeof entry.title === 'string' && entry.title !== '' ? entry.title : key,
            unit: typeof entry.unit === 'string' ? entry.unit : undefined,
          }]
        }
      }
      return []
    })
    : Object.keys(rows[0]!)
      .filter(key => typeof rows[0]![key] === 'number')
      .slice(0, 6)
      .map(key => ({ key, title: key, unit: undefined as string | undefined }))
  if (tileDefs.length === 0) return { ok: false, reason: 'no tiles' }
  const tiles: MetricTile[] = []
  for (const tile of tileDefs) {
    let latest: unknown
    let found = false
    for (const row of rows) {
      if (row[tile.key] !== undefined) {
        latest = row[tile.key]
        found = true
      }
    }
    if (!found) continue
    tiles.push({
      key: tile.key,
      title: tile.title,
      ...(tile.unit !== undefined ? { unit: tile.unit } : {}),
      value: formatMetricValue(latest),
    })
  }
  if (tiles.length === 0) return { ok: false, reason: 'no tile had a value' }
  return { ok: true, view: tiles }
}

function formatMetricValue(value: unknown): string {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : value.toFixed(2)
  if (typeof value === 'string') return value
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  return String(value)
}

// ============================================================
// board
// ============================================================

/** Normalized board card. */
export interface BoardCard {
  readonly id: string
  readonly title: string
  readonly detail?: string
}

/** Normalized board column. */
export interface BoardColumnView {
  readonly key: string
  readonly title: string
  readonly cards: readonly BoardCard[]
}

/**
 * Parse a board spec: cards keyed by id (same key moves/updates), grouped by column field.
 * @param spec - the spec argument.
 * @param entries - the entries argument.
 * @returns the computed result.
 */
export function parseBoardSpec(
  spec: unknown,
  entries: readonly unknown[],
): { ok: true; view: readonly BoardColumnView[] } | { ok: false; reason: string } {
  const rows = objectRows(entries)
  if (rows.length === 0) return { ok: false, reason: 'no object entries' }
  const record = typeof spec === 'object' && spec !== null ? spec as Record<string, unknown> : {}
  const columnField = specString(record, ['columnKey', 'column', 'groupBy']) ?? 'column'
  const titleField = specString(record, ['titleKey', 'title']) ?? 'title'
  const byId = new Map<string, PresetRow>()
  const order: string[] = []
  for (const row of rows) {
    const id = row['id'] ?? row['cardId'] ?? row['key']
    if (typeof id !== 'string' && typeof id !== 'number') continue
    const mapKey = String(id)
    if (!byId.has(mapKey)) order.push(mapKey)
    byId.set(mapKey, row)
  }
  if (byId.size === 0) return { ok: false, reason: 'no identifiable cards' }
  const columns = new Map<string, BoardCard[]>()
  for (const id of order) {
    const row = byId.get(id)!
    const columnValue = row[columnField]
    const columnKey = typeof columnValue === 'string' && columnValue !== ''
      ? columnValue
      : 'unfiled'
    const titleValue = row[titleField]
    const detailValue = row['detail'] ?? row['note']
    const card: BoardCard = {
      id,
      title: typeof titleValue === 'string' && titleValue !== '' ? titleValue : id,
      ...(typeof detailValue === 'string' && detailValue !== '' ? { detail: detailValue } : {}),
    }
    const bucket = columns.get(columnKey)
    if (bucket === undefined) columns.set(columnKey, [card])
    else bucket.push(card)
  }
  const view = [...columns].map(([key, cards]) => ({ key, title: key, cards }))
  return view.length > 0 ? { ok: true, view } : { ok: false, reason: 'no columns' }
}

// ============================================================
// dispatch
// ============================================================

/** One artifact's parsed preset payload. */
export type ParsedArtifactPreset =
  | { readonly ok: true; readonly kind: 'chart'; readonly view: ChartView }
  | { readonly ok: true; readonly kind: 'table'; readonly view: TableView }
  | { readonly ok: true; readonly kind: 'metrics'; readonly view: readonly MetricTile[] }
  | { readonly ok: true; readonly kind: 'board'; readonly view: readonly BoardColumnView[] }
  | { readonly ok: false; readonly reason: string }

/**
 * Parse one artifact's preset payload leniently.
 * @param artifact - the projection artifact carrying `preset`.
 * @returns a per-kind view model, or a degrade reason.
 */
export function parseArtifactPreset(artifact: DynamicWorkflowRunArtifact): ParsedArtifactPreset {
  const preset = artifact.preset
  if (preset === undefined) return { ok: false, reason: 'artifact carries no preset payload' }
  switch (preset.kind) {
    case 'chart': {
      const result = parseChartSpec(preset.spec, preset.entries)
      return result.ok ? { ok: true, kind: 'chart', view: result.view } : result
    }
    case 'table': {
      const result = parseTableSpec(preset.spec, preset.entries)
      return result.ok ? { ok: true, kind: 'table', view: result.view } : result
    }
    case 'metrics': {
      const result = parseMetricsSpec(preset.spec, preset.entries)
      return result.ok ? { ok: true, kind: 'metrics', view: result.view } : result
    }
    case 'board': {
      const result = parseBoardSpec(preset.spec, preset.entries)
      return result.ok ? { ok: true, kind: 'board', view: result.view } : result
    }
    /* v8 ignore next -- the preset kind union is closed and handled above. */
    default:
      return { ok: false, reason: 'unknown preset kind' }
  }
}
