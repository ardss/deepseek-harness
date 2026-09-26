/**
 * 相位流转深测（补充 run-loop.spec 未覆盖的机器面）：
 * - createInitialSnapshot 的初始图形态（phase:{id} 节点 + 链式边）；
 * - 相位 agent 的 onChildSessionStarted 回写（sessionId/turnId/model 进快照与事件）；
 * - 相位失败时 activity/图/事件的收口细节；
 * - prepareSnapshotForRetry 的三种种作用域（phase / nodeId / activityId）与终态字段清理；
 * - ids.ts 的铸造规则（safeArtifactName / safeRunIdSegment / phaseNodeId / isTerminalStatus）。
 */
import { describe, expect, it } from 'vitest'
import { continueRun } from '../src/expert/run-loop.js'
import { ExpertWorkflowRuntimeContext } from '../src/expert/runtime-context.js'
import { prepareSnapshotForRetry } from '../src/expert/retry-state.js'
import {
  isTerminalStatus,
  phaseNodeId,
  safeArtifactName,
  safeRunIdSegment,
} from '../src/expert/ids.js'
import {
  CRITIC_PASS,
  InMemoryWorkflowStore,
  PROMPT_UPDATE_RESPONSE,
  SEED_RESPONSE,
  ScriptedAgentRunner,
  monotonicNow,
  testDefinition,
} from './runtime-harness.js'
import type {
  ExpertWorkflowAgentRunInput,
  ExpertWorkflowAgentRunResult,
} from '../src/expert/types.js'

const CWD = 'C:/tmp/phase-deep-test'

function makeRig(): {
  ctx: ExpertWorkflowRuntimeContext
  runner: ScriptedAgentRunner
  store: InMemoryWorkflowStore
} {
  const runner = new ScriptedAgentRunner()
  const store = new InMemoryWorkflowStore()
  const ctx = new ExpertWorkflowRuntimeContext({
    agentRunner: runner,
    createRunId: () => 'wf_expert_phase-deep',
    definition: testDefinition(),
    now: monotonicNow,
    store,
  })
  return { ctx, runner, store }
}

function happyResponses(runner: ScriptedAgentRunner): void {
  runner.text('clarify', '澄清完成')
  runner.json('arch', SEED_RESPONSE)
  runner.json('meta', PROMPT_UPDATE_RESPONSE)
  runner.text('exec', 'exec 完成')
  runner.json('final_critic', CRITIC_PASS)
}

describe('createInitialSnapshot：初始图形态', () => {
  it('快照 pending，每个相位恰有一个 kind=phase 的节点且按 phaseOrder 链式依赖', () => {
    const { ctx } = makeRig()
    const snapshot = ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    expect(snapshot.status).toBe('pending')
    expect(snapshot.phases.map(phase => phase.phase)).toEqual([
      'clarify',
      'arch',
      'meta',
      'exec',
      'final_critic',
      'complete',
    ])
    expect(snapshot.phases.every(phase => phase.status === 'pending')).toBe(true)
    expect(snapshot.graph.nodes.map(node => node.id)).toEqual([
      'phase:clarify',
      'phase:arch',
      'phase:meta',
      'phase:exec',
      'phase:final_critic',
      'phase:complete',
    ])
    expect(snapshot.graph.nodes.every(node => node.kind === 'phase')).toBe(true)
    // 链式边：i-1 → i，与节点 dependsOn 一致
    expect(snapshot.graph.edges).toEqual([
      { from: 'phase:clarify', to: 'phase:arch' },
      { from: 'phase:arch', to: 'phase:meta' },
      { from: 'phase:meta', to: 'phase:exec' },
      { from: 'phase:exec', to: 'phase:final_critic' },
      { from: 'phase:final_critic', to: 'phase:complete' },
    ])
    snapshot.graph.nodes.forEach((node, index) => {
      if (index === 0) {
        expect(node.dependsOn).toEqual([])
      } else {
        expect(node.dependsOn).toEqual([snapshot.graph.nodes[index - 1]?.id])
      }
    })
    expect(snapshot.graph.collections).toEqual([])
  })
})

