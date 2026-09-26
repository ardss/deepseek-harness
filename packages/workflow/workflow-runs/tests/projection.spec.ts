import { describe, expect, it } from 'vitest'
import {
  clampProjectionList,
  mapDynamicProjectionStatus,
  mapExpertProjectionStatus,
  PROJECTION_LIMITS,
  truncateProjectionText,
} from '../src/projection.ts'

describe('mapDynamicProjectionStatus', () => {
  it('maps completed and errored directly', () => {
    expect(mapDynamicProjectionStatus('completed')).toBe('completed')
    expect(mapDynamicProjectionStatus('errored')).toBe('failed')
  })

  it('maps stopped by reason', () => {
    expect(mapDynamicProjectionStatus('stopped', 'interrupted')).toBe('interrupted')
    expect(mapDynamicProjectionStatus('stopped', 'user')).toBe('cancelled')
    expect(mapDynamicProjectionStatus('stopped', 'superseded')).toBe('cancelled')
    expect(mapDynamicProjectionStatus('stopped', 'model')).toBe('failed')
    expect(mapDynamicProjectionStatus('stopped', 'provider')).toBe('failed')
  })

  it('folds pending into running', () => {
    expect(mapDynamicProjectionStatus('pending')).toBe('running')
    expect(mapDynamicProjectionStatus('running')).toBe('running')
  })
})

describe('mapExpertProjectionStatus', () => {
  it('maps the six expert words onto the five-word projection', () => {
    expect(mapExpertProjectionStatus('pending')).toBe('running')
    expect(mapExpertProjectionStatus('running')).toBe('running')
    expect(mapExpertProjectionStatus('paused')).toBe('interrupted')
    expect(mapExpertProjectionStatus('completed')).toBe('completed')
    expect(mapExpertProjectionStatus('failed')).toBe('failed')
    expect(mapExpertProjectionStatus('cancelled')).toBe('cancelled')
  })
})

describe('clampProjectionList', () => {
  it('keeps a bounded list untouched and reports no truncation', () => {
    const items = [1, 2, 3]
    const result = clampProjectionList(items, PROJECTION_LIMITS.reports)
    expect(result.items).toBe(items)
    expect(result.truncated).toBe(false)
  })

  it('slices an overflowing list and raises the truncation bit', () => {
    const items = Array.from({ length: PROJECTION_LIMITS.reports + 1 }, (_, index) => index)
    const result = clampProjectionList(items, PROJECTION_LIMITS.reports)
    expect(result.items).toHaveLength(PROJECTION_LIMITS.reports)
    expect(result.truncated).toBe(true)
  })
})

describe('truncateProjectionText', () => {
  it('keeps short text identical', () => {
    expect(truncateProjectionText('abc', 5)).toBe('abc')
  })

  it('cuts long text at the limit with an ellipsis', () => {
    expect(truncateProjectionText('abcdef', 3)).toBe('abc…')
  })
})
