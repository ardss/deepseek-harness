/**
 * 运行时测试底座：内存版 WorkflowStorePort（JSONL 账本与工件都留在内存）与
 * 脚本化 agentRunner（按相位应答，记录每次调用）。供 run-loop / critic / scheduler
 * 主循环级测试复用——测试真正驱动 run()/continueRun()，而不是只测纯函数。
 */
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
  type WorkflowEvent,
  type WorkflowGraphRecord,
  type WorkflowKind,
  type WorkflowRunListItem,
  type WorkflowRunSnapshot,
  type WorkflowStorePort,
} from '@deepseek-ai/dsh-workflow-runs'
import type {
  ExpertWorkflowAgentRunInput,
  ExpertWorkflowAgentRunResult,
} from '../src/expert/types.js'

/** 内存版 store：快照按 runId 覆写，事件与图账本只追加（与生产 log form 同形）。 */
export class InMemoryWorkflowStore implements WorkflowStorePort {
  readonly snapshots = new Map<string, WorkflowRunSnapshot>()
  readonly events: WorkflowEvent[] = []
  readonly graphRecords = new Map<string, WorkflowGraphRecord[]>()
  readonly files = new Map<string, string>()
  writeSnapshotCalls = 0

  async appendEvent(event: WorkflowEvent): Promise<void> {
    this.events.push(event)
  }

  async appendGraphRecord(runId: string, record: WorkflowGraphRecord): Promise<void> {
    const list = this.graphRecords.get(runId) ?? []
    list.push(record)
    this.graphRecords.set(runId, list)
  }

  graphRecordsOf(runId: string): WorkflowGraphRecord[] {
    return this.graphRecords.get(runId) ?? []
  }

  async listRuns(options?: {
    cwd?: string
    kind?: WorkflowKind
    limit?: number
  }): Promise<WorkflowRunListItem[]> {
    const items = [...this.snapshots.values()]
      .filter(
        snapshot =>
          (options?.cwd === undefined || snapshot.cwd === options.cwd) &&
          (options?.kind === undefined || snapshot.kind === options.kind),
      )
      .map((snapshot): WorkflowRunListItem => ({
        ...(snapshot.completedAt === undefined ? {} : { completedAt: snapshot.completedAt }),
        createdAt: snapshot.createdAt,
        cwd: snapshot.cwd,
        kind: snapshot.kind,
        runId: snapshot.runId,
        status: snapshot.status,
        task: snapshot.task,
        updatedAt: snapshot.updatedAt,
      }))
    return options?.limit === undefined ? items : items.slice(0, options.limit)
  }

  async readEvents(runId: string): Promise<WorkflowEvent[]> {
    return this.events.filter(event => event.runId === runId)
  }

  async readLatestRun(options?: { cwd?: string; kind?: WorkflowKind }): Promise<WorkflowRunSnapshot | null> {
    const items = [...this.snapshots.values()].filter(
      snapshot =>
        (options?.cwd === undefined || snapshot.cwd === options.cwd) &&
        (options?.kind === undefined || snapshot.kind === options.kind),
    )
    if (items.length === 0) return null
    return items.reduce((latest, item) => (item.updatedAt > latest.updatedAt ? item : latest))
  }

  async readRun(runId: string): Promise<WorkflowRunSnapshot | null> {
    return this.snapshots.get(runId) ?? null
  }

  async writeArtifact(
    runId: string,
    relativePath: string,
    content: string,
  ): Promise<{ path: string; relativePath: string }> {
    this.files.set(`${runId}:${relativePath}`, content)
    return { path: `${runId}/${relativePath}`, relativePath }
  }

  async writeReport(
    runId: string,
    content: string,
  ): Promise<{ path: string; relativePath: string }> {
    const relativePath = `reports/${runId}.md`
    this.files.set(`${runId}:${relativePath}`, content)
    return { path: `${runId}/${relativePath}`, relativePath }
  }

  async writeSnapshot(snapshot: WorkflowRunSnapshot): Promise<void> {
    this.writeSnapshotCalls += 1
    this.snapshots.set(snapshot.runId, snapshot)
  }

  fileContent(runId: string, relativePath: string): string | undefined {
    return this.files.get(`${runId}:${relativePath}`)
  }

  eventsOf(runId: string, type?: string): WorkflowEvent[] {
    return this.events.filter(
      event => event.runId === runId && (type === undefined || event.type === type),
    )
  }
}

type Responder = (
  input: ExpertWorkflowAgentRunInput,
  callIndex: number,
) => string | Promise<string>

/** 脚本化 agentRunner：按相位注册应答；未注册相位的调用直接失败（防测试静默走错路径）。 */
export class ScriptedAgentRunner {
  readonly calls: Array<{ phase: string; prompt: string; activityId: string }> = []
  private readonly perPhaseCalls = new Map<string, number>()
  private readonly responders = new Map<string, Responder>()