describe('相位流转：onChildSessionStarted 回写', () => {
  it('子会话启动事件把 sessionId/turnId/model 写进相位、activity 与 workflow_session_linked 事件', async () => {
    const { runner, store } = makeRig()
    happyResponses(runner)
    // 包装 runner：clarify 相位调用时先发 child session 事件
    const inner = runner.run.bind(runner)
    const wrappingRunner = {
      run: async (input: ExpertWorkflowAgentRunInput): Promise<ExpertWorkflowAgentRunResult> => {
        if (input.phase === 'clarify' && input.onChildSessionStarted) {
          await input.onChildSessionStarted({
            sessionId: 'child-clarify-1',
            turnId: 'turn-9',
            model: 'test-model-x',
            traceId: 'trace-1',
          })
        }
        return await inner(input)
      },
    }
    const ctx2 = new ExpertWorkflowRuntimeContext({
      agentRunner: wrappingRunner,
      createRunId: () => 'wf_expert_phase-deep',
      definition: testDefinition(),
      now: monotonicNow,
      store,
    })
    const snapshot = ctx2.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const result = await continueRun(ctx2, snapshot, { cwd: CWD, task: '任务' })
    expect(result.status).toBe('completed')
    const final = result.snapshot!
    // 最终相位上的 sessionId 以 agent 结果为准（完成时会覆写）；turnId 同理被结果里的
    // undefined 抹掉——子会话事件的事实留痕只看 workflow_session_linked 事件与 activity.model
    const clarify = final.phases.find(phase => phase.phase === 'clarify')
    expect(clarify?.sessionId).toBe('session-clarify-0')
    // 完成时的 activity 是重建对象：sessionId/model/turnId 以 agent 结果为准（未提供即缺席）；
    // 子会话事件的事实留痕只在 workflow_session_linked 事件载荷里
    const activity = final.activities.find(
      entry => entry.phase === 'clarify' && entry.status === 'completed',
    )
    expect(activity?.sessionId).toBe('session-clarify-0')
    const linked = store.eventsOf(final.runId, 'workflow_session_linked')
    expect(linked.length).toBeGreaterThanOrEqual(1)
    expect(linked[0]?.phase).toBe('clarify')
    expect(linked[0]?.payload).toMatchObject({
      activityId: expect.any(String),
      sessionId: 'child-clarify-1',
      model: 'test-model-x',
      turnId: 'turn-9',
    })
    // sessionLinks 由最终 activity 派生（completion 覆写后随 result.sessionId）
    expect(
      final.sessionLinks.some(link => link.sessionId === 'session-clarify-0'),
    ).toBe(true)
  })
})

describe('相位流转：相位失败收口', () => {
  it('clarify 抛错：phase_failed 事件、activity failed 带 error、run paused 带 failure 与 recoveryActions', async () => {
    const { ctx, runner, store } = makeRig()
    runner.throwing('clarify', new Error('model quota exhausted'))
    const snapshot = ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const result = await continueRun(ctx, snapshot, { cwd: CWD, task: '任务' })
    expect(result.status).toBe('paused')
    const paused = result.snapshot!
    expect(paused.status).toBe('paused')
    expect(paused.pauseReason).toContain('model quota exhausted')
    expect(paused.failure).toBeDefined()
    expect(paused.failure?.message).toContain('model quota exhausted')
    expect(paused.recoveryActions.length).toBeGreaterThan(0)
    const clarifyPhase = paused.phases.find(phase => phase.phase === 'clarify')
    expect(clarifyPhase?.status).toBe('failed')
    expect(clarifyPhase?.error).toContain('model quota exhausted')
    const activity = paused.activities.find(entry => entry.phase === 'clarify')
    expect(activity?.status).toBe('failed')
    expect(activity?.error).toContain('model quota exhausted')
    // 图上的相位节点也置 failed（图账本 op 记录在案）
    const phaseNode = paused.graph.nodes.find(node => node.id === phaseNodeId('clarify'))
    expect(phaseNode?.status).toBe('failed')
    expect(store.eventsOf(paused.runId, 'phase_failed')).toHaveLength(1)
    const pausedEvents = store.eventsOf(paused.runId, 'workflow_paused')
    expect(pausedEvents).toHaveLength(1)
    expect(pausedEvents[0]?.phase).toBe('clarify')
  })
})

