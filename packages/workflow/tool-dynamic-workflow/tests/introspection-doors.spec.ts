/**
 * 工具注册与提示词装配深测（补充 tool-dynamic-workflow.spec / writing-doors.spec 的缺口）：
 * 内省簇（ListWorkflowRuns / GetWorkflowRun / ListModels）、ResumeWorkflowRun 的
 * errorCode 分支、ResolveWorkflowQuestion 的透传语义，以及 actor 侧 escalate /
 * submit_result 的端口门与结果形态。块序契约按 spec-conversation-flow §九逐块断言。
 */
import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import {
  createGetWorkflowRunTool,
  createListModelsTool,
  createListWorkflowRunsTool,
  createResolveWorkflowQuestionTool,
  createResumeWorkflowRunTool,
  resumeFailureFor,
} from '../src/tools/introspection.ts'
import { createEscalateTool, createSubmitResultTool, actorToolFactories } from '../src/tools/actor.ts'
import type {
  DynamicWorkflowRunDetail,
  DynamicWorkflowRunPort,
  WorkflowEscalatePort,
  WorkflowSubmitResultPort,
} from '../src/port.ts'

/** 最小 ctx 假面：工具工厂只用 ctx.get(key)。 */
function ctxWith(services: Record<string, unknown>): Context {
  // no-unknown-casts 门禁禁 unknown 断言：经 object 的受控降转（Context 可赋给 object）。
  const stub: object = { get: (key: string) => services[key] }
  return stub as Context
}

/** 最小 exec 假面：内省工具只读 name / callId / signal / agent.session.header。 */
function execOf(name: string, options?: { subagent?: boolean }): never {
  return {
    name,
    callId: 'c1',
    signal: new AbortController().signal,
    agent: {
      session: {
        header: { origin: options?.subagent === true ? 'subagent' : 'main', cwd: 'C:/tmp/proj' },
      },
    },
  } as never
}

function portWith(partial: Partial<DynamicWorkflowRunPort>): DynamicWorkflowRunPort {
  return partial as DynamicWorkflowRunPort
}

function textOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

describe('GetWorkflowRun：块序契约', () => {
  const detail: DynamicWorkflowRunDetail = {
    runId: 'wf-run-1',
    label: 'audit',
    status: 'stopped',
    stopReason: 'user',
    resumedFrom: 'wf-run-0',
    ownedByThisSession: true,
    summary: '审计进行到一半',
    pendingQuestions: [
      { questionId: 'dwfq-1', actor: 'siteId@3', actorName: 'explorer', question: 'Which db?' },
    ],
    logTail: ['step 1 <ok>', 'step 2 done'],
    error: { code: 'ChildStop', message: 'subagent crashed' },
    artifacts: [
      { id: 'art-1', kind: 'report', version: 2, title: 'Findings', itemCount: 3, primary: true },
    ],
    usage: { durationMs: 1200, totalTokens: 5400 },
    scriptPath: 'C:/tmp/proj/.dsh/workflows/audit.ts',
  }

  it('块按 summary → 身份 → 停驻问题 → 生命线 → 收场 → 路由 的顺序出现', async () => {
    const tool = createGetWorkflowRunTool(
      ctxWith({ dynamicWorkflowRuns: portWith({ getRunDetail: async () => detail }) }),
    )
    const { response } = (await tool.execute({ run_id: 'wf-run-1' }, execOf('GetWorkflowRun'))) as {
      response: string
    }
    const order = [
      '<summary>审计进行到一半</summary>',
      '<run_id>wf-run-1</run_id>',
      '<status>stopped</status>',
      '<stop-reason>user</stop-reason>',
      '<resumed_from>wf-run-0</resumed_from>',
      '[dwfq-1] explorer: Which db?',
      '<log_tail>',
      'step 1 &lt;ok&gt;',
      '<error>subagent crashed</error>',
      '<artifacts>',
      '- art-1 (report, primary, v2, 3 items): Findings',
      '<usage>total_tokens=5400 duration_ms=1200</usage>',
      '<script_path>',
    ].map(marker => response.indexOf(marker))
    expect(order.every(index => index >= 0)).toBe(true)
    const sorted = [...order].sort((a, b) => a - b)
    expect(order).toEqual(sorted)
    // 终态路由引导在工具描述里（GetWorkflowRun 的模型面契约）
    expect(tool.description).toContain('ResumeWorkflowRun')
    expect(tool.description).toContain('superseded')
  })

  it('pendingQuestions 缺席走 Unknown 分支：明说只有进程自己知道，不冒充「没有人在等」', async () => {
    const tool = createGetWorkflowRunTool(
      ctxWith({
        dynamicWorkflowRuns: portWith({
          // exactOptionalPropertyTypes 下无法显式写 undefined，用解构删键表达「缺席」
          getRunDetail: async () => {
            const { pendingQuestions: _omitted, ...rest } = detail
            return rest
          },
        }),
      }),
    )
    const { response } = (await tool.execute({ run_id: 'wf-run-1' }, execOf('GetWorkflowRun'))) as {
      response: string
    }
    expect(response).toContain('<pending_questions>Unknown:')
  })

  it('未知 run：run_not_found 并引导 ListWorkflowRuns，而不是回空态', async () => {
    const tool = createGetWorkflowRunTool(
      ctxWith({ dynamicWorkflowRuns: portWith({ getRunDetail: async () => undefined }) }),
    )
    await expect(
      tool.execute({ run_id: 'missing' }, execOf('GetWorkflowRun')),
    ).rejects.toThrow('run_not_found')
  })

  it('端口缺席：workflow_introspection_unavailable（能力缺口，不是空项目）', async () => {
    const tool = createGetWorkflowRunTool(ctxWith({}))
    await expect(tool.execute({ run_id: 'x' }, execOf('GetWorkflowRun'))).rejects.toThrow(
      'workflow_introspection_unavailable',
    )
  })
})

