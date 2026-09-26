// workflow-notifications 的逐字快照测试：通知文案是迁移的逐字基准（spec-conversation-flow
// §4.2/§4.4/§6.2/§6.3/§6.4），这些断言钉住块序、占位与 120k 截断斩序。
import { describe, expect, it } from 'vitest'
import {
  buildWorkflowArtifactsSection,
  escapeXml,
  formatWorkflowEscalationNotification,
  formatWorkflowProviderStopError,
  formatWorkflowStallNotification,
  formatWorkflowTaskNotification,
  truncateTaskNotification,
  workflowDeliveryGuidance,
  WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES,
} from '../src/index.ts'
import type { DynamicWorkflowRunArtifact } from '@deepseek-ai/dsh-workflow-runs'

describe('escapeXml / truncate', () => {
  it('escapes field values fully and block text minimally', () => {
    expect(escapeXml('a<"b\'&c>')).toBe('a&lt;&quot;b&apos;&amp;c&gt;')
    expect(truncateTaskNotification('x'.repeat(120_001))).toBe(
      `${'x'.repeat(120_000)}\n[truncated]`,
    )
    expect(truncateTaskNotification('short')).toBe('short')
  })
})

describe('escalation notification', () => {
  it('casts the verbatim escalation copy with the qid next step', () => {
    const text = formatWorkflowEscalationNotification({
      runLabel: 'audit',
      runId: 'wf-run-1',
      qid: 'dwfq-1',
      actor: 'scout',
      question: 'Which baseline?',
      context: 'two candidates',
    })
    expect(text).toContain('[SYSTEM NOTIFICATION - NOT USER INPUT]')
    expect(text).toContain('<question-id>dwfq-1</question-id>')
    expect(text).toContain(
      'Next step: call ResolveWorkflowQuestion with question_id="dwfq-1" and your answer.',
    )
    expect(text).toContain('nothing times out on its behalf')
    // context 在场才有 <context> 节
    const bare = formatWorkflowEscalationNotification({
      runLabel: 'audit',
      runId: 'r',
      qid: 'q',
      actor: 'a',
      question: 'q?',
    })
    expect(bare).not.toContain('<context>')
  })
})

describe('stall notification', () => {
  it('states no action is needed and renders minutes', () => {
    const text = formatWorkflowStallNotification({
      runLabel: 'audit',
      runId: 'wf-run-1',
      sinceMs: 20 * 60_000,
      reason: 'rate_limited',
      cap: 4,
    })
    expect(text).toContain('<since-ms>1200000</since-ms>')
    expect(text).toContain('<dominant-reason>rate_limited</dominant-reason>')
    expect(text).toContain('has not completed a model request in 20 minutes')
    expect(text).toContain('the provider keeps answering rate_limited')
    expect(text).toContain('(current fan-out 4)')
    expect(text).toContain('Do not cancel or rebuild it on your own.')
  })
})

describe('provider stop error table', () => {
  it('renders the auth branch with the resume call', () => {
    const text = formatWorkflowProviderStopError(
      {
        code: 'ProviderStop',
        message: 'stop',
        providerStop: {
          kind: 'auth',
          reason: 'expired',
          providerId: 'anthropic',
          providerLabel: 'Anthropic',
          modelId: 'm',
          subagent: 's-1',
          phase: 'research',
          providerCode: '401',
        },
      },
      'wf-run-9',
    )
    expect(text).toContain('Sign-in to Anthropic (anthropic) expired while subagent s-1 (phase "research") was running.')
    expect(text).toContain('then call ResumeWorkflowRun with run_id="wf-run-9". Finished steps are kept.')
    expect(text).toContain('provider=anthropic model=m subagent=s-1 phase=research code=401')
  })

  it('renders the quota branch with a reset date', () => {
    const text = formatWorkflowProviderStopError(
      {
        code: 'ProviderStop',
        message: 'stop',
        providerStop: {
          kind: 'quota',
          reason: 'cap',
          providerId: 'p',
          resetAt: Date.UTC(2026, 0, 2),
          providerCode: '429',
        },
      },
      'r',
    )
    expect(text).toContain('usage cap is reached (code 429); it resets at 2026-01-02T00:00:00.000Z')
    expect(text).toContain('Do not rebuild the workflow.')
  })
})

