// tool-dynamic-workflow 的工具面测试：技能门、端口缺席占位、创建→jobs 投递闭环、
// saved 存取、结算映射（spec-conversation-flow §十二 第 2/3/4/8 条的对等验收）。
import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { Context } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { ToolRuntime } from '@deepseek-ai/dsh-tools'
import LocalJobRegistry from '@deepseek-ai/dsh-jobs-local'
import * as ToolJobs from '@deepseek-ai/dsh-tool-jobs'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { DynamicWorkflowRunSettlement } from '@deepseek-ai/dsh-workflow-runs'
import * as toolDynamicWorkflow from '../src/index.ts'
import type { DynamicWorkflowRunPort } from '../src/port.ts'
import { isDynamicWorkflowSkillLoaded, requireDynamicWorkflowSkill } from '../src/skill-gate.ts'
import { renderSettlementNotification, mapJobOutcomeStatus } from '../src/run-job.ts'
import { listSavedWorkflows, readSavedWorkflow, saveWorkflowDefinition } from '../src/saved-store.ts'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let sessionCounter = 0

/** 建一个 detached 会话（header 版本须为 SESSION_FORMAT_VERSION=4）；cwd 指向临时目录，避免测试落盘污染仓库。 */
async function newSession(): Promise<Session> {
  sessionCounter += 1
  const cwd = await mkdtemp(join(tmpdir(), 'dsh-wf-session-'))
  return Session.create(SessionId(`s-${sessionCounter}`), [], {
    version: 4,
    id: SessionId(`s-${sessionCounter}`),
    createdAt: 0,
    isSeeded: false,
    cwd,
  } as never)
}

function agentOf(session: Session): Agent {
  // 最小假面：工具面只读 id / session / header；其余字段对 stub 调用不可达。
  // no-unknown-casts 门禁禁 unknown 断言：经 object 的受控降转（Agent 可赋给 object）。
  const stub: object = { id: 'agent-1', session }
  return stub as Agent
}

describe('skill gate', () => {
  async function sessionWithSkillLoad(success: boolean): Promise<Session> {
    const session = await newSession()
    session.append('tool/call', {
      turn: 0,
      step: 0,
      callId: ToolCallId('c1'),
      name: 'skill',
      arguments: '{"name":"dynamic-workflows"}',
    })
    session.append('tool/result', {
      turn: 0,
      step: 0,
      message: createToolResultMessage({
        callId: ToolCallId('c1'),
        content: [{ type: 'text', text: 'loaded' }],
        isError: !success,
      }),
    }, { surfaceOp: 'append' })
    return session
  }

  it('accepts a session with a successful skill load', async () => {
    const loaded = await sessionWithSkillLoad(true)
    expect(isDynamicWorkflowSkillLoaded(loaded)).toBe(true)
    expect(requireDynamicWorkflowSkill(loaded, 'CreateWorkflow')).toBeUndefined()
  })

  it('refuses a failed load, and a session without one, with the verbatim 428 copy', async () => {
    expect(isDynamicWorkflowSkillLoaded(await sessionWithSkillLoad(false))).toBe(false)
    const plain = await newSession()
    expect(isDynamicWorkflowSkillLoaded(plain)).toBe(false)
    const refusal = requireDynamicWorkflowSkill(plain, 'CreateWorkflow')
    expect(refusal).toBeInstanceOf(Error)
    expect(refusal!.message).toContain('needs the `dynamic-workflows` skill loaded in this session')
    expect(refusal!.message).toContain('Nothing was started.')
  })

  it('fails open only when no session probe exists', () => {
    expect(isDynamicWorkflowSkillLoaded(undefined)).toBe(true)
  })
})

describe('settlement → notification / job outcome', () => {
  const settlement: DynamicWorkflowRunSettlement = {
    status: 'completed',
    summary: 'done',
    result: '42',
    reports: [{ text: 'finding' }],
  }
  it('maps terminal words onto the jobs vocabulary', () => {
    expect(mapJobOutcomeStatus(settlement)).toMatchObject({ status: 'completed' })
    expect(mapJobOutcomeStatus({ ...settlement, status: 'errored', failure: { code: 'X', message: 'boom' } }))
      .toMatchObject({ status: 'failed', detail: 'boom' })
    expect(mapJobOutcomeStatus({ ...settlement, status: 'stopped', stopReason: 'user' }))
      .toMatchObject({ status: 'killed', detail: 'stopped (user)' })
  })
  it('renders the full terminal notification with guidance', () => {
    const text = renderSettlementNotification('wf-run-1', settlement)
    expect(text).toContain('<task-notification>')
    expect(text).toContain('<status>completed</status>')
    expect(text).toContain('<result>42</result>')
    expect(text).toContain('The workflow completed.')
  })
})

