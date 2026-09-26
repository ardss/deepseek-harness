---
description: "动态工作流通知的纯铸造：终态 task-notification XML、投递指引、provider 停止错误行、escalation 与 stall 文案，以及 artifact 行投影。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-notifications

[English](README.md) | 中文

## 概述

`dsh-workflow-notifications` 铸造动态工作流对话面发送的每一条通知文本：终态 `<task-notification>` XML、按终态区分的投递指引、表驱动的 provider 停止 `<error>` 行、escalation 与 stall 两条 run 中通知，以及被通知消费方、GetWorkflowRun 截面与 UI manifest 三处共用的 artifact 行投影。本包是一组零 I/O 的纯函数；投递由调用方工具负责。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

用普通 JSON 输入（`@deepseek-ai/dsh-workflow-runs` 的端口形状）调用铸造辅助函数，然后自行发送返回的文本。`formatWorkflowTaskNotification` 渲染终态通知；`workflowDeliveryGuidance` 返回 run 终态对应的指引行；escalation 与 stall 辅助函数渲染各自的 run 中通知。这里不记录事件、不调度投递、也不触碰会话：这些全部由投递消费方负责。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

终态通知截断到 `TASK_NOTIFICATION_MAX_CHARS`，并对 XML 文本做防御性转义。provider 停止按停止类别走表驱动渲染，未知类别也会产出稳定的 `<error>` 行而不是无界字符串。artifact 行对每条 artifact 投影出一行且处处同构渲染，这正是通知消费方、run 截面与 UI manifest 能共用它的原因。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/task-notification.ts`](src/task-notification.ts) | 终态通知、投递指引与停止工具命名 |
| [`src/copy.ts`](src/copy.ts) | escalation 与 stall 通知文案及 provider 停止表 |
| [`src/artifacts-line.ts`](src/artifacts-line.ts) | 共用 artifact 行投影 |
| [`src/xml.ts`](src/xml.ts) | XML 转义与通知截断上限 |
| — | 未发布运行时 invariant 伴随包，因为本包不持有运行时状态；文案测试钉住每一行渲染结果。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只以纯函数铸造通知文本；投递通知的工具拥有每一条模型可见文本。

#### KV Cache 效应

与模型请求缓存无关：铸造文本只有在投递消费方发送时才进入模型上下文，保留与复用由该消费方决定。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **文案在构建期固定** — 指引与通知行是代码而非配置；改措辞就是改包。
- **截断上限很粗糙** — 超长结果载荷丢弃后缀标记，而不是结构化摘要。
- **未知停止类别退化为通用行** — 表对未知类别渲染稳定但不具体的 `<error>` 行。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
