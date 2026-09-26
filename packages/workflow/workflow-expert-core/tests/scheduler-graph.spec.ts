/**
 * DAG 调度纯函数（scheduler/graph）单测：ready 判定、failed 也解除阻塞、
 * orderedReadyExecutableNodes 的非探索节点前置 + collection 间轮转、完成判定。
 * 对应迁移蓝图 §5.1 workflow-expert-core "scheduler"。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowGraph } from '@deepseek-ai/dsh-workflow-runs'
import {
  areExecutableNodesComplete,
  blockedExecutableNodes,
  orderedReadyExecutableNodes,
  readyExecutableNodes,
} from '../src/scheduler/graph.js'
import { node } from './helpers.js'

const ALL = (graph: { nodes: Array<{ id: string }> }) =>
  new Set(graph.nodes.map(item => item.id))

describe('readyExecutableNodes / blockedExecutableNodes', () => {
  it('pending 且无未终态依赖才 ready', () => {
    const graph = {
      collections: [],
      edges: [{ from: 'a', to: 'b' }],
      nodes: [node('a'), node('b'), node('c', { status: 'completed' })],
    }
    const ready = readyExecutableNodes(graph, ALL(graph)).map(item => item.id)
    expect(ready).toEqual(['a'])
    expect(blockedExecutableNodes(graph, ALL(graph))).toEqual([
      { blockedBy: ['a'], nodeId: 'b' },
    ])
  })

  it('failed 也解除阻塞（蓝图：failed 也解除阻塞）', () => {
    const graph = {
      collections: [],
      edges: [{ from: 'a', to: 'b' }],
      nodes: [node('a', { status: 'failed' }), node('b')],
    }
    const ready = readyExecutableNodes(graph, ALL(graph)).map(item => item.id)
    expect(ready).toEqual(['b'])
  })

  it('active 依赖不解除阻塞', () => {
    const graph = {
      collections: [],
      edges: [{ from: 'a', to: 'b' }],
      nodes: [node('a', { status: 'active' }), node('b')],
    }
    expect(readyExecutableNodes(graph, ALL(graph))).toEqual([])
  })
})

describe('orderedReadyExecutableNodes', () => {
  it('非探索（engineering）节点排在探索节点之前', () => {
    const graph = {
      collections: [
        {
          collectionId: 'c1',
          explorable: true,
          nodeIds: ['e1'],
        },
      ],
      edges: [],
      nodes: [node('e1', { collectionId: 'c1' }), node('eng1')],
    }
    const ordered = orderedReadyExecutableNodes(graph, ALL(graph)).map(item => item.id)
    expect(ordered).toEqual(['eng1', 'e1'])
  })

  it('探索节点在多个 collection 间轮转', () => {
    const graph = {
      collections: [
        { collectionId: 'c1', explorable: true, nodeIds: ['c1a', 'c1b', 'c1c'] },
        { collectionId: 'c2', explorable: true, nodeIds: ['c2a', 'c2b'] },
      ],
      edges: [],
      nodes: [
        node('c1a', { collectionId: 'c1' }),
        node('c1b', { collectionId: 'c1' }),
        node('c1c', { collectionId: 'c1' }),
        node('c2a', { collectionId: 'c2' }),
        node('c2b', { collectionId: 'c2' }),
      ],
    }
    const ordered = orderedReadyExecutableNodes(graph, ALL(graph)).map(item => item.id)
    expect(ordered).toEqual(['c1a', 'c2a', 'c1b', 'c2b', 'c1c'])
  })

  it('exhausted collection 的节点不再参与探索轮转', () => {
    const graph: WorkflowGraph = {
      collections: [
        { collectionId: 'c1', explorable: true, nodeIds: ['x1'], status: 'exhausted' },
      ],
      edges: [],
      nodes: [node('x1', { collectionId: 'c1' })],
    }
    const ordered = orderedReadyExecutableNodes(graph, ALL(graph)).map(item => item.id)
    // exhausted 后节点退化为 engineering 段（仍 ready，只是不再被探索机制前插）。
    expect(ordered).toEqual(['x1'])
  })
})

describe('areExecutableNodesComplete', () => {
  it('completed/cancelled/skipped 算完成；failed 不算完成（源语义：COMPLETED_NODE_STATUSES 不含 failed）', () => {
    const graph = {
      collections: [],
      edges: [],
      nodes: [node('a', { status: 'completed' }), node('b', { status: 'cancelled' })],
    }
    expect(areExecutableNodesComplete(graph, ALL(graph), false)).toBe(true)
    graph.nodes[1]!.status = 'failed'
    expect(areExecutableNodesComplete(graph, ALL(graph), false)).toBe(false)
    graph.nodes[1]!.status = 'skipped'
    expect(areExecutableNodesComplete(graph, ALL(graph), false)).toBe(true)
  })

  it('存在 pending 时空集不含 pending 即完成', () => {
    const graph = { collections: [], edges: [], nodes: [node('a'), node('b')] }
    expect(areExecutableNodesComplete(graph, new Set(['a']), false)).toBe(false)
  })

  it('waitsForCollections 时要求 explorable collection 均 exhausted', () => {
    const graph: WorkflowGraph = {
      collections: [
        { collectionId: 'c1', explorable: true, nodeIds: ['a'] },
        { collectionId: 'c2', explorable: true, nodeIds: ['a'], status: 'exhausted' },
      ],
      edges: [],
      nodes: [node('a', { status: 'completed' })],
    }
    expect(areExecutableNodesComplete(graph, ALL(graph), true)).toBe(false)
    graph.collections![0]!.status = 'exhausted'
    expect(areExecutableNodesComplete(graph, ALL(graph), true)).toBe(true)
  })
})