describe('ListWorkflowRuns：行字段与过滤', () => {
  const runs = [
    { runId: 'r1', label: 'a', status: 'completed', ownedByThisSession: true },
    {
      runId: 'r2',
      label: 'b',
      status: 'stopped',
      stopReason: 'superseded',
      supersededBy: 'r3',
      ownedByThisSession: false,
      possiblyInterrupted: true as const,
    },
  ]

  it('行带 stop_reason / superseded_by / possibly_interrupted 注解段；status 过滤生效', async () => {
    const tool = createListWorkflowRunsTool(
      ctxWith({ dynamicWorkflowRuns: portWith({ listRuns: async () => runs }) }),
    )
    const { response } = (await tool.execute(
      { status: 'stopped' },
      execOf('ListWorkflowRuns'),
    )) as { response: string }
    expect(response).toContain('r2')
    expect(response).toContain('stop_reason=superseded')
    expect(response).toContain('superseded_by=r3')
    expect(response).toContain('possibly_interrupted=true')
    expect(response).toContain('annotation, not a verdict')
    expect(response).not.toContain('- r1')
  })

  it('空列表回「No workflow runs」而端口缺席回能力错误——两者不可混', async () => {
    const empty = createListWorkflowRunsTool(
      ctxWith({ dynamicWorkflowRuns: portWith({ listRuns: async () => [] }) }),
    )
    const { response } = (await empty.execute({}, execOf('ListWorkflowRuns'))) as {
      response: string
    }
    expect(response).toContain('No workflow runs for this project.')
    const absent = createListWorkflowRunsTool(ctxWith({}))
    await expect(absent.execute({}, execOf('ListWorkflowRuns'))).rejects.toThrow(
      'workflow_introspection_unavailable',
    )
  })
})

