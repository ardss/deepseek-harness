/**
 * artifact 播种（seedGraphFromPhaseArtifact 的解析与门控层）单测：
 * 宽容 JSON 解析（围栏/裸数组/蛇形键别名）、gateRootSeedNodes 根节点门控。
 * 对应迁移蓝图 §2.2 graph-artifacts / parsers。
 */
import { describe, expect, it } from 'vitest'
import { gateRootSeedNodes, parseWorkflowGraphSeed } from '../src/expert/parsers/graph-seed.js'

describe('parseWorkflowGraphSeed（宽容 JSON）', () => {
  it('解析 ```json 围栏内的对象', () => {
    const response = [
      '前置说明文字',
      '```json',
      JSON.stringify({
        nodes: [
          { id: 't1', title: '任务一', depends_on: [] },
          { id: 't2', title: '任务二', depends_on: ['t1'] },
        ],
        edges: [{ source: 't1', target: 't2' }],
      }),
      '```',
      '后置文字',
    ].join('\n')
    const seed = parseWorkflowGraphSeed(response, 'exec')
    expect(seed).not.toBeNull()
    expect(seed?.nodes).toHaveLength(2)
    expect(seed?.nodes[1]?.dependsOn).toEqual(['t1'])
    expect(seed?.edges).toEqual([{ from: 't1', to: 't2' }])
    // 默认相位被填入节点 phase。
    expect(seed?.nodes[0]?.phase).toBe('exec')
  })

  it('完全无对象形态的输入（bare 标量数组）返回 null', () => {
    // 源语义：parsePlannerJson 只接受 {} 开头对象与 ```json 围栏；bare 数组
    // 含对象时会被截取出首个对象解析，纯标量数组无法截取而抛错 → null。
    expect(parseWorkflowGraphSeed(JSON.stringify([1, 2, 3]), 'exec')).toBeNull()
  })

  it('蛇形键与别名键被宽容归一（无围栏裸对象）', () => {
    const seed = parseWorkflowGraphSeed(
      JSON.stringify({
        new_nodes: [{ node_name: 't1', summary: '任务一', depends_on: [] }],
        new_edges: [{ source: 't1', target: 't2' }],
      }),
      'exec',
    )
    expect(seed?.nodes[0]?.id).toBe('t1')
    expect(seed?.nodes[0]?.title).toBe('任务一')
    expect(seed?.edges[0]).toEqual({ from: 't1', to: 't2' })
  })

  it('非 JSON 返回 null；无法识别的对象归为空 seed（非 null，由调用方 nodes/collections 双空守卫兜底）', () => {
    expect(parseWorkflowGraphSeed('完全不是 JSON', 'exec')).toBeNull()
    const empty = parseWorkflowGraphSeed(JSON.stringify({ unrelated: true }), 'exec')
    expect(empty).not.toBeNull()
    expect(empty?.nodes).toHaveLength(0)
    expect(empty?.collections).toHaveLength(0)
  })
})

describe('gateRootSeedNodes（gate 根节点门控）', () => {
  it('无入边的根节点被挂到 gate 节点之下', () => {
    const seed = parseWorkflowGraphSeed(
      JSON.stringify({
        nodes: [
          { id: 'root1', title: '根一' },
          { id: 'root2', title: '根二' },
          { id: 'child', title: '子', dependsOn: ['root1'] },
        ],
        edges: [{ from: 'root1', to: 'child' }],
      }),
      'exec',
    )!
    const gated = gateRootSeedNodes(seed, 'phase:arch_decompose')
    const child = gated.nodes.find(item => item.id === 'child')
    const root1 = gated.nodes.find(item => item.id === 'root1')
    expect(root1?.dependsOn).toContain('phase:arch_decompose')
    expect(child?.dependsOn).toEqual(['root1']) // 非根节点不加门控边
    expect(gated.edges).toContainEqual({ from: 'phase:arch_decompose', to: 'root1' })
    expect(gated.edges).toContainEqual({ from: 'phase:arch_decompose', to: 'root2' })
    expect(gated.edges).toContainEqual({ from: 'root1', to: 'child' })
  })

  it('没有根节点时原样返回', () => {
    const seed = parseWorkflowGraphSeed(
      JSON.stringify({
        nodes: [{ id: 'a', title: 'A' }],
        edges: [{ from: 'gate', to: 'a' }],
      }),
      'exec',
    )!
    const gated = gateRootSeedNodes(seed, 'gate')
    expect(gated).toBe(seed)
  })
})
