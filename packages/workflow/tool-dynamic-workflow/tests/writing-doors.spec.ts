/**
 * 写作工具簇的门次序与装配细节测试（spec-conversation-flow §3/§9 的补充验收，
 * 与 tool-dynamic-workflow.spec.ts 的插件级闭环互补，这里直接驱动 defineTool 的 execute）：
 * - 门次序：技能门先于来源解析与子代理判据的相对次序；
 * - 来源解析：CreateWorkflow 单一来源、saved.name 必填、Amend path/script 互斥；
 * - 草稿落盘：内联脚本无论编译成败都写草稿文件；
 * - 提示词装配：并发上界句、子代理模型句、路由纪律原文。
 */
import { describe, expect, it } from 'vitest'
import { mkdtemp } from 'node:fs/promises'
import { saveWorkflowDefinition } from '../src/saved-store.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import {
  COMPILER_UNAVAILABLE_NOTE,
  DIAGNOSTICS_NOT_EXECUTED_NOTE,
  SAVED_FILE_NOT_EXECUTED_NOTE,
  createAmendWorkflowTool,
  createCreateWorkflowTool,
  createEvalWorkflowSnippetTool,
  createSaveWorkflowTool,
  describeWorkflowConcurrencyLimit,
} from '../src/tools/writing.ts'
import { CHILD_DISALLOWED_TOOLS, childDisallowedError } from '../src/child-disallowed.ts'
import { createWorkflowNeedsSkill, amendWorkflowNeedsSkill } from '../src/skill-gate.ts'

let sessionCounter = 0

async function newSession(options?: {
  cwd?: string
  origin?: string
  withSkill?: boolean
}): Promise<Session> {
  sessionCounter += 1
  const cwd = options?.cwd ?? await mkdtemp(join(tmpdir(), 'dsh-wf-doors-'))
  const session = Session.create(SessionId(`s-doors-${sessionCounter}`), [], {
    version: 4,
    id: SessionId(`s-doors-${sessionCounter}`),
    createdAt: 0,
    isSeeded: false,
    cwd,
    ...(options?.origin === undefined ? {} : { origin: options.origin }),
  } as never)
  if (options?.withSkill === true) {
    session.append('tool/call', {
      turn: 0,
      step: 0,
      callId: ToolCallId(`load-${sessionCounter}`),
      name: 'skill',
      arguments: '{"name":"dynamic-workflows"}',
    })
    session.append('tool/result', {
      turn: 0,
      step: 0,
      message: createToolResultMessage({
        callId: ToolCallId(`load-${sessionCounter}`),
        content: [{ type: 'text', text: 'loaded' }],
        isError: false,
      }),
    }, { surfaceOp: 'append' })
  }
  return session
}

function execOf(session: Session, name: string): ToolRunContext {
  // no-unknown-casts 门禁禁 unknown 断言：经 object 的受控降转（目标类型可赋给 object）。
  const agent: object = { id: 'agent-1', session }
  const exec: object = {
    agent,
    callId: ToolCallId(`call-${session.id}`),
    name,
    signal: new AbortController().signal,
  }
  return exec as ToolRunContext
}

function stubPort(port: unknown): Context {
  // 以 cordis service 形式把端口挂到 dynamicWorkflowRuns 键上（与插件装配同名）。
  class StubPort extends Service {
    constructor(ctx: never) {
      super(ctx, 'dynamicWorkflowRuns' as never)
      Object.assign(this, port)
    }
  }
  const ctx = new Context()
  void ctx.plugin(StubPort as never, undefined as never)
  return ctx
}

describe('工具注册清单', () => {
  it('child 禁用名单恰为四个执行语义工具，只读内省不在列', () => {
    expect([...CHILD_DISALLOWED_TOOLS].sort()).toEqual([
      'AmendWorkflow',
      'CreateWorkflow',
      'EvalWorkflowSnippet',
      'ResumeWorkflowRun',
    ])
    expect(childDisallowedError('CreateWorkflow').message).toContain(
      'Read-only introspection tools (ListWorkflowRuns, GetWorkflowRun) remain available.',
    )
  })

  it('CreateWorkflow 的技能门例外仅限 saved-only；AmendWorkflow 仅 settings-only 免门', () => {
    expect(createWorkflowNeedsSkill({ saved: { name: 'x' } })).toBe(false)
    expect(createWorkflowNeedsSkill({ saved: { name: 'x' }, script: 'y' })).toBe(true)
    expect(createWorkflowNeedsSkill({ path: 'p' })).toBe(true)
    expect(amendWorkflowNeedsSkill({ max_concurrency: 2 })).toBe(false)
    expect(amendWorkflowNeedsSkill({ script: 'x' })).toBe(true)
    expect(amendWorkflowNeedsSkill({ path: 'p' })).toBe(true)
  })
})

