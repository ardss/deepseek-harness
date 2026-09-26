/**
 * continueRun 端到端级测试（蓝图 §5.1/§5.2 的 expert 面）：
 * 相位流转（agent/seed/prompt-update/scheduled_graph/critic/complete 六种行为）、
 * artifact 播种（arch 响应 JSON 播进 exec DAG 并写图账本）、快照 resume（completed
 * 相位跳过的幂等性）、失败暂停、中止取消、critic 回路（reopen → exec 重跑 → pass、
 * reopen 拒绝、迭代耗尽）。全部走真实 ExpertWorkflowRuntimeContext + 内存 store。
 */
import { describe, expect, it } from 'vitest'
import type { ExpertWorkflowRunSnapshot } from '@deepseek-ai/dsh-workflow-runs'
import { continueRun } from '../src/expert/run-loop.js'
import { ExpertWorkflowRuntimeContext } from '../src/expert/runtime-context.js'
import {
  CRITIC_PASS,
  InMemoryWorkflowStore,
  PROMPT_UPDATE_RESPONSE,
  SEED_RESPONSE,
  ScriptedAgentRunner,
  criticFail,
  monotonicNow,
  testDefinition,
} from './runtime-harness.js'

const CWD = 'C:/tmp/run-loop-test'

interface Rig {
  runner: ScriptedAgentRunner
  store: InMemoryWorkflowStore
  ctx: ExpertWorkflowRuntimeContext
  run(options?: { abortSignal?: AbortSignal; finalCriticMaxIterations?: number }): Promise<
    Awaited<ReturnType<typeof continueRun>>
  >
}

/** 组装一套可驱动的 run 环境：脚本化 runner + 内存 store + 受控定义。 */
function makeRig(options?: { finalCriticMaxIterations?: number }): Rig {
  const runner = new ScriptedAgentRunner()
  const store = new InMemoryWorkflowStore()
  const ctx = new ExpertWorkflowRuntimeContext({
    agentRunner: runner,
    createRunId: () => 'wf_expert_run-loop-test',
    definition: testDefinition(
      options?.finalCriticMaxIterations === undefined
        ? {}
        : { finalCriticMaxIterations: options.finalCriticMaxIterations },
    ),
    now: monotonicNow,
    store,
  })
  const snapshot = ctx.createInitialSnapshot({ cwd: CWD, task: '测试任务' })
  return {
    ctx,
    runner,
    store,
    run: runOptions =>
      continueRun(ctx, snapshot, {
        ...(runOptions?.abortSignal === undefined ? {} : { abortSignal: runOptions.abortSignal }),
        cwd: CWD,
        task: '测试任务',
      }),
  }
}

function seedResponses(rig: Rig, options?: { criticResponses?: unknown[] }): void {
  rig.runner.text('clarify', '澄清完成')
  rig.runner.json('arch', SEED_RESPONSE)
  rig.runner.json('meta', PROMPT_UPDATE_RESPONSE)
  rig.runner.text('exec', 'exec 完成')
  const criticResponses = options?.criticResponses ?? [CRITIC_PASS]
  rig.runner.on('final_critic', (_input, index) => {
    // 取模循环：同一 runner 跨多次 continueRun 复用（resume 场景按序再取一轮）
    return JSON.stringify(criticResponses[index % criticResponses.length])
  })
}

describe('continueRun：相位流转', () => {
  it('六个相位按序流转：每个相位恰好一次 agent 调用，终态 completed 且报告落盘', async () => {
    const rig = makeRig()
    seedResponses(rig)
    const result = await rig.run()

    expect(result.status).toBe('completed')
    // clarify/arch/meta 各一次 agent 调用；exec 相位按 seed 的两个任务节点各一次
    expect(rig.runner.calls.map(call => call.phase)).toEqual([
      'clarify',
      'arch',
      'meta',
      'exec',
      'exec',
      'final_critic',
    ])
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    expect(snapshot.status).toBe('completed')
    expect(snapshot.phases.map(phase => phase.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
      'completed',
    ])
    expect(snapshot.reportPath).toBe('reports/wf_expert_run-loop-test.md')
    // 报告内容在 store 里
    expect(rig.store.fileContent(snapshot.runId, snapshot.reportPath ?? '')).toContain(
      '# Workflow Report',
    )
    // 相位事件齐备且有序
    const events = rig.store.eventsOf(snapshot.runId)
    const startedPhases = events
      .filter(event => event.type === 'phase_started')
      .map(event => event.phase)
    expect(startedPhases).toEqual(['clarify', 'arch', 'meta', 'exec', 'final_critic'])
    expect(events.some(event => event.type === 'run_completed')).toBe(true)
  })

  it('resume 幂等：全 completed 的快照重跑时不调用任何 agent，直接补报告完成', async () => {
    const rig = makeRig()
    seedResponses(rig)
    const first = await rig.run()
    const callsAfterFirst = rig.runner.calls.length
    const phaseStartedAfterFirst = rig.store.eventsOf(
      first.runId ?? '',
      'phase_started',
    ).length

    const second = await continueRun(rig.ctx, first.snapshot as ExpertWorkflowRunSnapshot, {
      cwd: CWD,
      task: '测试任务',
    })
    expect(second.status).toBe('completed')
    expect(rig.runner.calls.length).toBe(callsAfterFirst)
    expect(
      rig.store.eventsOf(second.runId ?? '', 'phase_started').length,
    ).toBe(phaseStartedAfterFirst)
  })

  it('部分完成的快照 resume 时跳过 completed 相位，只跑剩余相位', async () => {
    const rig = makeRig()
    seedResponses(rig)
    const first = await rig.run()
    // 手工构造崩溃残留：meta/exec/final_critic 相位回 pending，completed 相位保留
    const partial = {
      ...(first.snapshot as ExpertWorkflowRunSnapshot),
      phases: (first.snapshot as ExpertWorkflowRunSnapshot).phases.map((phase, index) =>
        index < 2 ? phase : { ...phase, status: 'pending' as const },
      ),
      status: 'running' as const,
    }
    const callsBeforeResume = rig.runner.calls.length
    const second = await continueRun(rig.ctx, partial, { cwd: CWD, task: '测试任务' })
    expect(second.status).toBe('completed')
    // 只补跑 meta、final_critic（clarify/arch 已完成被跳过；exec 相位重入但
    // 节点均已 completed，调度器零 agent 调用直接结算）
    const resumedPhases = rig.runner.calls.slice(callsBeforeResume).map(call => call.phase)
    expect(resumedPhases).toEqual(['meta', 'final_critic'])
    expect(rig.runner.callsFor('exec')).toBe(2)
  })
})

