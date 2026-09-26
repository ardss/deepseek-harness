---
description: "动态工作流的对话工具面：CreateWorkflow、AmendWorkflow、SaveWorkflow、内省、恢复与问题消解，外加 actor 侧的 escalate 与 submit result。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-dynamic-workflow

[English](README.md) | 中文

## 概述

`dsh-tool-dynamic-workflow` 注册动态工作流对话面的模型可见工具：创作（CreateWorkflow、AmendWorkflow、SaveWorkflow、ListSavedWorkflows）、内省（ListWorkflowRuns、GetWorkflowRun、ListModels）与 run 续行（ResumeWorkflowRun、ResolveWorkflowQuestion、EvalWorkflowSnippet），外加 alwaysAsk 确认门与用途纪律提示词段。可选的 escalate 与结果提交工具只在 workflow actor 端口在场的组合中注册。run 端口缺席时降级为占位应答；插件绝不假装一次 run 已经启动。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在提供 `ctx.tools` 与 `ctx.systemPrompt` 的组合中挂载本插件。dynamic run journal 与 escalate/提交端口是经 `ctx.get` 读取的可选接缝：没有它们，创作与内省工具照常注册，run 类工具应答本会话没有执行能力，actor 侧工具保持未注册。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-dynamic-workflow)定义了 `enable` 与 `enablePromptSection`。

```yaml
- name: '@deepseek-ai/dsh-tool-dynamic-workflow'
```

改状态的工具（CreateWorkflow、带脚本的 AmendWorkflow、SaveWorkflow、ResumeWorkflowRun）都经过 alwaysAsk 确认门，因此部署的审批策略决定是否先询问用户。通知铸造本身在 `@deepseek-ai/dsh-workflow-notifications`；本包负责投递该包铸造的文本。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

工具工厂在每次调用时读取一次可选端口，端口在两次调用之间到来或离开都会在下一次调用被尊重。确认门包裹的是处理器而非 schema，模型始终看到真实 schema，确认与拒绝文案由门负责。run 结算以 `<task-notification>` 行送达，文本由通知包渲染、经 jobs 接缝调度。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：config、inject、工具注册与提示词段 |
| [`src/tools/writing.ts`](src/tools/writing.ts) | 创作工具：CreateWorkflow、AmendWorkflow、SaveWorkflow、ListSavedWorkflows |
| [`src/tools/introspection.ts`](src/tools/introspection.ts) | run 内省：ListWorkflowRuns、GetWorkflowRun、ResumeWorkflowRun、ResolveWorkflowQuestion、ListModels |
| [`src/tools/actor.ts`](src/tools/actor.ts) | actor 侧 escalate 与结果提交工具（按端口门控） |
| [`src/ask-gate.ts`](src/ask-gate.ts) | 覆盖改状态工具的 alwaysAsk 确认门 |
| [`src/run-job.ts`](src/run-job.ts) | run 任务启动、结算映射与通知投递 |
| [`src/port.ts`](src/port.ts) | 可选端口契约与占位应答 |
| — | 未发布运行时 invariant 伴随包，因为本包是工具面；其行为测试覆盖确认门、端口与投递。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

`enablePromptSection` 开启时，本插件注册范围内的每个父请求都会收到下面的用途纪律段。

##### CreateWorkflow 纪律

```markdown
Use the CreateWorkflow tool ONLY when the user explicitly asks for a workflow (点名 workflow/工作流): it is mandatory then, regardless of task size. Without such an explicit request, do not start a workflow — delegate with the subagent tools or do the work yourself. A running workflow reports progress by itself; do not poll it.
```

#### Token 效应

插件激活期间每个请求有小额固定指引开销。

#### KV Cache 效应

插件范围与段文本不变时前缀稳定。激活、卸载或 `enablePromptSection` 变更可能使该提示词段的复用失效。

### 工具 schema

#### 模型看到什么

生成的 [`CreateWorkflow`、`AmendWorkflow`、`SaveWorkflow`、`ListSavedWorkflows`、`ListWorkflowRuns`、`GetWorkflowRun`、`ResumeWorkflowRun`、`ResolveWorkflowQuestion`、`EvalWorkflowSnippet`、`ListModels` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-dynamic-workflow) 携带完整参数契约。escalate 与结果提交工具不在默认采集之内，因为它们只在 actor 端口在场时注册。

#### Token 效应

创作工具在可见的每个请求上有可观的固定 schema 开销；内省 schema 较小。

#### KV Cache 效应

注册与可见性不变时前缀稳定。插件生命周期或作用域工具限制可能使这些 schema 的复用失效。

### 工具调用历史与结果

#### 模型看到什么

调用在 assistant 工具调用中原样保留。创作调用确认已保存的工作流及其问题门；run 类工具应答 run 状态、当前相位、artifact 行或待决问题，端口缺席时精确应答本会话没有执行能力。终态结算稍后以带投递指引的 `<task-notification>` 行抵达模型；被拒的确认门是普通的拒绝结果。

#### Token 效应

结果是封顶的渲染摘要；超长载荷截断而非流式，通知投递受通知截断上限约束。

#### KV Cache 效应

只追加；新可见内容跟随可复用的请求前缀，不使既有 KV-cache 条目失效。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **端口缺席即占位应答** — 工具描述一个无执行能力的会话而不是响亮失败；期望执行的组合必须挂载 journal。
- **确认门依赖策略** — alwaysAsk 审批关闭时，改状态工具不经用户提示直接执行。
- **没有部分 amend** — AmendWorkflow 整体替换声明的部分；重叠编辑没有合并语义。
- **actor 工具随组合而定** — escalate 与结果提交只在工作流 actor 端口挂载时存在，其可用性因 run 与会话而异。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
