/**
 * artifact 播种与快照 resume 的深度集成测试（补充 run-loop.spec / lifecycle.spec 的缺口）：
 * - 播种响应带环：run 暂停而非静默忽略（applyWorkflowGraphSeed 的 wouldFormCycle 冒泡到 run-loop）；
 * - exec 中途熔断崩溃：快照留在 store，resume 后已完成相位零重跑、已完成节点零重跑；
 * - failed 节点让裸 resume 死锁，prepareSnapshotForRetry 才能把 failed 拉回 pending；
 * - 图账本（JSONL 形态的 graphRecords）从零回放出最终图：节点/边/终态与最终快照逐项一致。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowDefinition, WorkflowGraphRecord } from '@deepseek-ai/dsh-workflow-runs'
import { WorkflowDefinitionSchema } from '@deepseek-ai/dsh-workflow-runs'
import { continueRun } from '../src/expert/run-loop.js'
import { ExpertWorkflowRuntimeContext } from '../src/expert/runtime-context.js'
import { prepareSnapshotForRetry } from '../src/expert/retry-state.js'
import {
  CRITIC_PASS,
  InMemoryWorkflowStore,
  ScriptedAgentRunner,
  monotonicNow,
  testDefinition,
} from './runtime-harness.js'

const CWD = 'C:/tmp/seed-resume-test'

const CYCLE_SEED = {
  edges: [
    { from: 'a', to: 'b' },
    { from: 'b', to: 'a' },
  ],
  nodes: [{ id: 'a', title: 'A' }, { dependsOn: [], id: 'b', title: 'B' }],
  reasoning: '带环的坏分解',
}

function makeRig(definition?: WorkflowDefinition): {
  ctx: ExpertWorkflowRuntimeContext
  runner: ScriptedAgentRunner
  store: InMemoryWorkflowStore
} {
  const runner = new ScriptedAgentRunner()
  const store = new InMemoryWorkflowStore()
  const ctx = new ExpertWorkflowRuntimeContext({
    agentRunner: runner,
    createRunId: () => 'wf_expert_seed-resume',
    definition: definition ?? testDefinition(),
    now: monotonicNow,
    store,
  })
  return { ctx, runner, store }
}

/** exec 节点按提示词里的 Node id 分流应答（scheduled-phase 把节点折叠进 phase 调用）。 */
function scriptExecByNode(
  runner: ScriptedAgentRunner,
  behavior: Record<string, 'ok' | 'fail'>,
): void {
  runner.on('exec', (input) => {
    const nodeId = Object.keys(behavior).find(id => input.prompt.includes(`Node id: ${id}`))
    if (nodeId !== undefined && behavior[nodeId] === 'fail') {
      throw new Error(`node ${nodeId} exploded`)
    }
    return `ok of ${nodeId ?? 'unknown'}`
  })
}

/** 单飞策略：串行执行 + 连续 1 错即熔断（用于制造确定性的中途崩溃快照）。 */
function strictDefinition(): WorkflowDefinition {
  const base = testDefinition() as WorkflowDefinition
  return WorkflowDefinitionSchema.parse({
    ...base,
    strategy: {
      ...base.strategy,
      executor: { ...base.strategy.executor, maxConsecutiveErrors: 1, maxConcurrentLoops: 1 },
    },
  })
}

describe('artifact 播种：坏 seed 暂停 run', () => {
  it('arch 响应的 seed 带环时：run 转 paused 且 workflow_paused 在案，exec 从未启动', async () => {
    const { ctx, runner, store } = makeRig()
    runner.text('clarify', '澄清完成')
    runner.json('arch', CYCLE_SEED)
    const snapshot = ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const result = await continueRun(ctx, snapshot, { cwd: CWD, task: '任务' })

    expect(result.status).toBe('paused')
    const paused = result.snapshot!
    expect(paused.status).toBe('paused')
    expect(paused.failure).toBeDefined()
    expect(JSON.stringify(paused.failure)).toContain('cycle')
    expect(paused.recoveryActions.length).toBeGreaterThan(0)
    // arch 的 agent 相位已正常完成（失败发生在其后的播种阶段）
    expect(paused.phases.find(phase => phase.phase === 'arch')?.status).toBe('completed')
    // exec 相位从未启动
    expect(store.eventsOf(paused.runId, 'phase_started').map(event => event.phase)).toEqual([
      'clarify',
      'arch',
    ])
    expect(store.eventsOf(paused.runId, 'workflow_paused')).toHaveLength(1)
    // 坏 seed 未污染图：exec 仍无任务节点
    expect(
      paused.graph.nodes.filter(node => node.kind === 'task'),
    ).toEqual([])
  })
})