describe('continueRun：失败暂停与中止取消', () => {
  it('相位抛错：run 转 paused、recoveryActions 在场、workflow_paused 事件在案', async () => {
    const rig = makeRig()
    rig.runner.throwing('clarify', new Error('模型超时'))
    const result = await rig.run()
    expect(result.status).toBe('paused')
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    expect(snapshot.pauseReason).toBe('模型超时')
    expect(snapshot.failure?.message).toBe('模型超时')
    expect(snapshot.recoveryActions.length).toBeGreaterThan(0)
    expect(rig.store.eventsOf(snapshot.runId, 'workflow_paused')).toHaveLength(1)
    // 失败相位标记 failed，其余相位保持 pending
    expect(snapshot.phases[0]).toMatchObject({ phase: 'clarify', status: 'failed' })
    expect(result.response).toContain('Paused: 模型超时')
  })

  it('运行中中止：run 修复为 cancelled，节点与相位收口，run_cancelled 事件在案', async () => {
    const rig = makeRig()
    rig.runner.text('clarify', '不会被等到')
    const controller = new AbortController()
    rig.runner.on('clarify', (input) => {
      return new Promise<string>((_resolve, reject) => {
        input.abortSignal?.addEventListener(
          'abort',
          () => reject(input.abortSignal?.reason),
          { once: true },
        )
      })
    })
    const pending = rig.run({ abortSignal: controller.signal })
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort(new Error('用户取消'))
    const result = await pending
    expect(result.status).toBe('cancelled')
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    expect(snapshot.status).toBe('cancelled')
    expect(snapshot.completedAt).toBeDefined()
    expect(rig.store.eventsOf(snapshot.runId, 'run_cancelled')).toHaveLength(1)
    // clarify 相位节点也被收口为 cancelled
    const phaseNode = snapshot.graph.nodes.find(node => node.id === 'phase:clarify')
    expect(phaseNode?.status).toBe('cancelled')
  })
})

