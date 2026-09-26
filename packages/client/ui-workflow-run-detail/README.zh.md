---
description: "工作流 run 详情侧栏：状态头、纵向相位脊柱、结果与 artifact、事件日志与 run 操作。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workflow-run-detail

[English](README.md) | 中文

## 概述

`dsh-client-ui-workflow-run-detail` 是单个工作流 run 的浏览器侧栏：状态头、纵向相位脊柱、run 的结果与 artifact 板面、事件日志以及 run 操作。侧栏把持久化 run 记录与事件流投影成视图模型，用共享客户端表面渲染。它是 web 平台客户端插件，不在宿主侧或模型侧注册任何内容；artifact 板面本身位于 `@deepseek-ai/dsh-client-ui-workflow-artifacts`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包加入 web 客户端组合；客户端 loader 会把它与右栏、renderer、locale、job-controller 等包一起注入。侧栏从工作流 run 列表打开并跟随所选 run。它提供的操作（run 状态允许时的取消与恢复）派发到宿主 run 控制器；侧栏只渲染投影记录与事件包含的内容，自身绝不改动 run 状态。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

侧栏从 run 记录加事件流派生一个视图模型：脊柱是相位与节点状态的投影，事件日志是该 run 过滤后按序号排序的事件，结果区把 artifact spec 转发给 artifact 预设板面。所有字符串经客户端 locale 包解析，操作可用性只由 run 状态决定。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/`](src/client/) | 侧栏组件、视图模型投影与 locale 接线 |
| — | 未发布运行时 invariant 伴随包，因为本包渲染浏览器状态；其测试覆盖投影与渲染行为。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包是持久化工作流记录的浏览器侧呈现；它渲染已落日志的 run，不改变模型上下文。

#### KV Cache 效应

与模型请求缓存无关：本包不向任何请求贡献 token。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **对记录只读** — 侧栏只渲染与派发；记录不一致时它无法修复。
- **事件日志是追加序** — 迟到事件只能追加；没有重排或合并视图。
- **操作跟随 run 状态而非权限** — 状态允许取消就显示控件，即使宿主稍后拒绝。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
