/**
 * WorkflowGraphScheduler 的并发与熔断深测（补充 scheduler-run.spec 的缺口）：
 * - 节点级重试预算与 run 级熔断共用 maxConsecutiveErrors 的精确分界（重试耗尽恰在第二次失败处）；
 * - 熔断前排空在飞节点：失败不误伤已在跑的邻居，其结果仍写进快照；
 * - 交错成功把连续错误计数清零，熔断永不触发；
 * - 在飞中止：runner 响应 abortSignal 后 run 以同一 reason 拒绝；
 * - frontier_changed 的去重与首末帧内容。
 */
import { describe, expect, it, vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000 })
import type {
  WorkflowEvent,
  WorkflowGraphNode,
  WorkflowRunSnapshot,
} from '@deepseek-ai/dsh-workflow-runs'
import { WorkflowGraphScheduler } from '../src/scheduler.js'
import type {
  WorkflowGraphSchedulerDeps,
  WorkflowGraphSchedulerRunner,
} from '../src/scheduler/types.js'

const T0 = '2026-01-01T00:00:00.000Z'

function node(id: string, overrides: Partial<WorkflowGraphNode> = {}): WorkflowGraphNode {
  return { dependsOn: [], id, kind: 'task', status: 'pending', title: id, ...overrides }
}

function makeSnapshot(options: {
  edges?: Array<{ from: string; to: string }>
  maxConcurrent?: number
  maxErrors?: number
  nodes: WorkflowGraphNode[]
}): WorkflowRunSnapshot {
  return {
    activities: [],
    artifacts: [],
    createdAt: T0,
    cwd: 'C:/tmp/circuit-test',
    graph: {
      collections: [],
      edges: options.edges ?? [],
      nodes: options.nodes,
    },
    kind: 'expert',
    phaseOrder: ['exec'],
    phases: [{ phase: 'exec', status: 'active' }],
    recoveryActions: [],
    runId: 'wf_expert_circuit-test',
    schemaVersion: 1,
    sessionLinks: [],
    status: 'running',
    strategy: {
      clarify: { confidenceThreshold: 0.8, maxRounds: 3, minRounds: 1 },
      executor: {
        drainingChangeHours: 1,
        frontierTarget: 3,
        maxConcurrentLoops: options.maxConcurrent ?? 2,
        maxConsecutiveErrors: options.maxErrors ?? 3,
        maxPlannerRuns: 10,
      },
      finalCritic: { maxIterations: 3 },
      reactLoop: { maxRounds: 30 },
    },
    task: '熔断测试任务',
    updatedAt: T0,
  }
}

