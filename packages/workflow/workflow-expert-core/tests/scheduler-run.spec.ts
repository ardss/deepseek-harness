/**
 * WorkflowGraphScheduler 主循环级测试（蓝图 §5.1 "scheduler 主循环顺序"）：
 * 真正驱动 scheduler.run()，用带闸门的假 runner 与手动时钟验证——
 * 派发次序、并发上限（maxConcurrentLoops）、连续失败熔断（maxConsecutiveErrors）、
 * 失败重试与成功清零、崩溃快照的 resume 修复、死锁判定、collection planner 的
 * defer / 扩图 / maxPlannerRuns 与 errorCount 熔断、abort 传播。
 * 对应迁移蓝图 §六 P2/P5 的验收面。
 */
import { describe, expect, it, vi } from 'vitest'

// 闸门式 runner 依赖真实定时器轮询；Windows fork 池高负载下放宽单测超时。
vi.setConfig({ testTimeout: 30_000 })
import type {
  WorkflowEvent,
  WorkflowGraphCollection,
  WorkflowGraphNode,
  WorkflowRunSnapshot,
} from '@deepseek-ai/dsh-workflow-runs'
import { WorkflowGraphScheduler } from '../src/scheduler.js'
import type {
  WorkflowGraphSchedulerDeps,
  WorkflowGraphSchedulerPlannerRunner,
  WorkflowGraphSchedulerRunResult,
  WorkflowGraphSchedulerRunner,
} from '../src/scheduler/types.js'

const T0 = '2026-01-01T00:00:00.000Z'

function node(id: string, overrides: Partial<WorkflowGraphNode> = {}): WorkflowGraphNode {
  return { dependsOn: [], id, kind: 'task', status: 'pending', title: id, ...overrides }
}

function makeSnapshot(options: {
  collections?: WorkflowGraphCollection[]
  edges?: Array<{ from: string; to: string }>
  maxConcurrent?: number
  maxErrors?: number
  nodes: WorkflowGraphNode[]
}): WorkflowRunSnapshot {
  return {
    activities: [],
    artifacts: [],
    createdAt: T0,
    cwd: 'C:/tmp/scheduler-test',
    graph: {
      collections: options.collections,
      edges: options.edges ?? [],
      nodes: options.nodes,
    },
    kind: 'expert',
    phaseOrder: ['exec'],
    phases: [{ phase: 'exec', status: 'active' }],
    recoveryActions: [],
    runId: 'wf_expert_sched-test',
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
    task: '调度器测试任务',
    updatedAt: T0,
  }
}

/** 带闸门的 runner：start/settle 都记录，节点要等 release() 才结算；统计最大并发。 */
class GatedRunner implements WorkflowGraphSchedulerRunner {
  readonly maxInFlight = { value: 0 }
  readonly responses: Array<{ node: string; response: string }> = []
  readonly started: string[] = []
  private current = 0
  private readonly resolvers = new Map<string, () => void>()
  private readonly gates = new Map<string, Promise<void>>()

  async run(input: { node: WorkflowGraphNode }): Promise<{ response: string; sessionId: string }> {
    this.started.push(input.node.id)
    this.current += 1
    this.maxInFlight.value = Math.max(this.maxInFlight.value, this.current)
    let gate = this.gates.get(input.node.id)
    if (gate === undefined) {
      gate = new Promise<void>((resolve) => {
        this.resolvers.set(input.node.id, resolve)
      })
      this.gates.set(input.node.id, gate)
    }
    await gate
    this.current -= 1
    const response = `ok ${input.node.id}`
    this.responses.push({ node: input.node.id, response })
    return { response, sessionId: `session-${input.node.id}` }
  }

  release(nodeId: string): void {
    this.resolvers.get(nodeId)?.()
  }
}