describe('prepareSnapshotForRetry：重试作用域', () => {
  async function pausedSnapshot(): Promise<{
    ctx: ExpertWorkflowRuntimeContext
    runner: ScriptedAgentRunner
    store: InMemoryWorkflowStore
    snapshot: NonNullable<Awaited<ReturnType<typeof continueRun>>['snapshot']>
  }> {
    const rig = makeRig()
    rig.runner.throwing('clarify', new Error('transient boom'))
    const initial = rig.ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const result = await continueRun(rig.ctx, initial, { cwd: CWD, task: '任务' })
    return { ...rig, snapshot: result.snapshot! }
  }

  it('按 phase 作用域：失败相位复位 pending、终态字段清理、run 转 running；重跑后整程完成', async () => {
    const rig = await pausedSnapshot()
    const prepared = prepareSnapshotForRetry(rig.ctx, rig.snapshot, { phase: 'clarify' })
    expect(prepared.snapshot.status).toBe('running')
    expect(prepared.snapshot.failure).toBeUndefined()
    expect(prepared.snapshot.pauseReason).toBeUndefined()
    expect(prepared.snapshot.recoveryActions).toEqual([])
    expect(prepared.snapshot.phases.find(phase => phase.phase === 'clarify')?.status).toBe(
      'pending',
    )
    // nodeChanges 恰含 clarify 相位节点，且去重后无重复
    const changeIds = prepared.nodeChanges.map(change => change.nodeId)
    expect(new Set(changeIds).size).toBe(changeIds.length)
    expect(changeIds).toContain(phaseNodeId('clarify'))
    // 续跑：clarify 重新执行，整程完成
    rig.runner.text('clarify', '第二次澄清成功')
    happyResponses(rig.runner)
    const retried = await continueRun(rig.ctx, prepared.snapshot, { cwd: CWD, task: '任务' })
    expect(retried.status).toBe('completed')
    expect(retried.snapshot!.phases.every(phase => phase.status === 'completed')).toBe(true)
  })

  it('nodeId 作用域只动指定节点，其余 failed 节点保持原状', () => {
    // 直接构造：让 runner 对 clarify 之外也失败产生多相位失败不可行，退而用最小快照断言作用域隔离
    const rig = makeRig()
    const snapshot = rig.ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const withFailures = {
      ...snapshot,
      status: 'paused' as const,
      failure: {
        kind: 'unknown' as const,
        message: 'x',
        recoverable: true,
        retryable: true,
      },
      pauseReason: 'x',
      recoveryActions: [{ action: 'retry' as const, label: 'retry' }],
      graph: {
        ...snapshot.graph,
        nodes: snapshot.graph.nodes.map(node =>
          node.id === phaseNodeId('clarify') || node.id === phaseNodeId('arch')
            ? { ...node, status: 'failed' as const, error: 'x' }
            : node,
        ),
      },
      phases: snapshot.phases.map(phase =>
        phase.phase === 'clarify' || phase.phase === 'arch'
          ? { ...phase, status: 'failed' as const, error: 'x' }
          : phase,
      ),
      currentPhase: 'clarify',
    }
    const prepared = prepareSnapshotForRetry(rig.ctx, withFailures, {
      nodeId: phaseNodeId('clarify'),
    })
    // 只重置了 clarify 的相位节点；arch 相位节点保持 failed
    const clarifyNode = prepared.snapshot.graph.nodes.find(
      node => node.id === phaseNodeId('clarify'),
    )
    const archNode = prepared.snapshot.graph.nodes.find(node => node.id === phaseNodeId('arch'))
    expect(clarifyNode?.status).toBe('pending')
    expect(archNode?.status).toBe('failed')
    // clarify 相位复位，arch 相位保持 failed
    expect(prepared.snapshot.phases.find(phase => phase.phase === 'clarify')?.status).toBe(
      'pending',
    )
    expect(prepared.snapshot.phases.find(phase => phase.phase === 'arch')?.status).toBe('failed')
    expect(prepared.snapshot.status).toBe('running')
  })

  it('activityId 作用域：从 activity 反解出 phase 与 nodeId', () => {
    const rig = makeRig()
    const snapshot = rig.ctx.createInitialSnapshot({ cwd: CWD, task: '任务' })
    const failedActivityId = 'act-failed-1'
    const withFailure = {
      ...snapshot,
      status: 'paused' as const,
      failure: {
        kind: 'unknown' as const,
        message: 'boom',
        recoverable: true,
        retryable: true,
      },
      pauseReason: 'boom',
      recoveryActions: [],
      activities: [
        {
          activityId: failedActivityId,
          kind: 'agent_session' as const,
          nodeId: phaseNodeId('clarify'),
          inputArtifactPaths: [],
          outputArtifactPaths: [],
          phase: 'clarify',
          startedAt: snapshot.createdAt,
          status: 'failed' as const,
        },
      ],
      graph: {
        ...snapshot.graph,
        nodes: snapshot.graph.nodes.map(node =>
          node.id === phaseNodeId('clarify')
            ? { ...node, status: 'failed' as const, error: 'boom' }
            : node,
        ),
      },
      phases: snapshot.phases.map(phase =>
        phase.phase === 'clarify' ? { ...phase, status: 'failed' as const, error: 'boom' } : phase,
      ),
    }
    const prepared = prepareSnapshotForRetry(rig.ctx, withFailure, {
      activityId: failedActivityId,
    })
    expect(prepared.snapshot.status).toBe('running')
    expect(prepared.snapshot.phases.find(phase => phase.phase === 'clarify')?.status).toBe(
      'pending',
    )
    const node = prepared.snapshot.graph.nodes.find(node => node.id === phaseNodeId('clarify'))
    expect(node?.status).toBe('pending')
    expect(node?.error).toBeUndefined()
  })
})

describe('ids：铸造规则', () => {
  it('safeArtifactName 把非法字符折叠为单横线并去首尾横线；空串回退 workflow', () => {
    expect(safeArtifactName('exec node #1')).toBe('exec-node-1')
    expect(safeArtifactName('///')).toBe('workflow')
    expect(safeArtifactName('--a--b--')).toBe('a--b')
    expect(safeArtifactName('a_b.c-d')).toBe('a_b.c-d')
  })

  it('safeRunIdSegment 额外折叠点号；phaseNodeId 加前缀；isTerminalStatus 三值判定', () => {
    expect(safeRunIdSegment('v1.2/x')).toBe('v1-2-x')
    expect(phaseNodeId('exec')).toBe('phase:exec')
    expect(isTerminalStatus('completed')).toBe(true)
    expect(isTerminalStatus('failed')).toBe(true)
    expect(isTerminalStatus('cancelled')).toBe(true)
    expect(isTerminalStatus('running')).toBe(false)
    expect(isTerminalStatus('paused')).toBe(false)
    expect(isTerminalStatus('pending')).toBe(false)
  })
})