describe('ResumeWorkflowRun：errorCode 分支与成功文案', () => {
  it('resumeFailureFor 七个稳定前缀逐支可判别', () => {
    expect(textOf(resumeFailureFor('superseded', 'r9', undefined, undefined))).toContain(
      'workflow_run_superseded: run r9',
    )
    expect(textOf(resumeFailureFor('not_resumable', 'r9', undefined, undefined))).toContain(
      'workflow_run_not_resumable',
    )
    expect(textOf(resumeFailureFor('already_running', 'r9', undefined, undefined))).toContain(
      'workflow_run_already_running',
    )
    expect(textOf(resumeFailureFor('script_missing', 'r9', undefined, undefined))).toContain(
      'workflow_run_script_missing',
    )
    expect(textOf(resumeFailureFor('script_mismatch', 'r9', undefined, undefined))).toContain(
      'workflow_run_script_mismatch',
    )
    expect(textOf(resumeFailureFor('compile_failed', 'r9', undefined, undefined))).toContain(
      'workflow_run_compile_failed',
    )
    expect(textOf(resumeFailureFor('not_found', 'r9', undefined, undefined))).toContain(
      'run_not_found',
    )
    // 未知 reason：服务端 message 优先透传
    expect(textOf(resumeFailureFor('weird', 'r9', undefined, 'server says no'))).toBe(
      'server says no',
    )
    // detail 附加行
    expect(textOf(resumeFailureFor('compile_failed', 'r9', 'line 3 boom', undefined))).toContain(
      'line 3 boom',
    )
  })

  it('成功：backgrounded 文案与 backgroundTaskId；失败：superseded 拒绝并指向后继', async () => {
    const tool = createResumeWorkflowRunTool(
      ctxWith({
        dynamicWorkflowRuns: portWith({
          resumeRun: async runId =>
            runId === 'ok-run' ? { ok: true as const, runId } : { ok: false as const, reason: 'superseded' as const },
        }),
      }),
    )
    const ok = (await tool.execute({ run_id: 'ok-run' }, execOf('ResumeWorkflowRun'))) as {
      response: string
      status: 'backgrounded'
      backgroundTaskId: string
    }
    expect(ok.status).toBe('backgrounded')
    expect(ok.backgroundTaskId).toBe('ok-run')
    expect(ok.response).toContain('resumed in the background')
    expect(ok.response).toContain('Do not wait for it or poll it')
    await expect(tool.execute({ run_id: 'old-run' }, execOf('ResumeWorkflowRun'))).rejects.toThrow(
      'workflow_run_superseded: run old-run',
    )
  })

  it('端口缺席回能力缺口文案；子代理会话直接拒绝', async () => {
    const absent = createResumeWorkflowRunTool(ctxWith({}))
    await expect(absent.execute({ run_id: 'x' }, execOf('ResumeWorkflowRun'))).rejects.toThrow(
      'workflow_resume_unavailable',
    )
    const withPort = createResumeWorkflowRunTool(
      ctxWith({ dynamicWorkflowRuns: portWith({ resumeRun: async () => ({ ok: true, runId: 'x' }) }) }),
    )
    await expect(
      withPort.execute({ run_id: 'x' }, execOf('ResumeWorkflowRun', { subagent: true })),
    ).rejects.toThrow(/child|subagent|disallowed|not allowed/i)
  })
})

describe('ResolveWorkflowQuestion：透传与续跑语义', () => {
  it('成功回执点名 qid 且说明 run 继续跑；失败把服务端 message 原样透传', async () => {
    const tool = createResolveWorkflowQuestionTool(
      ctxWith({
        dynamicWorkflowRuns: portWith({
          resolveQuestion: async questionId =>
            questionId === 'dwfq-1'
              ? { ok: true as const, qid: questionId }
              : { ok: false as const, reason: 'unknown_question' as const, message: `no such question ${questionId}` },
        }),
      }),
    )
    const ok = (await tool.execute(
      { question_id: 'dwfq-1', answer: 'postgres' },
      execOf('ResolveWorkflowQuestion'),
    )) as { response: string }
    expect(ok.response).toContain('Answer delivered for question dwfq-1')
    expect(ok.response).toContain('keeps going')
    await expect(
      tool.execute({ question_id: 'dwfq-404', answer: 'x' }, execOf('ResolveWorkflowQuestion')),
    ).rejects.toThrow('no such question dwfq-404')
  })

  it('子代理不可作答；端口缺席回能力缺口', async () => {
    const tool = createResolveWorkflowQuestionTool(ctxWith({ dynamicWorkflowRuns: portWith({}) }))
    await expect(
      tool.execute(
        { question_id: 'q', answer: 'a' },
        execOf('ResolveWorkflowQuestion', { subagent: true }),
      ),
    ).rejects.toThrow(/child|subagent|disallowed|not allowed/i)
    const absent = createResolveWorkflowQuestionTool(ctxWith({}))
    await expect(
      absent.execute({ question_id: 'q', answer: 'a' }, execOf('ResolveWorkflowQuestion')),
    ).rejects.toThrow('workflow_question_answering_unavailable')
  })
})