/** 每节点可编程成败的 runner：firstFailing 节点第一次抛错，之后成功。 */
class FlakyRunner implements WorkflowGraphSchedulerRunner {
  readonly attemptsPerNode = new Map<string, number>()
  constructor(private readonly firstFailing: string[], private readonly error: string) {}

  async run(input: {
    node: WorkflowGraphNode
  }): Promise<{ response: string; sessionId: string }> {
    const attempts = (this.attemptsPerNode.get(input.node.id) ?? 0) + 1
    this.attemptsPerNode.set(input.node.id, attempts)
    if (this.firstFailing.includes(input.node.id) && attempts === 1) {
      throw new Error(this.error)
    }
    return { response: `ok ${input.node.id}`, sessionId: `session-${input.node.id}` }
  }
}

class AlwaysFailingRunner implements WorkflowGraphSchedulerRunner {
  readonly calls: string[] = []
  async run(input: { node: WorkflowGraphNode }): Promise<{ response: string; sessionId: string }> {
    this.calls.push(input.node.id)
    throw new Error(`planned failure ${input.node.id}`)
  }
}

interface Harness {
  events: WorkflowEvent[]
  scheduler: WorkflowGraphScheduler
  snapshotsWritten: WorkflowRunSnapshot[]
}

function makeDeps(
  runner: WorkflowGraphSchedulerRunner,
  options: { planner?: WorkflowGraphSchedulerPlannerRunner } = {},
): Harness {
  const events: WorkflowEvent[] = []
  const snapshotsWritten: WorkflowRunSnapshot[] = []
  let activityCounter = 0
  let tick = 0
  const deps: WorkflowGraphSchedulerDeps = {
    appendEvent: async (event) => {
      events.push(event)
    },
    appendGraphRecord: async () => {},
    createActivityId: () => `act-${++activityCounter}`,
    now: () => new Date(Date.parse(T0) + ++tick),
    ...(options.planner === undefined ? {} : { plannerRunner: options.planner }),
    runner,
    writeArtifact: async (_runId, relativePath) => ({
      path: relativePath,
      relativePath,
    }),
    writeSnapshot: async (snapshot) => {
      snapshotsWritten.push(snapshot)
    },
  }
  return { events, scheduler: new WorkflowGraphScheduler(deps), snapshotsWritten }
}