describe('CreateWorkflow 门次序与来源解析', () => {
  const ctx = stubPort({})

  it('门先于解析：未加载技能且来源非法时，回技能门拒绝而非来源错误', async () => {
    const tool = createCreateWorkflowTool(ctx)
    await expect(
      tool.execute({ path: 'a', script: 'b' }, execOf(await newSession(), 'CreateWorkflow')),
    ).rejects.toThrow(/Nothing was started/)
  })

  it('多来源被拒（script + path 同时给出）', async () => {
    const tool = createCreateWorkflowTool(ctx)
    await expect(
      tool.execute(
        { path: 'a', script: 'b' },
        execOf(await newSession({ withSkill: true }), 'CreateWorkflow'),
      ),
    ).rejects.toThrow('CreateWorkflow takes exactly one source: `script`, `saved`, or `path`.')
  })

  it('saved-only 免技能门，但 saved.name 缺失仍被拒', async () => {
    const tool = createCreateWorkflowTool(ctx)
    // saved.name 是参数 schema 的 required 字段：入参校验先于工具体拒绝
    await expect(
      tool.execute({ saved: {} }, execOf(await newSession(), 'CreateWorkflow')),
    ).rejects.toThrow(/invalid arguments/)
    await expect(
      tool.execute(
        { saved: { name: 'missing' } },
        execOf(await newSession(), 'CreateWorkflow'),
      ),
    ).rejects.toThrow(/no saved workflow named "missing"/)
  })

  it('子代理会话里调用 CreateWorkflow 直接拒绝（先于技能门）', async () => {
    const tool = createCreateWorkflowTool(ctx)
    await expect(
      tool.execute(
        { script: 'x' },
        execOf(await newSession({ origin: 'subagent' }), 'CreateWorkflow'),
      ),
    ).rejects.toThrow(/CreateWorkflow is not available to subagents/)
  })

  it('编译失败：ok:false 回诊断与 NOTE，草稿文件已先落盘（唯一必经的编辑目标在盘上）', async () => {
    const ctxWithCompiler = stubPort({
      compile: async (scriptText: string) => ({
        diagnostics: [{ message: `bad near "${scriptText}"` }],
        ok: false,
      }),
    })
    const tool = createCreateWorkflowTool(ctxWithCompiler)
    const session = await newSession({ withSkill: true })
    const result = (await tool.execute({ script: 'broken' }, execOf(session, 'CreateWorkflow'))) as {
      diagnostics: unknown[]
      ok: boolean
      response: string
    }
    expect(result.ok).toBe(false)
    expect(result.diagnostics).toHaveLength(1)
    expect(result.response).toContain('The workflow script has errors:')
    // 有草稿文件时 NOTE 点名文件位置（DIAGNOSTICS_NOT_EXECUTED_NOTE 只用于无文件形态）
    expect(result.response).toContain('NOTE: The workflow was NOT executed.')
    expect(result.response).toContain('The script is saved at')
    expect(result.response).toContain('.dsh/workflow-drafts/')
    // 草稿确实写在会话 cwd 下
    const { readFile } = await import('node:fs/promises')
    const draftMatch = result.response.match(/\.dsh\/workflow-drafts\/[^\s)]+\.ts/)
    expect(draftMatch).not.toBeNull()
    const draftPath = join(session.header.cwd ?? process.cwd(), draftMatch![0]!)
    expect(await readFile(draftPath, 'utf8')).toBe('broken')
  })

  it('saved 定义编译失败时点名 saved 文件而非草稿', async () => {
    const ctxWithCompiler = stubPort({
      compile: async () => ({ diagnostics: [], ok: false }),
    })
    const cwd = await mkdtemp(join(tmpdir(), 'dsh-wf-doors-saved-'))
    await saveWorkflowDefinition({ name: 'broken-saved', scope: 'project', script: 'broken' }, cwd)
    const tool = createCreateWorkflowTool(ctxWithCompiler)
    const result = (await tool.execute(
      { saved: { name: 'broken-saved' } },
      execOf(await newSession({ cwd, withSkill: true }), 'CreateWorkflow'),
    )) as { ok: boolean; response: string }
    expect(result.ok).toBe(false)
    // saved 来源且定义文件在盘：头部点名 saved 文件位置，NOTE 指向改定义本身
    expect(result.response).toContain("The saved workflow 'broken-saved' (")
    expect(result.response).toContain('.dsh/workflows/broken-saved.json) has errors:')
    expect(result.response).toContain(SAVED_FILE_NOT_EXECUTED_NOTE)
    expect(result.response).not.toContain(DIAGNOSTICS_NOT_EXECUTED_NOTE)
  })

  it('端口缺席时占位文案如实说明没有执行能力，也不谎称编译过', async () => {
    const tool = createCreateWorkflowTool(new Context())
    const result = (await tool.execute(
      { script: 'x' },
      execOf(await newSession({ withSkill: true }), 'CreateWorkflow'),
    )) as { ok: boolean; response: string }
    expect(result.ok).toBe(true)
    expect(result.response).toContain('workflow execution is not available in this session')
    expect(result.response).toContain('was only typechecked')
    expect(result.response).not.toContain('compiled cleanly')
  })

  it('没有编译器时回 COMPILER_UNAVAILABLE_NOTE（一期如实降级）', async () => {
    const tool = createCreateWorkflowTool(stubPort({}))
    const result = (await tool.execute(
      { script: 'x' },
      execOf(await newSession({ withSkill: true }), 'CreateWorkflow'),
    )) as { ok: boolean; response: string }
    expect(result.ok).toBe(true)
    expect(result.response).toContain('No workflow compiler is available')
    expect(result.response).toContain(COMPILER_UNAVAILABLE_NOTE)
  })
})