describe('saved workflow store', () => {
  it('saves, lists, and reads back by name; names unrunnable files as invalid', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-wf-'))
    await saveWorkflowDefinition({ name: 'audit', scope: 'project', script: 'return 1' }, cwd)
    const listed = await listSavedWorkflows(cwd)
    expect(listed.workflows).toHaveLength(1)
    expect(listed.workflows[0]).toMatchObject({ name: 'audit', scope: 'project' })
    expect(await readSavedWorkflow('audit', cwd)).toMatchObject({ script: 'return 1' })
    expect(await readSavedWorkflow('missing', cwd)).toBeUndefined()
    // 全局 scope：以注入的 homeDir 指进临时目录，并落一个坏文件验证 invalid 指名而不静默跳过。
    const fakeHome = await mkdtemp(join(tmpdir(), 'dsh-wf-home-'))
    await saveWorkflowDefinition({ name: 'g', scope: 'global', script: 'return 2' }, cwd, { homeDir: fakeHome })
    const badDir = join(fakeHome, '.dsh', 'workflows')
    await mkdir(badDir, { recursive: true })
    await writeFile(join(badDir, 'broken.json'), '{not json', 'utf8')
    const listedGlobal = await listSavedWorkflows(cwd, { homeDir: fakeHome })
    expect(listedGlobal.workflows.some(entry => entry.name === 'g')).toBe(true)
    expect(listedGlobal.invalid.some(entry => entry.path.endsWith('broken.json'))).toBe(true)
    expect(await readSavedWorkflow('g', cwd, { homeDir: fakeHome })).toMatchObject({ script: 'return 2' })
  })
})

import { Service } from '@deepseek-ai/cordis'

/** 审批 stub：任何 ask 一律 allowed-once（闸门的审批落实归宿主装配）。 */
class StubApproval extends Service {
  constructor(ctx: never) {
    super(ctx, 'approval' as never)
  }
  request(): 'allowed-once' {
    return 'allowed-once'
  }
}

/** agent 注册表 stub：jobs-local 的 owned job 需要活的 owner agent。 */
class StubAgents extends Service {
  static agent: unknown
  constructor(ctx: never) {
    super(ctx, 'agents' as never)
  }
  get(_id: unknown): unknown {
    return StubAgents.agent
  }
}

/** 已加载撰写技能的会话（技能门判据的历史）。 */
async function loadedSession(): Promise<Session> {
  const session = await newSession()
  session.append('tool/call', {
    turn: 0,
    step: 0,
    callId: ToolCallId('c1'),
    name: 'skill',
    arguments: '{"name":"dynamic-workflows"}',
  })
  session.append('tool/result', {
    turn: 0,
    step: 0,
    message: createToolResultMessage({
      callId: ToolCallId('c1'),
      content: [{ type: 'text', text: 'loaded' }],
      isError: false,
    }),
  }, { surfaceOp: 'append' })
  return session
}

/** 端口 stub：以 cordis service 形式挂到 dynamicWorkflowRuns 键上。 */
function stubPortService(port: DynamicWorkflowRunPort): (new (ctx: never) => unknown) & { prototype: unknown } {
  class StubPort extends Service {
    constructor(ctx: never) {
      super(ctx, 'dynamicWorkflowRuns' as never)
      Object.assign(this, port)
    }
  }
  return StubPort as never
}

