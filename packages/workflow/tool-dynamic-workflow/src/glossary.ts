/**
 * 词汇替换表（GLOSSARY.md 的实现面）：ZCode 文案提及的宿主工具名 → dsh 对应工具。
 * 逐字基准是英文原文；只有点名 ZCode 宿主工具的那几个词替换，其余逐字保留。
 * @module
 */

/** ZCode 的 TaskOutput（等待/拉取在飞任务输出）在 dsh 对应 `job_output`（带 `wait`）。 */
export const TASK_OUTPUT_REF = '`job_output` (with `wait`)'
/** ZCode 的 TaskStop（主动停掉一个后台任务）在 dsh 对应 `job_kill`。 */
export const TASK_STOP_REF = '`job_kill`'
/** ZCode 的 Skill 工具在 dsh 是小写 `skill`。 */
export const SKILL_TOOL_REF = '`skill`'
/** 撰写契约技能名（dsh 与 ZCode 同名，技能本体由 skill-dynamic-workflows 模块提供）。 */
export const DYNAMIC_WORKFLOW_SKILL_NAME = 'dynamic-workflows'