describe('AmendWorkflow / SaveWorkflow / EvalWorkflowSnippet 门', () => {
  it('AmendWorkflow path+script 同时给出被拒（端口在场、技能已加载的前提下）', async () => {
    const tool = createAmendWorkflowTool(stubPort({ amend: async () => ({}) as never }))
    await expect(
      tool.execute(
        { path: 'a.ts', run_id: 'r1', script: 'x' },
        execOf(await newSession({ withSkill: true }), 'AmendWorkflow'),
      ),
    ).rejects.toThrow('AmendWorkflow takes `path` or `script`, never both.')
  })

  it('AmendWorkflow 端口缺席如实报能力缺口（不是 bad run id）', async () => {
    const tool = createAmendWorkflowTool(new Context())
    await expect(
      tool.execute(
        { max_concurrency: 2, run_id: 'r1' },
        execOf(await newSession(), 'AmendWorkflow'),
      ),
    ).rejects.toThrow(/This is a capability gap, not a bad run ID/)
  })

  it('SaveWorkflow 未加载技能拒绝；加载后 script 与 script_path 互斥', async () => {
    const tool = createSaveWorkflowTool()
    await expect(
      tool.execute(
        { name: 'x', scope: 'project', script: 'y' },
        execOf(await newSession(), 'SaveWorkflow'),
      ),
    ).rejects.toThrow(/Nothing was started/)
    await expect(
      tool.execute(
        { name: 'x', scope: 'project', script: 'y', script_path: 'z.ts' },
        execOf(await newSession({ withSkill: true }), 'SaveWorkflow'),
      ),
    ).rejects.toThrow('SaveWorkflow takes `script` or `script_path`, never both.')
    await expect(
      tool.execute({ name: 'x', scope: 'project' }, execOf(await newSession({ withSkill: true }), 'SaveWorkflow')),
    ).rejects.toThrow('SaveWorkflow takes `script` or `script_path`, never neither.')
  })

  it('EvalWorkflowSnippet 端口或 evalSnippet 缺席时报 workflow_snippet_unavailable，绝不静默成功', async () => {
    const absent = createEvalWorkflowSnippetTool(new Context())
    await expect(
      absent.execute(
        { code: '1' },
        execOf(await newSession({ withSkill: true }), 'EvalWorkflowSnippet'),
      ),
    ).rejects.toThrow('workflow_snippet_unavailable')

    const noEval = createEvalWorkflowSnippetTool(stubPort({}))
    await expect(
      noEval.execute(
        { code: '1' },
        execOf(await newSession({ withSkill: true }), 'EvalWorkflowSnippet'),
      ),
    ).rejects.toThrow('workflow_snippet_unavailable')
  })

  it('EvalWorkflowSnippet 走通端口并把结果与失败分开呈现', async () => {
    const ctxWithEval = stubPort({
      evalSnippet: async (code: string) =>
        code === 'throw' ? { error: 'boom', ok: false } : { ok: true, value: 42 },
    })
    const tool = createEvalWorkflowSnippetTool(ctxWithEval)
    const session = await newSession({ withSkill: true })
    const ok = (await tool.execute({ code: '41+1' }, execOf(session, 'EvalWorkflowSnippet'))) as {
      response: string
    }
    expect(ok.response).toContain('Snippet settled.')
    expect(ok.response).toContain('42')
    const bad = (await tool.execute({ code: 'throw' }, execOf(session, 'EvalWorkflowSnippet'))) as {
      response: string
    }
    expect(bad.response).toContain('Snippet failed: boom')
    expect(bad.response).toContain('Nothing was persisted.')
  })
})

describe('结果文案装配（并发上界 / 模型句）', () => {
  it('describeWorkflowConcurrencyLimit 的四态文案', () => {
    expect(describeWorkflowConcurrencyLimit(undefined, undefined)).toBe('')
    expect(describeWorkflowConcurrencyLimit(1, 8)).toBe(' At most 1 subagent runs at once.')
    expect(describeWorkflowConcurrencyLimit(3, 8)).toBe(' At most 3 subagents run at once.')
    expect(describeWorkflowConcurrencyLimit(8, 8)).toBe(
      " At most 8 subagents run at once (this machine's maximum).",
    )
  })
})

describe('工具描述装配（路由纪律原文保真抽查）', () => {
  it('CreateWorkflow 描述带强制路由纪律与三来源、技能门前置', async () => {
    const ctxDescribe = stubPort({})
    const tool = createCreateWorkflowTool(ctxDescribe)
    expect(tool.description).toContain('this tool is mandatory')
    expect(tool.name).toBe('CreateWorkflow')
    expect(tool.description).toContain('`saved`')
    expect(tool.description).toContain('`path`')
    expect(tool.description).toContain('AmendWorkflow instead of starting over')
  })
})