describe('terminal task notification', () => {
  const base = {
    taskId: 'wf-run-1',
    summary: 'done',
    description: 'audit run',
  }

  it('orders blocks summary → result → reports → artifacts and appends guidance last', () => {
    const artifacts: DynamicWorkflowRunArtifact[] = [
      { id: 'board-1', kind: 'board', version: 1, itemCount: 3, primary: true, title: 'Main' },
      { id: 'a', kind: 'markdown', version: 2, bytes: 10 },
    ]
    const text = formatWorkflowTaskNotification({
      ...base,
      status: 'completed',
      result: 'all good',
      reports: [{ text: 'finding one' }],
      artifacts,
      deliveryGuidance: true,
      toolUseId: 'call-1',
    })
    const statusAt = text.indexOf('<status>completed</status>')
    const resultAt = text.indexOf('<result>all good</result>')
    const reportsAt = text.indexOf('<reports count="1" shown="1">')
    const artifactsAt = text.indexOf('<artifacts count="2">')
    const guidanceAt = text.indexOf('The workflow completed.')
    const endAt = text.indexOf('</task-notification>')
    expect(statusAt).toBeGreaterThan(-1)
    expect(resultAt).toBeGreaterThan(statusAt)
    expect(reportsAt).toBeGreaterThan(resultAt)
    expect(artifactsAt).toBeGreaterThan(reportsAt)
    expect(endAt).toBeGreaterThan(artifactsAt)
    expect(guidanceAt).toBeGreaterThan(endAt)
    // primary 带头
    expect(text).toContain('- board-1 (board, primary, v1, 3 items): Main')
    expect(text).toContain('- a (markdown, v2, 10 bytes)')
    // 产物纪律句只在 <artifacts> 在场时出现
    expect(text).toContain('refer to them by title and do not paste their contents')
  })

  it('omits the artifacts sentence when no artifacts exist', () => {
    const text = formatWorkflowTaskNotification({
      ...base,
      status: 'completed',
      deliveryGuidance: true,
    })
    expect(text).not.toContain('<artifacts')
    expect(text).not.toContain('refer to them by title')
    expect(text).toContain('Do not restate the phase graph or the script.')
  })

  it('casts the provider stop error block for stopped(provider)', () => {
    const text = formatWorkflowTaskNotification({
      ...base,
      status: 'stopped',
      stopReason: 'provider',
      failure: {
        code: 'ProviderStop',
        message: 'boom',
        providerStop: { kind: 'other', reason: 'x', providerId: 'p', providerCode: '5xx' },
      },
      deliveryGuidance: true,
    })
    expect(text).toContain('<error>')
    expect(text).toContain("refused subagent a subagent's request with a permanent error")
    expect(text).toContain('Then resolve the cause with the user before calling ResumeWorkflowRun with run_id="wf-run-1"')
  })

  it('routes stopped(user) to the do-not-resume branch', () => {
    const text = formatWorkflowTaskNotification({
      ...base,
      status: 'stopped',
      stopReason: 'user',
      deliveryGuidance: true,
    })
    expect(text).toContain('The user stopped this workflow on purpose. Do not resume it with ResumeWorkflowRun')
  })

  it('routes stopped(model) to the amend-now branch with the script path', () => {
    const text = formatWorkflowTaskNotification({
      ...base,
      status: 'stopped',
      stopReason: 'model',
      scriptPath: 'draft.ts',
      deliveryGuidance: true,
    })
    expect(text).toContain('You stopped this workflow with `job_kill`.')
    expect(text).toContain('Its script is at draft.ts: edit that file and pass `path`.')
  })

  it('routes errored to the AmendWorkflow branch both with and without a script file', () => {
    const withFile = workflowDeliveryGuidance({
      status: 'errored',
      stopReason: undefined,
      hasArtifacts: false,
      runId: 'r',
      scriptPath: 's.ts',
    })
    expect(withFile).toContain('Edit that file in place, then call AmendWorkflow (run_id="r", path="s.ts")')
    const withoutFile = workflowDeliveryGuidance({
      status: 'errored',
      stopReason: undefined,
      hasArtifacts: false,
      runId: 'r',
      scriptPath: undefined,
    })
    expect(withoutFile).toContain('Fix the script and submit it with AmendWorkflow (run_id="r")')
    expect(withoutFile).toContain('ResumeWorkflowRun will refuse this run')
  })

  it('keeps the superseded defensive branch from telling the model to resume', () => {
    const text = workflowDeliveryGuidance({
      status: 'stopped',
      stopReason: 'superseded',
      hasArtifacts: false,
      runId: 'r',
      scriptPath: undefined,
    })
    expect(text).toContain('Do not resume this run and do not amend it again')
  })
})

describe('artifact sections', () => {
  it('returns undefined for empty lists and bounds lines with count>shown', () => {
    expect(buildWorkflowArtifactsSection(undefined, 8)).toBeUndefined()
    expect(buildWorkflowArtifactsSection([], 8)).toBeUndefined()
    const many: DynamicWorkflowRunArtifact[] = Array.from({ length: 12 }, (_, i) => ({
      id: `a${i}`,
      kind: 'file',
      version: 1,
    }))
    const section = buildWorkflowArtifactsSection(many, WORKFLOW_ARTIFACTS_NOTIFICATION_MAX_LINES)
    expect(section).toMatchObject({ count: 12, shown: 8 })
  })
})