  on(phase: string, responder: Responder): this {
    this.responders.set(phase, responder)
    return this
  }

  text(phase: string, response: string): this {
    return this.on(phase, () => response)
  }

  json(phase: string, value: unknown): this {
    return this.text(phase, JSON.stringify(value))
  }

  throwing(phase: string, error: Error): this {
    return this.on(phase, () => {
      throw error
    })
  }

  async run(input: ExpertWorkflowAgentRunInput): Promise<ExpertWorkflowAgentRunResult> {
    const responder = this.responders.get(input.phase)
    if (responder === undefined) {
      throw new Error(`ScriptedAgentRunner: unexpected phase call: ${input.phase}`)
    }
    const callIndex = this.perPhaseCalls.get(input.phase) ?? 0
    this.perPhaseCalls.set(input.phase, callIndex + 1)
    this.calls.push({
      activityId: input.activityId,
      phase: input.phase,
      prompt: input.prompt,
    })
    const response = await responder(input, callIndex)
    return {
      response,
      sessionId: `session-${input.phase}-${callIndex}`,
    }
  }

  callsFor(phase: string): number {
    return this.perPhaseCalls.get(phase) ?? 0
  }
}

let clockTick = 0

/** 单调时钟：时间戳严格递增，快照 updatedAt 可比较。 */
export function monotonicNow(): Date {
  clockTick += 1
  return new Date(Date.parse('2026-01-01T00:00:00.000Z') + clockTick)
}

/** 受控测试定义：clarify → arch(播种) → meta(节点提示词) → exec(调度图) → final_critic → complete。 */
export function testDefinition(options?: { finalCriticMaxIterations?: number }): WorkflowDefinition {
  return WorkflowDefinitionSchema.parse({
    definitionId: 'expert',
    definitionVersion: 'test',
    description: '受控测试定义',
    kind: 'expert',
    phaseOrder: ['clarify', 'arch', 'meta', 'exec', 'final_critic', 'complete'],
    phases: [
      {
        artifactPath: 'artifacts/01-clarify.md',
        behavior: 'agent',
        description: '澄清目标与验收标准。',
        phase: 'clarify',
        title: 'Clarify',
      },
      {
        artifactPath: 'artifacts/03-arch.md',
        behavior: 'agent',
        description: '分解为依赖图。',
        phase: 'arch',
        seedGraphFromArtifact: {
          targetPhase: 'exec',
        },
        title: 'Architecture',
      },
      {
        artifactPath: 'artifacts/05-meta.md',
        behavior: 'agent',
        description: '写节点提示词。',
        nodePromptsFromArtifact: {
          targetPhase: 'exec',
        },
        phase: 'meta',
        title: 'Meta Prompt',
      },
      {
        artifactPath: 'artifacts/06-exec.md',
        behavior: 'scheduled_graph',
        description: '执行计划好的工作。',
        phase: 'exec',
        title: 'Execute',
      },
      {
        artifactPath: 'artifacts/07-critic.md',
        behavior: 'critic',
        description: '对照验收标准复核。',
        phase: 'final_critic',
        title: 'Final Critic',
      },
      {
        behavior: 'complete',
        description: '写终报告。',
        phase: 'complete',
        title: 'Complete',
      },
    ],
    strategy: {
      clarify: { confidenceThreshold: 0.8, maxRounds: 3, minRounds: 1 },
      executor: {
        drainingChangeHours: 1,
        frontierTarget: 3,
        maxConcurrentLoops: 2,
        maxConsecutiveErrors: 3,
        maxPlannerRuns: 10,
      },
      finalCritic: { maxIterations: options?.finalCriticMaxIterations ?? 3 },
      reactLoop: { maxRounds: 30 },
    },
    title: 'Test Expert Workflow',
  })
}

/** 测试用的播种响应：两个 exec 任务节点 n1→n2。 */
export const SEED_RESPONSE = {
  edges: [{ from: 'n1', to: 'n2' }],
  nodes: [
    { id: 'n1', title: 'Node One' },
    { dependsOn: ['n1'], id: 'n2', title: 'Node Two' },
  ],
  reasoning: '分解',
}

/** 测试用的节点提示词更新响应：只改 n1。 */
export const PROMPT_UPDATE_RESPONSE = {
  nodes: [{ id: 'n1', prompt: 'PROMPT-N1' }],
  reasoning: '细化',
}

export const CRITIC_PASS = { reasoning: 'all good', verdict: 'pass' }

export function criticFail(proposals: Array<{ nodeId: string; reason: string }>): unknown {
  return {
    reasoning: 'gaps found',
    reopenProposals: proposals.map(proposal => ({ ...proposal, severity: 'major' })),
    verdict: 'fail',
  }
}
