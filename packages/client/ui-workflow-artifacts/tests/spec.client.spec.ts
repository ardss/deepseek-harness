import { describe, expect, it } from 'vitest'
import type { DynamicWorkflowRunArtifact } from '@deepseek-ai/dsh-workflow-runs'
import {
  parseArtifactPreset, parseBoardSpec, parseChartSpec, parseMetricsSpec, parseTableSpec,
} from '../src/client/presets/spec.ts'

function artifact(preset: unknown): DynamicWorkflowRunArtifact {
  return {
    id: 'a1',
    kind: 'board',
    version: 1,
    ...(preset === undefined ? {} : {
      preset: preset as { kind: 'chart'; spec: unknown; entries: readonly unknown[] },
    }),
  }
}

describe('parseChartSpec', () => {
  it('honors declared keys', () => {
    const result = parseChartSpec({ x: 'day', yKeys: ['a', 'b'] }, [
      { day: 'm', a: 1, b: 2 }, { day: 't', a: 3, b: 4 },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.view.xKey).toBe('day')
      expect(result.view.series.map(series => series.key)).toEqual(['a', 'b'])
    }
  })

  it('falls back to numeric columns and refuses without them', () => {
    const ok = parseChartSpec({}, [{ x: 1, score: 5 }])
    expect(ok.ok).toBe(true)
    if (ok.ok) expect(ok.view.series.map(series => series.key)).toEqual(['score'])
    expect(parseChartSpec({}, [{ x: 1 }]).ok).toBe(false)
    expect(parseChartSpec({}, []).ok).toBe(false)
    expect(parseChartSpec(null, [{ x: 1 }]).ok).toBe(false)
  })
})

describe('parseTableSpec', () => {
  it('upserts rows by key keeping first-appearance order', () => {
    const result = parseTableSpec({ columns: ['name', 'score'], key: 'name' }, [
      { name: 'a', score: 1 }, { name: 'b', score: 2 }, { name: 'a', score: 9 },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.view.rows).toEqual([{ name: 'a', score: 9 }, { name: 'b', score: 2 }])
      expect(result.view.columns.map(column => column.key)).toEqual(['name', 'score'])
    }
  })

  it('derives columns from the first row without a spec', () => {
    const result = parseTableSpec(undefined, [{ a: 1 }])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.view.columns.map(column => column.key)).toEqual(['a'])
  })
})

describe('parseMetricsSpec', () => {
  it('takes the last entry per tile', () => {
    const result = parseMetricsSpec({ tiles: [{ key: 'score', title: 'Score', unit: 'pt' }] }, [
      { score: 1 }, { score: 5 },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.view).toHaveLength(1)
      expect(result.view[0]).toMatchObject({ key: 'score', title: 'Score', unit: 'pt', value: '5' })
    }
  })

  it('falls back to numeric keys and refuses empty tiles', () => {
    expect(parseMetricsSpec({}, [{ a: 1, b: 'x' }]).ok).toBe(true)
    expect(parseMetricsSpec({}, []).ok).toBe(false)
    expect(parseMetricsSpec({ tiles: ['gone'] }, [{ a: 1 }]).ok).toBe(false)
  })
})

describe('parseBoardSpec', () => {
  it('groups by column and collapses same-id cards', () => {
    const result = parseBoardSpec({}, [
      { id: 'c1', title: 'Card', column: 'todo' },
      { id: 'c1', column: 'done' },
      { id: 'c2', title: 'Other', column: 'done', detail: 'note' },
    ])
    expect(result.ok).toBe(true)
    if (result.ok) {
      const done = result.view.find(column => column.key === 'done')
      expect(done?.cards.map(card => card.id)).toEqual(['c1', 'c2'])
      expect(done?.cards[0]?.title).toBe('c1')
    }
  })

  it('refuses entries without identity', () => {
    expect(parseBoardSpec({}, [{ title: 'x' }]).ok).toBe(false)
  })
})

describe('parseArtifactPreset', () => {
  it('degrades gracefully for bad payloads', () => {
    const missing = parseArtifactPreset(artifact(undefined))
    expect(missing).toEqual({ ok: false, reason: 'artifact carries no preset payload' })
    const bad = parseArtifactPreset(artifact({ kind: 'chart', spec: null, entries: [] }))
    expect(bad.ok).toBe(false)
  })
})
