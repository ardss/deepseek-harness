/**
 * 相位定义（definition）单测：内置 8 相位定义的校验与默认 strategy 值。
 * 对应迁移蓝图 §5.1 workflow-expert-core "definition 校验"。
 */
import { describe, expect, it } from 'vitest'
import {
  WorkflowDefinitionSchema,
  type WorkflowDefinition,
} from '@deepseek-ai/dsh-workflow-runs'
import {
  BUILT_IN_EXPERT_WORKFLOW_DEFINITION_ID,
  DEFAULT_EXPERT_WORKFLOW_STRATEGY,
  createExpertWorkflowDefinition,
} from '../src/definition.js'

describe('createExpertWorkflowDefinition', () => {
  it('产出通过 WorkflowDefinitionSchema 校验的内置定义', () => {
    const definition = createExpertWorkflowDefinition()
    const parsed = WorkflowDefinitionSchema.parse(definition)
    expect(parsed.definitionId).toBe(BUILT_IN_EXPERT_WORKFLOW_DEFINITION_ID)
    expect(parsed.phaseOrder).toEqual([
      'clarify',
      'task_analysis',
      'arch_decompose',
      'env_setup',
      'meta_prompt',
      'exec',
      'final_critic',
      'complete',
    ])
  })

  it('默认 strategy 与规格一致（clarify 0.8/3/1，executor 1/3/2/3/10，finalCritic 3，reactLoop 30）', () => {
    expect(DEFAULT_EXPERT_WORKFLOW_STRATEGY.clarify).toEqual({
      confidenceThreshold: 0.8,
      maxRounds: 3,
      minRounds: 1,
    })
    expect(DEFAULT_EXPERT_WORKFLOW_STRATEGY.executor).toEqual({
      drainingChangeHours: 1,
      frontierTarget: 3,
      maxConcurrentLoops: 2,
      maxConsecutiveErrors: 3,
      maxPlannerRuns: 10,
    })
    expect(DEFAULT_EXPERT_WORKFLOW_STRATEGY.finalCritic).toEqual({ maxIterations: 3 })
    expect(DEFAULT_EXPERT_WORKFLOW_STRATEGY.reactLoop).toEqual({ maxRounds: 30 })
  })

  it('拒绝重复相位定义', () => {
    const base = createExpertWorkflowDefinition() as WorkflowDefinition
    expect(() =>
      WorkflowDefinitionSchema.parse({
        ...base,
        phases: [...base.phases, base.phases[0]],
      }),
    ).toThrow(/Duplicate workflow phase definition/)
  })

  it('拒绝 phaseOrder 引用未知相位', () => {
    const base = createExpertWorkflowDefinition() as WorkflowDefinition
    expect(() =>
      WorkflowDefinitionSchema.parse({
        ...base,
        phaseOrder: [...base.phaseOrder, 'no_such_phase'],
      }),
    ).toThrow(/references unknown phase/)
  })

  it('拒绝相位定义缺席于 phaseOrder', () => {
    const base = createExpertWorkflowDefinition() as WorkflowDefinition
    expect(() =>
      WorkflowDefinitionSchema.parse({
        ...base,
        phaseOrder: base.phaseOrder.filter(phase => phase !== 'exec'),
      }),
    ).toThrow(/missing from phaseOrder/)
  })
})