describe('快照 resume：exec 中途熔断后的续跑', () => {
  it('已完成相位与已完成节点在 resume 时零重跑；failed 节点需 retry 才能回到可执行状态', async () => {
    const { ctx, runner, store } = makeRig(strictDefinition())
    runner.text('clarify', '澄清完成')
    runner.json('arch', {
      edges: [{ from: 'n1', to: 'n2' }],
      nodes: [
        { id: 'n1', title: 'Node One' },
        { dependsOn: ['n1'], id: 'n2', title: 'Node Two' },
      ],
    })
    runner.json('meta', { nodes: [] })
    scriptExecByNode(runner, { n1: 'fail', n2: 'ok' })
    runner.json('final_critic', CRITIC_PASS)

    // 第一次：n1 先跑即失败（attempts 1 >= max 1 → failed），熔断 → run paused
    const initial = ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const first = await continueRun(ctx, initial, { cwd: CWD, task: '任务' })
    expect(first.status).toBe('paused')
    const afterCrash = store.snapshots.get('wf_expert_seed-resume')
    expect(afterCrash?.status).toBe('paused')
    const n1AfterCrash = afterCrash?.graph.nodes.find(node => node.id === 'n1')
    expect(n1AfterCrash?.status).toBe('failed')
    // clarify/arch/meta 三个相位已完成并落盘
    for (const phase of ['clarify', 'arch', 'meta']) {
      expect(afterCrash?.phases.find(entry => entry.phase === phase)?.status).toBe('completed')
    }
    const execCallsAfterFirst = runner.callsFor('exec')
    expect(execCallsAfterFirst).toBe(1)

    // 第二次：裸 resume——n2 可以跑，n1 failed 不可执行 → 死锁暂停（不重跑已完成相位）
    const fromStore = (await ctx.store.readRun('wf_expert_seed-resume'))!
    const second = await continueRun(ctx, fromStore, { cwd: CWD, task: '任务' })
    expect(second.status).toBe('paused')
    expect(runner.callsFor('clarify')).toBe(1)
    expect(runner.callsFor('arch')).toBe(1)
    expect(runner.callsFor('meta')).toBe(1)
    expect(runner.callsFor('exec')).toBe(2) // 只有 n2 新跑了一次
    const n2 = second.snapshot!.graph.nodes.find(node => node.id === 'n2')
    expect(n2?.status).toBe('completed')
    expect(second.snapshot!.graph.nodes.find(node => node.id === 'n1')?.status).toBe('failed')

    // 第三次：retry 把 exec 相位里 failed 的 n1 拉回 pending，随后整程完成。
    // 注意（实现语义的陷阱，实测确认）：只传 { phase } 时，failure.nodeId（此处指向 n2）
    // 会盖过相位推导出的作用域，导致 n1 不被复位——必须显式传 nodeId。
    const phaseOnly = prepareSnapshotForRetry(ctx, second.snapshot!, { phase: 'exec' })
    expect(phaseOnly.nodeChanges).toEqual([]) // 作用域被 failure.nodeId=n2 劫持：n1 仍在
    expect(
      phaseOnly.snapshot.phases.find(phase => phase.phase === 'exec')?.status,
    ).toBe('pending')
    const prepared = prepareSnapshotForRetry(ctx, second.snapshot!, { nodeId: 'n1' })
    expect(prepared.snapshot.status).toBe('running')
    expect(prepared.snapshot.phases.find(phase => phase.phase === 'exec')?.status).toBe(
      'pending',
    )
    const n1Prepared = prepared.snapshot.graph.nodes.find(node => node.id === 'n1')
    expect(n1Prepared?.status).toBe('pending')
    scriptExecByNode(runner, { n1: 'ok', n2: 'ok' })
    const third = await continueRun(ctx, prepared.snapshot, { cwd: CWD, task: '任务' })
    expect(third.status).toBe('completed')
    expect(runner.callsFor('clarify')).toBe(1)
    expect(runner.callsFor('arch')).toBe(1)
    expect(runner.callsFor('meta')).toBe(1)
    expect(runner.callsFor('exec')).toBe(3) // n1 补跑一次
    expect(runner.callsFor('final_critic')).toBe(1)
    const n1Final = third.snapshot!.graph.nodes.find(node => node.id === 'n1')
    const n2Final = third.snapshot!.graph.nodes.find(node => node.id === 'n2')
    expect(n1Final?.status).toBe('completed')
    expect(n2Final?.status).toBe('completed')
    expect(third.snapshot!.reportPath).toBe('reports/wf_expert_seed-resume.md')
    expect(store.fileContent('wf_expert_seed-resume', 'reports/wf_expert_seed-resume.md')).toContain(
      '# Workflow Report',
    )
  })
})

