/**
 * 生命周期（lifecycle）单测：断点 resume 的 reconcile、cancel、reopen 超限、
 * seed 边校验（自环/未知端点/重复/成环）、prompt update 跨相位拒绝。
 * 对应迁移蓝图 §5.1 workflow-expert-core "lifecycle"。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowGraphSeed } from '@deepseek-ai/dsh-workflow-runs'
import {
  applyWorkflowGraphSeed,
  applyWorkflowNodePromptUpdates,
  cancelWorkflowSnapshot,
  reconcileWorkflowSnapshotForResume,
  reopenWorkflowGraphNode,
} from '../src/lifecycle.js'
import { makeSnapshot, node, T0 } from './helpers.js'

describe('reconcileWorkflowSnapshotForResume', () => {
  it('只把 active 节点复位为 pending，completed 节点不动（resume 幂等）', () => {
    const snapshot = makeSnapshot({
      graph: {
        edges: [],
        nodes: [
          node('done', { status: 'completed' }),
          node('busy', { phase: 'exec', status: 'active' }),
        ],
      },
    })
    const result = reconcileWorkflowSnapshotForResume(snapshot, { timestamp: T0 })
    expect(result.changed).toBe(true)
    const byId = new Map(result.snapshot.graph.nodes.map(item => [item.id, item]))
    expect(byId.get('done')?.status).toBe('completed')
    expect(byId.get('busy')?.status).toBe('pending')
    expect(result.nodeChanges).toEqual([{ nodeId: 'busy', phase: 'exec', status: 'pending' }])
  })

  it('nodeIds 作用域外不动', () => {
    const snapshot = makeSnapshot({
      graph: {
        edges: [],
        nodes: [node('a', { status: 'active' }), node('b', { status: 'active' })],
      },
    })
    const result = reconcileWorkflowSnapshotForResume(snapshot, {
      nodeIds: ['a'],
      timestamp: T0,
    })
    const byId = new Map(result.snapshot.graph.nodes.map(item => [item.id, item]))
    expect(byId.get('a')?.status).toBe('pending')
    expect(byId.get('b')?.status).toBe('active')
  })

  it('把 active activity 记为 cancelled 并计入 activityIds', () => {
    const snapshot = makeSnapshot({
      graph: { edges: [], nodes: [node('n1', { phase: 'exec', status: 'active' })] },
    })
    snapshot.activities.push({
      activityId: 'act-1',
      inputArtifactPaths: [],
      kind: 'agent_session',
      outputArtifactPaths: [],
      phase: 'exec',
      nodeId: 'n1',
      startedAt: T0,
      status: 'active',
    })
    const result = reconcileWorkflowSnapshotForResume(snapshot, { timestamp: T0 })
    expect(result.activityIds).toEqual(['act-1'])
    expect(result.snapshot.activities[0]?.status).toBe('cancelled')
  })
})

describe('cancelWorkflowSnapshot', () => {
  it('取消 CANCELLABLE（active/pending）集合，终态集合不动，run 置 cancelled', () => {
    const snapshot = makeSnapshot({
      graph: {
        edges: [],
        nodes: [
          node('done', { status: 'completed' }),
          node('busy', { status: 'active' }),
          node('wait', { status: 'pending' }),
        ],
      },
      status: 'running',
    })
    const result = cancelWorkflowSnapshot(snapshot, { timestamp: T0 })
    expect(result.snapshot.status).toBe('cancelled')
    const byId = new Map(result.snapshot.graph.nodes.map(item => [item.id, item]))
    expect(byId.get('done')?.status).toBe('completed')
    expect(byId.get('busy')?.status).toBe('cancelled')
    expect(byId.get('wait')?.status).toBe('cancelled')
  })
})

describe('reopenWorkflowGraphNode', () => {
  it('completed 节点可 reopen 且计数递增；超过 maxReopens 抛错', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [node('n1')] } })
    snapshot.graph.nodes[0]!.status = 'completed'
    const first = reopenWorkflowGraphNode(snapshot, { nodeId: 'n1', timestamp: T0 })
    expect(first.reopenAttempts).toBe(1)
    expect(first.snapshot.graph.nodes[0]?.status).toBe('pending')

    first.snapshot.graph.nodes[0]!.status = 'completed';
    (first.snapshot.graph.nodes[0] as { reopenAttempts?: number }).reopenAttempts = 2
    expect(() =>
      reopenWorkflowGraphNode(first.snapshot, { nodeId: 'n1', timestamp: T0 }),
    ).toThrow(/max=2/)
  })

  it('pending/active 节点不可 reopen', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [node('n1')] } })
    expect(() => reopenWorkflowGraphNode(snapshot, { nodeId: 'n1', timestamp: T0 })).toThrow(
      /Cannot reopen workflow node/,
    )
  })
})

describe('applyWorkflowGraphSeed', () => {
  it('接受合法 seed 并落 pending 节点与边', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [] } })
    const seed: WorkflowGraphSeed = {
      collections: [],
      edges: [],
      nodes: [
        { dependsOn: [], id: 't1', kind: 'task', title: '任务一' },
        { dependsOn: ['t1'], id: 't2', kind: 'task', title: '任务二' },
      ],
    }
    const applied = applyWorkflowGraphSeed(snapshot, seed, { timestamp: T0 })
    expect(applied.changed).toBe(true)
    expect(applied.addedNodes).toHaveLength(2)
    expect(applied.addedEdges).toEqual([{ from: 't1', to: 't2' }])
    expect(applied.snapshot.graph.nodes.every(item => item.status === 'pending')).toBe(true)
  })

  it('拒绝自环边', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [] } })
    const seed: WorkflowGraphSeed = {
      collections: [],
      edges: [{ from: 't1', to: 't1' }],
      nodes: [{ id: 't1', title: '自环', dependsOn: [], kind: 'task' }],
    }
    expect(() => applyWorkflowGraphSeed(snapshot, seed, { timestamp: T0 })).toThrow(
      /self-loop edge/,
    )
  })

  it('拒绝未知端点边', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [] } })
    const seed: WorkflowGraphSeed = {
      collections: [],
      edges: [{ from: 'ghost', to: 't1' }],
      nodes: [{ id: 't1', title: '悬空', dependsOn: [], kind: 'task' }],
    }
    expect(() => applyWorkflowGraphSeed(snapshot, seed, { timestamp: T0 })).toThrow(
      /unknown source node/,
    )
  })

  it('拒绝重复节点', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [] } })
    const seed: WorkflowGraphSeed = {
      collections: [],
      edges: [],
      nodes: [
        { id: 't1', title: '一', dependsOn: [], kind: 'task' },
        { id: 't1', title: '二', dependsOn: [], kind: 'task' },
      ],
    }
    expect(() => applyWorkflowGraphSeed(snapshot, seed, { timestamp: T0 })).toThrow(
      /duplicate node/,
    )
  })

  it('拒绝成环边（BFS wouldFormCycle）', () => {
    const snapshot = makeSnapshot({
      graph: {
        edges: [{ from: 't1', to: 't2' }],
        nodes: [node('t1'), node('t2')],
      },
    })
    const seed: WorkflowGraphSeed = {
      collections: [],
      edges: [{ from: 't2', to: 't1' }],
      nodes: [],
    }
    expect(() => applyWorkflowGraphSeed(snapshot, seed, { timestamp: T0 })).toThrow(
      /would create a cycle/,
    )
  })

  it('collection 引用未知节点抛错', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [] } })
    const seed: WorkflowGraphSeed = {
      collections: [{ collectionId: 'c1', nodeIds: ['ghost'] }],
      edges: [],
      nodes: [{ collectionId: 'c1', id: 't1', title: '一', dependsOn: [], kind: 'task' }],
    }
    expect(() => applyWorkflowGraphSeed(snapshot, seed, { timestamp: T0 })).toThrow(
      /references unknown node/,
    )
  })
})

describe('applyWorkflowNodePromptUpdates', () => {
  it('同相位节点可更新 prompt', () => {
    const snapshot = makeSnapshot({
      graph: { edges: [], nodes: [node('n1', { phase: 'exec', prompt: '旧提示词' })] },
    })
    const result = applyWorkflowNodePromptUpdates(
      snapshot,
      [{ id: 'n1', prompt: '新提示词' }],
      { phase: 'exec', timestamp: T0 },
    )
    expect(result.changed).toBe(true)
    expect(result.snapshot.graph.nodes[0]?.prompt).toBe('新提示词')
  })

  it('跨相位更新被拒绝', () => {
    const snapshot = makeSnapshot({
      graph: { edges: [], nodes: [node('n1', { phase: 'exec', prompt: '旧提示词' })] },
    })
    expect(() =>
      applyWorkflowNodePromptUpdates(snapshot, [{ id: 'n1', prompt: '新提示词' }], {
        phase: 'clarify',
        timestamp: T0,
      }),
    ).toThrow(/targets phase "clarify" but node belongs to "exec"/)
  })

  it('引用未知节点抛错', () => {
    const snapshot = makeSnapshot({ graph: { edges: [], nodes: [] } })
    expect(() =>
      applyWorkflowNodePromptUpdates(snapshot, [{ id: 'ghost', prompt: 'x' }], {
        phase: 'exec',
        timestamp: T0,
      }),
    ).toThrow(/references unknown node/)
  })
})