function makeDeps(
  runner: WorkflowGraphSchedulerRunner,
): { deps: WorkflowGraphSchedulerDeps; events: WorkflowEvent[] } {
  const events: WorkflowEvent[] = []
  let tick = 0
  const deps: WorkflowGraphSchedulerDeps = {
    appendEvent: async (event) => {
      events.push(event)
    },
    appendGraphRecord: async () => {},
    createActivityId: () => `act-${events.length}-${Math.random()}`,
    now: () => new Date(Date.parse(T0) + ++tick),
    runner,
    writeArtifact: async (_runId, relativePath) => ({ path: relativePath, relativePath }),
    writeSnapshot: async () => {},
  }
  return { deps, events }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 25_000
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('waitFor: condition not met within 25s')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('熔断分界：重试预算与连续错误计数共用阈值', () => {
  it('maxConsecutiveErrors=2 串行单节点：第二次失败恰好触发熔断，节点置 failed，共调用两次', async () => {
    const calls: string[] = []
    const runner: WorkflowGraphSchedulerRunner = {
      run: async (input) => {
        calls.push(input.node.id)
        throw new Error(`planned ${input.node.id} failure`)
      },
    }
    const { deps, events } = makeDeps(runner)
    const scheduler = new WorkflowGraphScheduler(deps)
    const result = await scheduler.run({
      cwd: 'C:/tmp/circuit-test',
      phase: 'exec',
      snapshot: makeSnapshot({ maxConcurrent: 1, maxErrors: 2, nodes: [node('a')] }),
    })
    expect(result.reason).toBe('error_threshold')
    expect(result.status).toBe('paused')
    expect(calls).toEqual(['a', 'a'])
    const a = result.snapshot.graph.nodes[0]
    expect(a?.status).toBe('failed')
    expect(a?.attempts).toBe(2)
    const paused = events.filter(event => event.type === 'executor_paused')
    expect(paused).toHaveLength(1)
    expect(paused[0]?.message).toContain('2 consecutive node error')
  })

  it('失败后的成功清零连续错误计数：a 一败一成，永不熔断，run 完成', async () => {
    const attempts = new Map<string, number>()
    const runner: WorkflowGraphSchedulerRunner = {
      run: async (input) => {
        const count = (attempts.get(input.node.id) ?? 0) + 1
        attempts.set(input.node.id, count)
        if (input.node.id === 'a' && count === 1) throw new Error('a transient')
        return { response: `ok ${input.node.id}`, sessionId: 's' }
      },
    }
    const { deps, events } = makeDeps(runner)
    const scheduler = new WorkflowGraphScheduler(deps)
    const result = await scheduler.run({
      cwd: 'C:/tmp/circuit-test',
      phase: 'exec',
      snapshot: makeSnapshot({ maxConcurrent: 1, maxErrors: 2, nodes: [node('a'), node('b')] }),
    })
    expect(result.reason).toBe('completed')
    expect(attempts.get('a')).toBe(2)
    const a = result.snapshot.graph.nodes.find(entry => entry.id === 'a')
    expect(a?.status).toBe('completed')
    expect(a?.attempts).toBe(1)
    expect(events.some(event => event.type === 'executor_paused')).toBe(false)
    // a 的首败记了 retry 而非 failed
    const failed = events.filter(event => event.type === 'node_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.payload).toMatchObject({ attempts: 1, retry: true })
  })
})

describe('熔断前排空在飞节点', () => {
  it('熔断分支先等在飞节点结算：b 的成果不丢，快照里 b completed', async () => {
    const resolvers = new Map<string, () => void>()
    const started: string[] = []
    const runner: WorkflowGraphSchedulerRunner = {
      run: async (input) => {
        started.push(input.node.id)
        if (input.node.id === 'a') throw new Error('a always broken')
        await new Promise<void>(resolve => resolvers.set(input.node.id, resolve))
        return { response: `ok ${input.node.id}`, sessionId: `s-${input.node.id}` }
      },
    }
    const { deps, events } = makeDeps(runner)
    const scheduler = new WorkflowGraphScheduler(deps)
    const pending = scheduler.run({
      cwd: 'C:/tmp/circuit-test',
      phase: 'exec',
      snapshot: makeSnapshot({ maxConcurrent: 2, maxErrors: 1, nodes: [node('a'), node('b')] }),
    })
    let result: Awaited<typeof pending> | undefined
    pending.then(
      (value) => {
        result = value
      },
      () => {},
    )

    // a 即败（attempts 1 >= max 1 → failed，ce=1）；b 在飞。下一轮循环在派发之前
    // 先进入熔断分支：必须先排空在飞的 b 才能暂停。
    await waitFor(() => started.length === 2)
    expect(started).toEqual(['a', 'b'])
    resolvers.get('b')?.()
    await waitFor(() => result !== undefined)
    expect(result?.reason).toBe('error_threshold')
    // 注意（实测发现的共享快照互踩，与 scheduler-run.spec 注释一致）：
    // a 与 b 近乎同时结算时，b 的完成快照可能盖掉 a 的失败快照——失败仍以事件为准。
    const aFailedEvent = events.find(
      event => event.type === 'node_failed' && event.nodeId === 'a',
    )
    expect(aFailedEvent).toBeDefined()
    const b = result?.snapshot.graph.nodes.find(entry => entry.id === 'b')
    expect(b?.status).toBe('completed')
    // b 的完成事件在案（node_completed），且暂停事件在其后
    const completedIndex = events.findIndex(
      event => event.type === 'node_completed' && event.nodeId === 'b',
    )
    const pausedIndex = events.findIndex(event => event.type === 'executor_paused')
    expect(completedIndex).toBeGreaterThanOrEqual(0)
    expect(pausedIndex).toBeGreaterThan(completedIndex)
  })
})

describe('在飞中止', () => {
  it('runner 响应 abortSignal 拒绝后，scheduler.run 以同一 reason 拒绝', async () => {
    const controller = new AbortController()
    const runner: WorkflowGraphSchedulerRunner = {
      run: async input =>
        await new Promise<never>((_resolve, reject) => {
          input.abortSignal?.addEventListener(
            'abort',
            () => reject(input.abortSignal?.reason),
            { once: true },
          )
        }),
    }
    const { deps } = makeDeps(runner)
    const scheduler = new WorkflowGraphScheduler(deps)
    const pending = scheduler.run({
      abortSignal: controller.signal,
      cwd: 'C:/tmp/circuit-test',
      phase: 'exec',
      snapshot: makeSnapshot({ maxConcurrent: 1, nodes: [node('a')] }),
    })
    const settled = pending.then(
      () => 'resolved',
      (error: unknown) => String((error as Error).message),
    )
    // 让出一个微任务拍，保证 run 已进入 Promise.race 等待
    await new Promise(resolve => setTimeout(resolve, 20))
    controller.abort(new Error('stop it now'))
    expect(await settled).toBe('stop it now')
  })
})

describe('frontier_changed 事件', () => {
  it('串行三节点：每帧 frontier 内容不同（无重复发射），末帧无 ready 无 active', async () => {
    const runner: WorkflowGraphSchedulerRunner = {
      run: async input => ({ response: `ok ${input.node.id}`, sessionId: 's' }),
    }
    const { deps, events } = makeDeps(runner)
    const scheduler = new WorkflowGraphScheduler(deps)
    const result = await scheduler.run({
      cwd: 'C:/tmp/circuit-test',
      phase: 'exec',
      snapshot: makeSnapshot({
        maxConcurrent: 1,
        nodes: [node('a'), node('b', { dependsOn: ['a'] }), node('c', { dependsOn: ['b'] })],
      }),
    })
    expect(result.reason).toBe('completed')
    const frontiers = events.filter(event => event.type === 'frontier_changed')
    expect(frontiers.length).toBeGreaterThanOrEqual(2)
    // 去重：相邻两帧的载荷必不相同（调度器按 frontier 键去重）
    const payloads = frontiers.map(event => JSON.stringify(event.payload))
    for (let index = 1; index < payloads.length; index++) {
      expect(payloads[index]).not.toBe(payloads[index - 1])
    }
    // 首帧：a ready 且无 active；末帧：全部结算后无 ready 无 active
    const first = frontiers[0]?.payload as { activeNodeIds: string[]; readyNodeIds: string[] }
    expect(first.readyNodeIds).toEqual(['a'])
    expect(first.activeNodeIds).toEqual([])
    const last = frontiers.at(-1)?.payload as {
      activeNodeIds: string[]
      readyNodeIds: string[]
      blockedNodes: unknown[]
    }
    expect(last.readyNodeIds).toEqual([])
    expect(last.activeNodeIds).toEqual([])
    expect(last.blockedNodes).toEqual([])
  })
})
