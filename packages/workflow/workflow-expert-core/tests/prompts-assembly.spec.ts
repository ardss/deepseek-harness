/**
 * 提示词装配面测试（蓝图 P11 的保真验收）：buildPhasePrompt 的英文原文骨架与
 * Architecture graph contract JSON 示例（下游宽容解析器依赖该格式）、
 * buildScheduledNodePrompt 的节点提示词装配、相位摘要/报告/状态格式化。
 */
import { describe, expect, it } from 'vitest'
import type { WorkflowPhaseDefinition } from '@deepseek-ai/dsh-workflow-runs'
import {
  buildPhasePrompt,
  buildReport,
  buildScheduledNodePrompt,
  buildScheduledPhaseSummary,
} from '../src/expert/prompts.js'
import { formatExpertWorkflowCompletion, formatExpertWorkflowStatus } from '../src/expert/formatters.js'
import { phaseNodeId } from '../src/expert/ids.js'
import { makeSnapshot, node, T0 } from './helpers.js'

const SEED_PHASE: WorkflowPhaseDefinition = {
  artifactPath: 'artifacts/03-arch.md',
  behavior: 'agent',
  description: 'Decompose the work.',
  phase: 'arch',
  seedGraphFromArtifact: {
    targetPhase: 'exec',
  },
  title: 'Architecture Decompose',
}

const PLAIN_PHASE: WorkflowPhaseDefinition = {
  behavior: 'agent',
  description: 'Refine the goal.',
  phase: 'clarify',
  title: 'Clarify',
}

describe('buildPhasePrompt', () => {
  it('带 seedGraphFromArtifact 的相位包含 Architecture graph contract 与 exec 目标相位', () => {
    const snapshot = makeSnapshot({ status: 'running' })
    const prompt = buildPhasePrompt(snapshot, SEED_PHASE)
    expect(prompt).toContain('You are running the ZCode workflow phase: arch.')
    expect(prompt).toContain(`Workflow run: ${snapshot.runId}`)
    expect(prompt).toContain('Architecture graph contract:')
    expect(prompt).toContain('seed the exec DAG')
    // 契约 JSON 示例里携带宽容解析器依赖的键位
    expect(prompt).toContain('"dependsOn"')
    expect(prompt).toContain('"collections"')
    expect(prompt).toContain('edges must not create cycles')
  })

  it('无 seed 的相位不携带契约段；提示词含任务与调度策略数字', () => {
    const snapshot = makeSnapshot({ status: 'running' })
    const prompt = buildPhasePrompt(snapshot, PLAIN_PHASE)
    expect(prompt).not.toContain('Architecture graph contract')
    expect(prompt).toContain('User task:\n测试任务')
    expect(prompt).toContain('Clarify max rounds: 3')
    expect(prompt).toContain('Final critic max iterations: 3')
  })

  it('已有工件以清单形式出现在提示词里', () => {
    const snapshot = makeSnapshot({ status: 'running' })
    snapshot.artifacts.push({
      contentType: 'text/markdown',
      createdAt: T0,
      label: 'Clarify',
      path: 'artifacts/01-clarify.md',
      phase: 'clarify',
    })
    const prompt = buildPhasePrompt(snapshot, PLAIN_PHASE)
    expect(prompt).toContain('Previous artifacts available on disk:')
    expect(prompt).toContain('- Clarify: artifacts/01-clarify.md')
  })
})

