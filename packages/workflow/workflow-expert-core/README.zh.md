---
description: "专家工作流引擎内核：相位状态机、DAG 图调度器、artifact 播种、快照持久化端口与断点 resume 生命周期，零宿主 I/O。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-expert-core

[English](README.md) | 中文

## 概述

`dsh-workflow-expert-core` 是专家工作流引擎内核：相位状态机、调度 DAG 节点的 `WorkflowGraphScheduler`、从相位 artifact 播种图、快照持久化的 `WorkflowStorePort`，以及 resume 生命周期（reconcile、cancel、reopen、seed 与 prompt update）。内核不持有任何宿主 I/O：所有副作用都经过注入的 store 与 runner 端口，run 词汇来自 `@deepseek-ai/dsh-workflow-runs`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在你构建专家工作流 runner 宿主时组合本内核，而不是只想启动一个工作流时：面向最终用户的组合挂载的是内嵌本内核的 runner 包。宿主实现 `WorkflowStorePort` 做快照持久化、实现 runner 端口做执行，然后驱动生命周期入口。子路径入口：`@deepseek-ai/dsh-workflow-expert-core`（桶导出）、`./scheduler` 与 `./lifecycle`。

内核自身从不读时钟、文件系统或网络。本包测试用内存端口驱动它；宿主若观察到不同行为，责任在其注入的端口实现。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

相位状态机在调度器观察之前校验转移；调度器派发依赖齐备的节点，并在图上记录跳过与取消。播种从相位 artifact 构建初始图，使恢复的 run 与全新 run 走同一推导。生命周期函数是「快照 + 端口」上的纯状态转移：reconcile 把恢复的快照与定义对齐，cancel、reopen 与 prompt update 返回下一个由宿主持久化的快照。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/definition.ts`](src/definition.ts) | 内置专家工作流定义与策略默认值 |
| [`src/expert.ts`](src/expert.ts) | 相位状态机与引擎状态 |
| [`src/scheduler.ts`](src/scheduler.ts) | 节点 DAG 上的工作流图调度器 |
| [`src/lifecycle.ts`](src/lifecycle.ts) | resume 生命周期：reconcile、cancel、reopen、seed 与 prompt update |
| — | 未发布运行时 invariant 伴随包，因为内核不持有宿主状态；生命周期测试钉住其转移。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为内核不注册任何自己的工具、提示词段或事件；内嵌它的 runner 与工具包拥有每一条模型可见文本。

#### KV Cache 效应

与模型请求缓存无关：内核不向任何请求贡献 token。其快照只经由渲染它们的消费者进入模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **所有 I/O 是宿主的责任** — 快照写丢失或部分应用在宿主侧暴露，内核不重试。
- **调度器是协作式的** — 节点派发信任 runner 结果；内核不强制校验 runner 的声明。
- **词汇是闭合的** — 新增相位或节点状态是 `dsh-workflow-runs` 的变更，且旧持久化快照必须保持可 reconcile。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