describe('ListModels：选型行渲染', () => {
  it('disabled 标记、label 与 reasoning levels 进行；空表回专句', async () => {
    const tool = createListModelsTool(
      ctxWith({
        dynamicWorkflowRuns: portWith({
          listModels: async () => [
            { id: 'prov/a', providerId: 'prov', label: 'Alpha', reasoningLevels: ['low', 'high'] },
            { id: 'prov/b', providerId: 'prov', disabled: true },
          ],
        }),
      }),
    )
    const { response } = (await tool.execute({}, execOf('ListModels'))) as { response: string }
    expect(response).toContain('- prov/a — Alpha (reasoning levels: low, high)')
    expect(response).toContain('- prov/b [disabled]')
    const empty = createListModelsTool(
      ctxWith({ dynamicWorkflowRuns: portWith({ listModels: async () => [] }) }),
    )
    const emptyResponse = (await empty.execute({}, execOf('ListModels'))) as { response: string }
    expect(emptyResponse.response).toContain('No models are configured')
  })
})

describe('actor 侧工具：escalate / submit_result', () => {
  it('escalate：answered 是普通结果（answer 原样），refused 透传端口文案且非错误', async () => {
    const port: WorkflowEscalatePort = {
      escalate: async request =>
        request.question === 'q1'
          ? { kind: 'answered', answer: 'use postgres', qid: 'dwfq-9' }
          : { kind: 'refused', message: 'budget spent; proceed on your own', reason: 'budget_exhausted' },
    }
    const tool = createEscalateTool(ctxWith({ workflowEscalate: port }))
    const answered = (await tool.execute(
      { question: 'q1', context: 'tried x' },
      execOf('escalate'),
    )) as { status: string; message: string; qid: string }
    expect(answered).toEqual({ status: 'answered', message: 'use postgres', qid: 'dwfq-9' })
    const refused = (await tool.execute({ question: 'q2' }, execOf('escalate'))) as {
      status: string
      message: string
    }
    expect(refused.status).toBe('refused')
    expect(refused.message).toBe('budget spent; proceed on your own')
  })

  it('escalate 端口缺席：明确「这不是 workflow actor 会话」，绝不静默成功', async () => {
    const tool = createEscalateTool(ctxWith({}))
    await expect(tool.execute({ question: 'q' }, execOf('escalate'))).rejects.toThrow(
      'not configured for escalate',
    )
  })

  it('submit_result：accepted 回完成句，rejected 回端口 message；缺席抛配置错误', async () => {
    const port: WorkflowSubmitResultPort = {
      submitResult: async request =>
        request.outcome === 'success'
          ? { accepted: true }
          : { accepted: false, message: 'reject without error text is not actionable' },
    }
    const tool = createSubmitResultTool(ctxWith({ workflowSubmitResult: port }))
    const ok = (await tool.execute(
      { outcome: 'success', result: { answer: 42 } },
      execOf('submit_result'),
    )) as { response: string }
    expect(ok.response).toContain('Result submitted')
    const rejected = (await tool.execute(
      { outcome: 'reject', error: 'impossible' },
      execOf('submit_result'),
    )) as { response: string }
    expect(rejected.response).toContain('not actionable')
    const absent = createSubmitResultTool(ctxWith({}))
    await expect(
      absent.execute({ outcome: 'success' }, execOf('submit_result')),
    ).rejects.toThrow('not configured for submit_result')
  })

  it('actorToolFactories：端口缺席注册空集，双端口在场注册恰两个', () => {
    expect(actorToolFactories(ctxWith({})).map(factory => factory().name)).toEqual([])
    const both = actorToolFactories(
      ctxWith({ workflowEscalate: {}, workflowSubmitResult: {} }),
    ).map(factory => factory().name)
    expect(both).toEqual(['escalate', 'submit_result'])
  })
})
