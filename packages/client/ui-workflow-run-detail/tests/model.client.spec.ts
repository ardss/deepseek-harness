import { describe, expect, it, vi } from 'vitest'
import type { DynamicRunProjectionEvent, ExpertRunProjectionEvent } from '@deepseek-ai/dsh-workflow-runs'
import { buildWorkflowSpine } from '../src/client/workflow-timeline-model.ts'
import { canCancelRun, canResumeRun, truncateEventLine } from '../src/client/workflow-run-panel.ts'
import { createThrottledHandler } from '../src/client/workflow-throttle.ts'
import { getSelection, setSelection, subscribeSelection } from '../src/client/selection.ts'

const dynamicFrame: DynamicRunProjectionEvent = {
  runId: 'wf_1',
  label: 'Demo',
  status: 'running',
  phaseNames: ['research', 'build', 'review'],
  currentPhase: 'build',
}

describe('buildWorkflowSpine', () => {
  it('marks the current phase active and earlier phases done', () => {
    expect(buildWorkflowSpine(dynamicFrame, 'journal')).toEqual([
      { name: 'research', state: 'done' },
      { name: 'build', state: 'active' },
      { name: 'review', state: 'pending' },
    ])
  })

  it('marks every station done once the run completes', () => {
    const completed = { ...dynamicFrame, status: 'completed' as const, currentPhase: 'review' }
    expect(buildWorkflowSpine(completed, 'journal').every(station => station.state === 'done')).toBe(true)
  })

  it('maps expert phases by node status', () => {
    const expert: ExpertRunProjectionEvent = {
      runId: 'wf_2',
      label: 'Expert',
      status: 'running',
      phases: [
        { phase: 'clarify', status: 'completed' },
        { phase: 'exec', status: 'active' },
      ],
    }
    expect(buildWorkflowSpine(expert, 'expert')).toEqual([
      { name: 'clarify', state: 'done' },
      { name: 'exec', state: 'active' },
    ])
  })
})

describe('action predicates', () => {
  it('admits cancel only for running frames with a job id', () => {
    expect(canCancelRun(dynamicFrame, 'journal')).toBe(false)
    expect(canCancelRun({ ...dynamicFrame, jobId: 'job_1' }, 'journal')).toBe(true)
    expect(canCancelRun({ ...dynamicFrame, status: 'errored', jobId: 'job_1' }, 'journal')).toBe(false)
  })

  it('reads resumable from the host bit alone', () => {
    expect(canResumeRun(dynamicFrame)).toBe(false)
    expect(canResumeRun({ ...dynamicFrame, status: 'stopped', stopReason: 'user', resumable: true })).toBe(true)
    expect(canResumeRun({ ...dynamicFrame, status: 'stopped', stopReason: 'superseded', resumable: true })).toBe(true)
  })
})

describe('truncateEventLine', () => {
  it('cuts long lines at the DOM-safe limit', () => {
    expect(truncateEventLine('short')).toBe('short')
    expect(truncateEventLine('x'.repeat(201))).toHaveLength(201)
  })
})

describe('createThrottledHandler', () => {
  it('coalesces bursts to the latest frame', () => {
    vi.useFakeTimers()
    const seen: number[] = []
    const handler = createThrottledHandler((value: number) => { seen.push(value) }, 100)
    handler(1)
    handler(2)
    handler(3)
    expect(seen).toEqual([1])
    vi.advanceTimersByTime(150)
    expect(seen).toEqual([1, 3])
    vi.useRealTimers()
  })
})

describe('selection store', () => {
  it('publishes the latest selection to subscribers', () => {
    const seen: string[] = []
    const unsubscribe = subscribeSelection(() => {
      seen.push(getSelection()?.runId ?? 'none')
    })
    setSelection({ sessionId: 's1' as never, runId: 'wf_9', label: 'L', family: 'journal', data: dynamicFrame })
    unsubscribe()
    setSelection({ sessionId: 's1' as never, runId: 'wf_10', label: 'L', family: 'journal', data: dynamicFrame })
    expect(seen).toEqual(['wf_9'])
    expect(getSelection()?.runId).toBe('wf_10')
  })
})