describe('buildScheduledNodePrompt', () => {
  it('任务节点提示词携带节点 id/标题与节点专属 prompt', () => {
    const snapshot = makeSnapshot({
      graph: {
        edges: [],
        nodes: [node('n1', { phase: 'exec', prompt: 'NODE-PROMPT' })],
      },
      status: 'running',
    })
    const execPhase: WorkflowPhaseDefinition = {
      behavior: 'scheduled_graph',
      description: 'Execute.',
      phase: 'exec',
      title: 'Execute',
    }
    const prompt = buildScheduledNodePrompt(
      snapshot,
      execPhase,
      snapshot.graph.nodes[0]!,
    )
    expect(prompt).toContain('You are running a ZCode workflow node inside phase: exec.')
    expect(prompt).toContain('Node id: n1')
    expect(prompt).toContain('Node prompt:\nNODE-PROMPT')
    expect(prompt).toContain('Max concurrent loops: 2')
  })

  it('相位节点回退到相位提示词（调度器把相位节点也当可执行单元时口径一致）', () => {
    const snapshot = makeSnapshot({ status: 'running' })
    const execPhase: WorkflowPhaseDefinition = {
      behavior: 'scheduled_graph',
      description: 'Execute.',
      phase: 'exec',
      title: 'Execute',
    }
    const phaseNode = node(phaseNodeId('exec'), {
      kind: 'phase',
      phase: 'exec',
    })
    const prompt = buildScheduledNodePrompt(snapshot, execPhase, phaseNode)
    expect(prompt).toBe(buildPhasePrompt(snapshot, execPhase))
  })
})

describe('buildScheduledPhaseSummary / buildReport / formatters', () => {
  it('相位摘要列出节点状态与尝试数', () => {
    const snapshot = makeSnapshot({
      graph: {
        edges: [],
        nodes: [
          node('n1', { attempts: 2, phase: 'exec', status: 'completed' }),
          node('n2', { error: 'boom', phase: 'exec', status: 'failed' }),
        ],
      },
      status: 'running',
    })
    const summary = buildScheduledPhaseSummary(snapshot, 'exec')
    expect(summary).toContain('# exec Scheduler Summary')
    expect(summary).toContain('- n1: completed attempts=2')
    expect(summary).toContain('- n2: failed error=boom')
  })

  it('报告包含相位、活动与工件三节', () => {
    const snapshot = makeSnapshot({ status: 'completed' })
    snapshot.phases[0] = { ...snapshot.phases[0]!, artifactPath: 'artifacts/01-clarify.md' }
    snapshot.activities.push({
      activityId: 'act-1',
      inputArtifactPaths: [],
      kind: 'agent_session',
      outputArtifactPaths: [],
      phase: 'clarify',
      sessionId: 'session-9',
      startedAt: T0,
      status: 'completed',
    })
    snapshot.artifacts.push({
      contentType: 'text/markdown',
      createdAt: T0,
      label: 'Clarify',
      path: 'artifacts/01-clarify.md',
    })
    const report = buildReport(snapshot)
    expect(report).toContain('# Workflow Report')
    expect(report).toContain('- clarify: completed (artifacts/01-clarify.md)')
    expect(report).toContain('session=session-9')
    expect(report).toContain('- Clarify: artifacts/01-clarify.md')
  })

  it('状态格式化的三种相位标记与报告行', () => {
    const snapshot = makeSnapshot({
      phases: [
        { phase: 'clarify', status: 'completed' },
        { error: '卡住了', phase: 'exec', status: 'active' },
        { phase: 'final_critic', status: 'pending' },
      ],
      status: 'running',
    })
    snapshot.reportPath = 'reports/r.md'
    const status = formatExpertWorkflowStatus(snapshot)
    expect(status).toContain('[x] clarify: completed')
    expect(status).toContain('> exec: active')
    expect(status).toContain('- final_critic: pending')
    expect(status).toContain('(卡住了)')
    expect(status).toContain('Report: reports/r.md')
  })

  it('完成格式化带状态与报告路径', () => {
    const snapshot = makeSnapshot({ status: 'completed' })
    snapshot.reportPath = 'reports/r.md'
    const completion = formatExpertWorkflowCompletion(snapshot)
    expect(completion).toContain(`Expert workflow ${snapshot.runId} completed.`)
    expect(completion).toContain('Report: reports/r.md')
  })
})
