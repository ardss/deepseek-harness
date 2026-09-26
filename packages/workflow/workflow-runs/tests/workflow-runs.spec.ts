/**
 * workflow-runs 词汇包单测：dynamic 词汇的 resume 判定、expert 词汇 schema 的
 * 基本校验与 scheduler 派生函数。
 */
import { describe, expect, it } from 'vitest'
import {
  WorkflowDefinitionSchema,
  WorkflowRunSnapshotSchema,
  deriveWorkflowSchedulerState,
  isDynamicRunResumable,
} from '../src/index.js'

describe('dynamic 词汇', () => {
  it('stopped 且非 superseded 可 resume', () => {
    expect(isDynamicRunResumable('stopped', 'user')).toBe(true)
    expect(isDynamicRunResumable('stopped', 'provider')).toBe(true)
    expect(isDynamicRunResumable('stopped', 'superseded')).toBe(false)
    expect(isDynamicRunResumable('stopped')).toBe(true)
    expect(isDynamicRunResumable('completed')).toBe(false)
    expect(isDynamicRunResumable('errored')).toBe(false)
  })
})

describe('expert 词汇', () => {
  it('run 状态只接受六值词汇', () => {
    expect(
      WorkflowRunSnapshotSchema.shape.status.safeParse('paused').success,
    ).toBe(true)
    expect(WorkflowRunSnapshotSchema.shape.status.safeParse('killed').success).toBe(false)
  })

  it('deriveWorkflowSchedulerState 归纳 ready/blocked/终态', () => {
    const state = deriveWorkflowSchedulerState({
      collections: [],
      edges: [{ from: 'a', to: 'b' }],
      nodes: [
        {
          dependsOn: [],
          id: 'a',
          kind: 'task',
          status: 'completed',
          title: 'A',
        },
        { dependsOn: [], id: 'b', kind: 'task', status: 'pending', title: 'B' },
      ],
    })
    expect(state.readyNodeIds).toEqual(['b'])
    expect(state.counts).toMatchObject({ completed: 1, pending: 1, ready: 1, total: 2 })
  })

  it('workflow 定义 schema 与快照 schema 均可独立使用', () => {
    expect(WorkflowDefinitionSchema.shape.kind.safeParse('expert').success).toBe(true)
  })
})