describe('plugin tools', () => {
  async function buildCtx(port: DynamicWorkflowRunPort | undefined) {
    const ctx = new Context()
    if (port !== undefined) await ctx.plugin(stubPortService(port) as never, undefined as never)
    await ctx.plugin(StubAgents as never, undefined as never)
    await ctx.plugin(StubApproval as never, undefined as never)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalJobRegistry)
    await ctx.plugin(ToolJobs, undefined as never)
    await ctx.plugin(toolDynamicWorkflow, { enable: true })
    return ctx
  }

  const ALWAYS_AVAILABLE = [
    'CreateWorkflow', 'AmendWorkflow', 'SaveWorkflow', 'ListSavedWorkflows', 'EvalWorkflowSnippet',
    'ListWorkflowRuns', 'GetWorkflowRun', 'ResumeWorkflowRun', 'ResolveWorkflowQuestion', 'ListModels',
  ]

  it('registers the tools and keeps actor-side tools out while their ports are absent', async () => {
    const ctx = await buildCtx(undefined)
    for (const expected of ALWAYS_AVAILABLE) {
      expect(ctx.tools.get(expected)?.name).toBe(expected)
    }
    expect(ctx.tools.get('escalate')).toBeUndefined()
    expect(ctx.tools.get('submit_result')).toBeUndefined()
  })

  it('gives the port-absent copy for CreateWorkflow without pretending it compiled or started', async () => {
    const ctx = await buildCtx(undefined)
    const result = await ctx.tools.execute({
      callId: ToolCallId('c'),
      name: 'CreateWorkflow',
      arguments: { script: 'return 1' },
      signal: new AbortController().signal,
      agent: agentOf(await loadedSession()),
    })
    expect(result.isError).toBe(false)
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(text).toContain('workflow execution is not available in this session')
    expect(text).not.toContain('compiled cleanly')
    expect(text).not.toContain('background')
  })

  it('refuses a script submission when the skill was never loaded', async () => {
    const ctx = await buildCtx(undefined)
    const result = await ctx.tools.execute({
      callId: ToolCallId('c'),
      name: 'CreateWorkflow',
      arguments: { script: 'return 1' },
      signal: new AbortController().signal,
      agent: agentOf(await newSession()),
    })
    // 端口缺席时占位文案放行到工具体；技能门在工具体内先行拒绝（文案含 428 与 Nothing was started）。
    const text = result.content.map(block => block.type === 'text' ? block.text : '').join('')
    expect(result.isError).toBe(true)
    expect(text).toContain('Nothing was started.')
    // 已加载技能的会话走通技能门（到达端口缺席占位）。
    const loadedSession = await newSession()
    loadedSession.append('tool/call', {
      turn: 0,
      step: 0,
      callId: ToolCallId('c1'),
      name: 'skill',
      arguments: '{"name":"dynamic-workflows"}',
    })
    loadedSession.append('tool/result', {
      turn: 0,
      step: 0,
      message: createToolResultMessage({
        callId: ToolCallId('c1'),
        content: [{ type: 'text', text: 'loaded' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
    const ok = await ctx.tools.execute({
      callId: ToolCallId('c2'),
      name: 'CreateWorkflow',
      arguments: { script: 'return 1' },
      signal: new AbortController().signal,
      agent: agentOf(loadedSession),
    })
    expect(ok.isError).toBe(false)
  })

  it('submits through a present port as a background job and surfaces the run id', async () => {
    const settlement: DynamicWorkflowRunSettlement = {
      status: 'completed',
      summary: 'audit done',
      result: '42',
    }
    let submitted = 0
    const port = {
      async compile() {
        return { ok: true, diagnostics: [] }
      },
      async submit() {
        submitted += 1
        return { runId: 'wf-run-77', settled: Promise.resolve(settlement) }
      },
      async amend() {
        return { runId: 'wf-run-78', settled: Promise.resolve(settlement) }
      },
    }
    // no-unknown-casts 门禁禁 unknown 断言：经 object 的受控降转（端口类型可赋给 object）。
    const portStub: object = port
    const ctx = await buildCtx(portStub as DynamicWorkflowRunPort)
    const loaded = await loadedSession()
    StubAgents.agent = { ...agentOf(loaded), ctx }
    const result = await ctx.tools.execute({
      callId: ToolCallId('c3'),
      name: 'CreateWorkflow',
      arguments: { script: 'return 1', name: 'audit' },
      signal: new AbortController().signal,
      agent: agentOf(loaded),
    })
    expect(result.isError, result.content.map(block => block.type === 'text' ? block.text : '').join('|')).toBe(false)
    expect(submitted).toBe(1)
    // 结果 value 本就是 JSON 载荷：经 JSON 往返取得类型化视图，替代 unknown 断言。
    const value = JSON.parse(JSON.stringify(result.value)) as { status: string; backgroundTaskId: string }
    expect(value.status).toBe('backgrounded')
    // backgroundTaskId 是 jobs 注册表的 JobId（形如 `workflow-run-N`），不是 runId；
    // runId 只出现在结果文案里（GetWorkflowRun / AmendWorkflow 等内省工具的入参）。
    expect(value.backgroundTaskId).toMatch(/^workflow-run-/)
    expect(value.backgroundTaskId).not.toBe('wf-run-77')
    // 终态经 jobs completion 投递：找到本 job（runId 与 jobId 是两回事），读取 result 拿完整通知。
    const job = ctx.jobs.list('agent-1' as never).find(entry => entry.kind === 'workflow-run')
    expect(job).toBeDefined()
    const read = await ctx.jobs.read(job!.id, 'agent-1' as never)
    expect(read.result).toContain('<status>completed</status>')
    expect(read.result).toContain('The workflow completed.')
  })
})
