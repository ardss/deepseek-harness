import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { parseArtifactPreset } from './presets/spec.ts'
import { ArtifactBoard } from './presets/ArtifactBoard.tsx'
import { ArtifactChart } from './presets/ArtifactChart.tsx'
import { ArtifactMetrics } from './presets/ArtifactMetrics.tsx'
import { ArtifactTable } from './presets/ArtifactTable.tsx'
import css from './presets/preset.module.css'

/**
 * 预置看板 body：宽松二次解析 + 按种类分发；坏 spec 降级为「无法渲染」卡，
 * 绝不抛异常把整个侧板炸掉（spec.ts 文件头的解析原则）。四个预置 key 都注册
 * 本组件——分发键只决定注册身份，解析仍以 `artifact.preset.kind` 为准。
 */
export type WorkflowArtifactBodyProps =
  PropsRuntime<'workflow-run.detail.artifact'>
  & PropsLocale<'workflowArtifacts'>

/** Render one artifact preset board, or the degrade card. */
export function WorkflowArtifactBody(props: WorkflowArtifactBodyProps) {
  const { artifact, t } = props
  const parsed = parseArtifactPreset(artifact)
  if (!parsed.ok) {
    return (
      <div className={css.degrade} data-artifact-degrade>
        <span className={css.degradeTitle}>{t('unrenderable.title')}</span>
        <span>{t('unrenderable.hint')}</span>
      </div>
    )
  }
  switch (parsed.kind) {
    case 'chart':
      return <ArtifactChart {...props} view={parsed.view} />
    case 'table':
      return <ArtifactTable {...props} view={parsed.view} />
    case 'metrics':
      return <ArtifactMetrics {...props} view={parsed.view} />
    case 'board':
      return <ArtifactBoard {...props} view={parsed.view} />
    /* v8 ignore next -- ParsedArtifactPreset ok-cases are closed and handled above. */
    default:
      return parsed satisfies never
  }
}