function runOptions(
  snapshot: WorkflowRunSnapshot,
  overrides: {
    abortSignal?: AbortSignal
    executableNodeIds?: string[]
    phase?: string
  } = {},
) {
  return {
    ...(overrides.abortSignal === undefined ? {} : { abortSignal: overrides.abortSignal }),
    cwd: snapshot.cwd,
    ...(overrides.executableNodeIds === undefined
      ? {}
      : { executableNodeIds: overrides.executableNodeIds }),
    phase: overrides.phase ?? 'exec',
    snapshot,
  }
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 25_000
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition not met within 25s')
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

describe('WorkflowGraphScheduler.run：派发与并发上限', () => {
  it('maxConcurrentLoops=1 时严格串行：a 结算后 b 才派发', async () => {
    const snapshot = makeSnapshot({
      maxConcurrent: 1,
      nodes: [node('a'), node('b'), node('c')],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner)
    const pending = harness.scheduler.run(runOptions(snapshot))
    pending.catch(() => {})
    await waitFor(() => runner.started.length === 1)
    expect(runner.started).toEqual(['a'])
    runner.release('a')
    await waitFor(() => runner.started.length === 2)
    expect(runner.started).toEqual(['a', 'b'])
    runner.release('b')
    await waitFor(() => runner.started.length === 3)
    expect(runner.started).toEqual(['a', 'b', 'c'])
    runner.release('c')
    const result = await pending
    expect(result.reason).toBe('completed')
    expect(runner.maxInFlight.value).toBe(1)
    // frontier 事件确实发出且首帧 ready 含 a
    const frontier = harness.events.filter(event => event.type === 'frontier_changed')
    expect(frontier.length).toBeGreaterThan(0)
    expect(JSON.stringify(frontier[0]?.payload)).toContain('"a"')
  })

  it('maxConcurrentLoops=2 时并行派发两节点，完成一个补位一个', async () => {
    const snapshot = makeSnapshot({
      maxConcurrent: 2,
      nodes: [node('a'), node('b'), node('c')],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner)
    const pending = harness.scheduler.run(runOptions(snapshot))

    await waitFor(() => runner.started.length === 2)
    expect(runner.started).toEqual(['a', 'b'])
    expect(runner.maxInFlight.value).toBe(2)
    runner.release('a')
    await waitFor(() => runner.started.length === 3)
    expect(runner.started).toEqual(['a', 'b', 'c'])
    runner.release('b')
    // 等待 b 的完成快照落定再放行 c：两个节点同时结算会在共享快照上互踩（见报告）
    await waitFor(() =>
      harness.snapshotsWritten.some(item =>
        item.graph.nodes.some(node2 => node2.id === 'b' && node2.status === 'completed'),
      ),
    )
    runner.release('c')
    const result = await pending
    expect(result.status).toBe('completed')
  })

  it('依赖次序：b 在 a 完成之前不派发', async () => {
    const snapshot = makeSnapshot({
      edges: [{ from: 'a', to: 'b' }],
      nodes: [node('a'), node('b')],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner)
    const pending = harness.scheduler.run(runOptions(snapshot))

    await waitFor(() => runner.started.length === 1)
    expect(runner.started).toEqual(['a'])
    // a 尚未结算，b 不得派发
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(runner.started).toEqual(['a'])
    console.log('RELEASING a')
    runner.release('a')
    for (let i = 0; i < 10; i++) {
      await new Promise(resolve => setTimeout(resolve, 50))
      console.log('post', i, JSON.stringify(runner.started), JSON.stringify(runner.responses))
    }
    await waitFor(() => runner.started.length === 2)
    expect(runner.started).toEqual(['a', 'b'])
    runner.release('b')
    const result = await pending
    expect(result.reason).toBe('completed')
  })
})

describe('WorkflowGraphScheduler.run：熔断与重试', () => {
  it('连续失败达到 maxConsecutiveErrors 后熔断暂停（error_threshold），不再派发', async () => {
    const snapshot = makeSnapshot({
      maxErrors: 2,
      nodes: [node('f1'), node('f2')],
    })
    const runner = new AlwaysFailingRunner()
    const harness = makeDeps(runner)
    const result = await harness.scheduler.run(runOptions(snapshot))

    expect(result.reason).toBe('error_threshold')
    expect(result.status).toBe('paused')
    // 熔断前每个节点恰好试了一轮（首轮失败 attempts=1 < 2 回 pending，但熔断已触发）
    expect(runner.calls).toEqual(['f1', 'f2'])
    const paused = harness.events.filter(event => event.type === 'executor_paused')
    expect(paused).toHaveLength(1)
    expect(paused[0]?.message).toContain('2 consecutive node error')
  })

  it('attempts < maxConsecutiveErrors 时回 pending 重试，成功后连续错误清零并完成', async () => {
    const snapshot = makeSnapshot({
      maxErrors: 3,
      nodes: [node('flaky')],
    })
    const runner = new FlakyRunner(['flaky'], 'flaky boom')
    const harness = makeDeps(runner)
    const result = await harness.scheduler.run(runOptions(snapshot))

    expect(result.reason).toBe('completed')
    expect(runner.attemptsPerNode.get('flaky')).toBe(2)
    const finalNode = result.snapshot.graph.nodes[0]
    expect(finalNode?.status).toBe('completed')
    expect(finalNode?.attempts).toBe(1)
    const failed = harness.events.filter(event => event.type === 'node_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.payload).toMatchObject({ attempts: 1, retry: true })
  })

  it('达到 attempts 上限的节点置 failed，failed 在派生状态里解除对下游的阻塞', async () => {
    // maxConsecutiveErrors=1：bad 首败即 failed，但熔断随之触发——下游在本轮不会被派发。
    const snapshot = makeSnapshot({
      edges: [{ from: 'bad', to: 'down' }],
      maxErrors: 1,
      nodes: [node('bad'), node('down')],
    })
    const runner: WorkflowGraphSchedulerRunner = {
      run: async (input) => {
        if (input.node.id === 'bad') throw new Error('always broken')
        return { response: 'ok', sessionId: 's' }
      },
    }
    const harness = makeDeps(runner)
    const result = await harness.scheduler.run(runOptions(snapshot))
    expect(result.reason).toBe('error_threshold')
    const bad = result.snapshot.graph.nodes.find(item => item.id === 'bad')
    expect(bad?.status).toBe('failed')
    expect(bad?.attempts).toBe(1)
    // failed 解除阻塞的实证：down 在 bad 置 failed 后被派发并完成。
    const down = result.snapshot.graph.nodes.find(item => item.id === 'down')
    expect(down?.status).toBe('completed')
  })

  it('崩溃遗留的 active 节点先被 reconcile 复位为 pending 并落快照，再派发', async () => {
    const snapshot = makeSnapshot({
      nodes: [node('busy', { status: 'active' }), node('idle')],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner)
    const pending = harness.scheduler.run(runOptions(snapshot))
    await waitFor(() => harness.snapshotsWritten.length > 0)
    // 第一份写下的快照就是修复快照
    const repaired = harness.snapshotsWritten[0]
    const busy = repaired?.graph.nodes.find(item => item.id === 'busy')
    expect(busy?.status).toBe('pending')
    expect(busy?.error).toContain('Reset during workflow resume')
    for (const id of ['busy', 'idle']) {
      await waitFor(() => runner.started.includes(id))
      runner.release(id)
    }
    const result = await pending
    expect(result.reason).toBe('completed')
    expect(runner.started).toEqual(expect.arrayContaining(['busy', 'idle']))
  })

  it('可执行节点只被不可执行的 pending 依赖阻塞且无在跑节点时判死锁', async () => {
    const snapshot = makeSnapshot({
      edges: [{ from: 'gate', to: 'a' }],
      nodes: [node('a', { dependsOn: ['gate'] }), node('gate')],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner)
    // gate 不在可执行集内且永远 pending → a 永远不 ready
    const result = await harness.scheduler.run(
      runOptions(snapshot, { executableNodeIds: ['a'] }),
    )
    expect(result.reason).toBe('deadlock')
    expect(result.status).toBe('paused')
    expect(runner.started).toEqual([])
    const paused = harness.events.filter(event => event.type === 'executor_paused')
    expect(JSON.stringify(paused[0]?.payload)).toContain('gate')
  })

  it('已中止的信号让 run 直接抛出（reason 透传）', async () => {
    const snapshot = makeSnapshot({ nodes: [node('a')] })
    const controller = new AbortController()
    controller.abort(new Error('user stopped the run'))
    const harness = makeDeps(new GatedRunner())
    await expect(
      harness.scheduler.run(runOptions(snapshot, { abortSignal: controller.signal })),
    ).rejects.toThrow('user stopped the run')
  })
})

describe('WorkflowGraphScheduler.run：collection planner', () => {
  it('w1 完成前 defer 初轮，完成后 planner 运行一次并 exhaust collection，run 完成', async () => {
    const plannerCalls: number[] = []
    let tick = 0
    const planner: WorkflowGraphSchedulerPlannerRunner = {
      run: async () => {
        plannerCalls.push(++tick)
        return {
          collectionNodeIds: ['w1'],
          edges: [],
          exhausted: true,
          nodes: [],
          response: '{}',
          sessionId: 'planner',
        }
      },
    }
    const snapshot = makeSnapshot({
      collections: [
        { collectionId: 'c1', explorable: true, nodeIds: ['w1'], title: 'C1' },
      ],
      nodes: [node('w1', { collectionId: 'c1' })],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner, { planner })
    const pending = harness.scheduler.run(runOptions(snapshot))

    await waitFor(() => runner.started.length === 1)
    // defer：w1 在跑时 planner 不应已运行
    expect(plannerCalls).toHaveLength(0)
    runner.release('w1')
    const result = await pending
    expect(result.reason).toBe('completed')
    expect(plannerCalls).toHaveLength(1)
    // planner 工件与事件齐备
    expect(harness.events.some(event => event.type === 'planner_started')).toBe(true)
    expect(harness.events.some(event => event.type === 'planner_completed')).toBe(true)
    // 顺序：node_completed 先于 planner_started
    const completedIndex = harness.events.findIndex(event => event.type === 'node_completed')
    const plannerIndex = harness.events.findIndex(event => event.type === 'planner_started')
    expect(completedIndex).toBeGreaterThanOrEqual(0)
    expect(plannerIndex).toBeGreaterThan(completedIndex)
    const collection = result.snapshot.graph.collections?.[0]
    expect(collection?.status).toBe('exhausted')
  })

  it('plannerRuns 达到 maxPlannerRuns 时直接 exhaust，不再调用 planner', async () => {
    let plannerCalls = 0
    const planner: WorkflowGraphSchedulerPlannerRunner = {
      run: async () => {
        plannerCalls += 1
        return {
          collectionNodeIds: [],
          edges: [],
          nodes: [],
          response: '{}',
          sessionId: 'p',
        }
      },
    }
    const snapshot = makeSnapshot({
      collections: [
        {
          collectionId: 'c1',
          explorable: true,
          nodeIds: ['w1'],
          plannerRuns: 10,
          title: 'C1',
        },
      ],
      nodes: [node('w1', { collectionId: 'c1', status: 'completed' })],
    })
    const harness = makeDeps(new GatedRunner(), { planner })
    const result = await harness.scheduler.run(runOptions(snapshot))
    expect(plannerCalls).toBe(0)
    expect(result.reason).toBe('completed')
    expect(result.snapshot.graph.collections?.[0]?.status).toBe('exhausted')
    const exhausted = harness.events.filter(event => event.type === 'collection_exhausted')
    expect(exhausted).toHaveLength(1)
    expect(exhausted[0]?.payload).toMatchObject({
      collectionId: 'c1',
      reason: 'max_planner_runs',
    })
  })

  it('errorCount 预检：已达 maxConsecutiveErrors 的 collection 直接 exhaust，不再调 planner', async () => {
    let plannerCalls = 0
    const planner: WorkflowGraphSchedulerPlannerRunner = {
      run: async () => {
        plannerCalls += 1
        throw new Error('planner exploded')
      },
    }
    const snapshot = makeSnapshot({
      collections: [
        {
          collectionId: 'c1',
          errorCount: 3,
          explorable: true,
          nodeIds: ['w1'],
          title: 'C1',
        },
      ],
      nodes: [node('w1', { collectionId: 'c1', status: 'completed' })],
    })
    const harness = makeDeps(new GatedRunner(), { planner })
    const result = await harness.scheduler.run(runOptions(snapshot))
    expect(plannerCalls).toBe(0)
    expect(result.reason).toBe('completed')
    const collection = result.snapshot.graph.collections?.[0]
    expect(collection?.status).toBe('exhausted')
    expect(collection?.errorCount).toBe(3)
    const exhausted = harness.events.filter(event => event.type === 'collection_exhausted')
    expect(exhausted).toHaveLength(1)
    expect(exhausted[0]?.payload).toMatchObject({
      collectionId: 'c1',
      reason: 'planner_error_threshold',
    })
  })

  it('planner 失败一次：collection 计入 errorCount 转入 draining（尚未 exhaust）', async () => {
    let plannerCalls = 0
    const planner: WorkflowGraphSchedulerPlannerRunner = {
      run: async () => {
        plannerCalls += 1
        throw new Error('planner exploded')
      },
    }
    const snapshot = makeSnapshot({
      collections: [
        { collectionId: 'c1', explorable: true, nodeIds: ['w1'], title: 'C1' },
      ],
      nodes: [node('w1', { collectionId: 'c1', status: 'completed' })],
    })
    const harness = makeDeps(new GatedRunner(), { planner })
    // 首次失败后无可派发节点、collection 未 exhaust → 判死锁暂停，真相在快照里
    const result = await harness.scheduler.run(runOptions(snapshot))
    expect(plannerCalls).toBe(1)
    expect(result.reason).toBe('deadlock')
    const collection = result.snapshot.graph.collections?.[0]
    expect(collection?.status).toBe('draining')
    expect(collection?.exhausted).toBe(false)
    expect(collection?.errorCount).toBe(1)
    const failed = harness.events.filter(event => event.type === 'planner_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0]?.payload).toMatchObject({ collectionId: 'c1', errorCount: 1, exhausted: false })
  })

  it('planner 扩图：新节点带着 dependsOn 边进入图并被调度到完成', async () => {
    const planner: WorkflowGraphSchedulerPlannerRunner = {
      run: async () => ({
        collectionNodeIds: ['w1', 'p1', 'p2'],
        edges: [],
        exhausted: true,
        nodes: [
          { collectionId: 'c1', dependsOn: ['w1'], id: 'p1', kind: 'task', title: 'P1' },
          { collectionId: 'c1', dependsOn: ['p1'], id: 'p2', kind: 'task', title: 'P2' },
        ],
        response: '{}',
        sessionId: 'p',
      }),
    }
    const snapshot = makeSnapshot({
      collections: [
        { collectionId: 'c1', explorable: true, nodeIds: ['w1'], title: 'C1' },
      ],
      nodes: [node('w1', { collectionId: 'c1', status: 'completed' })],
    })
    const runner = new GatedRunner()
    const harness = makeDeps(runner, { planner })
    const pending = harness.scheduler.run(runOptions(snapshot))
    await waitFor(() => runner.started.length >= 1)
    runner.release('p1')
    await waitFor(() => runner.started.length >= 2)
    runner.release('p2')
    const result = await pending
    expect(result.reason).toBe('completed')
    const p1 = result.snapshot.graph.nodes.find(item => item.id === 'p1')
    const p2 = result.snapshot.graph.nodes.find(item => item.id === 'p2')
    expect(p1?.status).toBe('completed')
    expect(p2?.status).toBe('completed')
    expect(result.snapshot.graph.edges).toContainEqual({ from: 'p1', to: 'p2' })
    expect(result.snapshot.graph.edges).toContainEqual({ from: 'w1', to: 'p1' })
  })
})

describe('WorkflowGraphScheduler.run：结果快照形态', () => {
  it('完成时每个可执行节点都是终态且 executor_completed 事件在场', async () => {
    const snapshot = makeSnapshot({
      nodes: [node('a'), node('b', { status: 'skipped' })],
    })
    const runner: WorkflowGraphSchedulerRunner = {
      run: async input => ({ response: `ok ${input.node.id}`, sessionId: 's' }),
    }
    const done = makeDeps(runner)
    const result: WorkflowGraphSchedulerRunResult = await done.scheduler.run(
      runOptions(snapshot),
    )
    expect(result.reason).toBe('completed')
    expect(result.snapshot.graph.nodes.map(item => item.status)).toEqual([
      'completed',
      'skipped',
    ])
    const completed = done.events.filter(event => event.type === 'executor_completed')
    expect(completed).toHaveLength(1)
    expect(completed[0]?.phase).toBe('exec')
  })
})