describe('图账本回放', () => {
  /** 把 graphRecords（JSONL 账本的内存形态）按序应用到空图上，重放出最终图。 */
  function replayGraph(records: WorkflowGraphRecord[]): {
    edges: Array<{ from: string; to: string }>
    nodes: Array<{ id: string; status: string }>
  } {
    const nodes = new Map<string, { id: string; status: string }>()
    const edges: Array<{ from: string; to: string }> = []
    const edgeSeen = new Set<string>()
    for (const record of records) {
      switch (record.recordType) {
        case 'node': {
          nodes.set(record.node.id, { id: record.node.id, status: record.node.status })
          break
        }
        case 'edge': {
          const id = `${record.edge.from}->${record.edge.to}`
          if (!edgeSeen.has(id)) {
            edgeSeen.add(id)
            edges.push({ from: record.edge.from, to: record.edge.to })
          }
          break
        }
        case 'collection':
          break
        case 'op': {
          if (record.type === 'update_status' && record.status !== undefined) {
            const node = nodes.get(record.nodeId ?? '')
            if (node) node.status = record.status
          }
          break
        }
        default:
          break
      }
    }
    return { edges, nodes: [...nodes.values()] }
  }

  it('从账本空图重放出的节点/边/终态与最终快照的图逐项一致', async () => {
    const { ctx, runner, store } = makeRig()
    runner.text('clarify', '澄清完成')
    runner.json('arch', {
      edges: [{ from: 'n1', to: 'n2' }],
      nodes: [
        { id: 'n1', title: 'Node One' },
        { dependsOn: ['n1'], id: 'n2', title: 'Node Two' },
      ],
    })
    runner.json('meta', { nodes: [] })
    scriptExecByNode(runner, { n1: 'ok', n2: 'ok' })
    runner.json('final_critic', CRITIC_PASS)

    const initial = ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    // 图账本由 runtime 装配层播种（writeInitialGraph 写 meta/初始 node/edge 记录）
    await ctx.writeInitialGraph(initial)
    const result = await continueRun(ctx, initial, { cwd: CWD, task: '任务' })
    expect(result.status).toBe('completed')
    const final = result.snapshot!

    const replayed = replayGraph(store.graphRecordsOf(final.runId))
    const expectedNodes = final.graph.nodes.map(node => ({
      id: node.id,
      status: node.status,
    }))
    expect(replayed.nodes).toEqual(expectedNodes)
    const expectedEdges = final.graph.edges.map(edge => ({ from: edge.from, to: edge.to }))
    expect(replayed.edges).toEqual(expectedEdges)
    // 账本里确实有播种产生的任务节点与 meta→node 的链路
    expect(replayed.nodes.map(node => node.id)).toContain('n1')
    expect(replayed.edges).toContainEqual({ from: 'n1', to: 'n2' })
  })
})