describe('continueRun：artifact 播种与节点提示词装配', () => {
  it('arch 响应的 JSON 播进 exec DAG：节点/边/相位归属正确，图账本可回放出最终图', async () => {
    const rig = makeRig()
    seedResponses(rig)
    const result = await rig.run()
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot

    const n1 = snapshot.graph.nodes.find(node => node.id === 'n1')
    const n2 = snapshot.graph.nodes.find(node => node.id === 'n2')
    expect(n1).toMatchObject({ kind: 'task', phase: 'exec', status: 'completed' })
    expect(n2).toMatchObject({ dependsOn: ['n1'], phase: 'exec', status: 'completed' })
    expect(snapshot.graph.edges).toContainEqual({ from: 'n1', to: 'n2' })

    // graph_expanded 事件点名来源相位与目标相位
    const expanded = rig.store.eventsOf(snapshot.runId, 'graph_expanded')
    expect(expanded).toHaveLength(1)
    expect(expanded[0]?.payload).toMatchObject({ sourcePhase: 'arch', targetPhase: 'exec' })

    // JSONL 图账本回放：node 记录 + edge 记录 + graph_seeded op 全在案
    const records = rig.store.graphRecordsOf(snapshot.runId)
    const nodeRecords = records.filter(record => record.recordType === 'node')
    expect(nodeRecords.map(record => (record.node as { id: string }).id)).toEqual(
      expect.arrayContaining(['n1', 'n2']),
    )
    expect(
      records.some(
        record =>
          record.recordType === 'edge' &&
          (record.edge as { from: string; to: string }).from === 'n1',
      ),
    ).toBe(true)
    expect(
      records.some(record => (record as { type?: string }).type === 'graph_seeded'),
    ).toBe(true)

    // 播种来源工件本身也落了盘（arch 相位工件含 JSON）
    expect(rig.store.fileContent(snapshot.runId, 'artifacts/03-arch.md')).toContain('"n1"')
  })

  it('meta 响应的提示词更新写进 exec 节点并发出 graph_updated；调度提示词携带节点提示词', async () => {
    const rig = makeRig()
    seedResponses(rig)
    const result = await rig.run()
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    expect(snapshot.graph.nodes.find(node => node.id === 'n1')?.prompt).toBe('PROMPT-N1')
    expect(rig.store.eventsOf(snapshot.runId, 'graph_updated')).toHaveLength(1)
    // 调度期的节点提示词确实带上了更新后的节点提示词（提示词装配链贯通）
    const execCalls = rig.runner.calls.filter(call => call.phase === 'exec')
    expect(execCalls.some(call => call.prompt.includes('PROMPT-N1'))).toBe(true)
    // 无提示词的节点走默认装配
    expect(execCalls.some(call => call.prompt.includes('Node: Node Two'))).toBe(true)
  })

  it('arch 响应没有可解析的 JSON 时按无 seed 处理：不扩图不报错，run 照常完成', async () => {
    const rig = makeRig()
    rig.runner.text('clarify', '澄清完成')
    rig.runner.text('arch', '这轮没有结构化输出')
    rig.runner.json('meta', { nodes: [] })
    rig.runner.text('exec', 'exec 完成')
    rig.runner.json('final_critic', CRITIC_PASS)
    const result = await rig.run()
    expect(result.status).toBe('completed')
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    expect(rig.store.eventsOf(snapshot.runId, 'graph_expanded')).toHaveLength(0)
    // 无 seed 时 exec 相位只有相位节点本身可执行
    expect(rig.runner.callsFor('exec')).toBe(1)
  })
})

describe('continueRun：final critic 回路', () => {
  it('fail + reopen → exec 节点重跑 → 第二轮 pass → run 完成', async () => {
    const rig = makeRig()
    seedResponses(rig, {
      criticResponses: [criticFail([{ nodeId: 'n1', reason: '回归了' }]), CRITIC_PASS],
    })
    const result = await rig.run()
    expect(result.status).toBe('completed')
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    const events = rig.store.eventsOf(snapshot.runId)
    // n1 重跑（exec 两次调度调用），n2 只跑一次
    expect(rig.runner.callsFor('exec')).toBe(3) // n1 + n2 + n1 重跑
    expect(events.some(event => event.type === 'node_reopened')).toBe(true)
    expect(events.filter(event => event.type === 'critic_failed').length).toBeGreaterThanOrEqual(1)
    expect(events.some(event => event.type === 'critic_passed')).toBe(true)
    const reopened = events.find(event => event.type === 'node_reopened')
    expect(reopened?.nodeId).toBe('n1')
    // 重开后 exec 相位被复位又再次完成
    expect(snapshot.phases.find(phase => phase.phase === 'exec')?.status).toBe('completed')
  })

  it('reopen 引用未知节点被拒绝（rejected 事件在案），节点不被重开，run 照常完成', async () => {
    const rig = makeRig()
    seedResponses(rig, {
      criticResponses: [criticFail([{ nodeId: 'ghost', reason: '不存在' }]), CRITIC_PASS],
    })
    const result = await rig.run()
    expect(result.status).toBe('completed')
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    const rejected = rig.store
      .eventsOf(snapshot.runId, 'critic_failed')
      .find(event => (event.payload as { rejected?: boolean })?.rejected === true)
    expect(rejected).toBeDefined()
    expect((rejected?.payload as { nodeId?: string }).nodeId).toBe('ghost')
    // n1 没被重开：exec 只有首轮 n1+n2 两次调用
    expect(rig.runner.callsFor('exec')).toBe(2)
  })

  it('迭代耗尽：final_critic 相位置 failed 并发出 critic_iteration_limit_reached', async () => {
    const rig = makeRig({ finalCriticMaxIterations: 1 })
    seedResponses(rig, {
      criticResponses: [criticFail([{ nodeId: 'n1', reason: '永远不过' }])],
    })
    const result = await rig.run()
    const snapshot = result.snapshot as ExpertWorkflowRunSnapshot
    expect(snapshot.phases.find(phase => phase.phase === 'final_critic')?.status).toBe(
      'failed',
    )
    const limit = rig.store.eventsOf(snapshot.runId, 'critic_iteration_limit_reached')
    expect(limit).toHaveLength(1)
    expect(limit[0]?.payload).toMatchObject({ maxIterations: 1 })
    // 相位失败后 continueRun 仍走完 complete 相位：run 终态由 complete 收口
    expect(result.status).toBe('completed')
    expect(rig.runner.callsFor('final_critic')).toBe(1)
  })
})
