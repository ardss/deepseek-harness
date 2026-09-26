---
description: "迁移自 ZCode 工作流引擎的 run 状态词汇：expert 与 dynamic 两套 run 词汇、宿主运行时端口类型与纯投影辅助函数。"
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-runs

[English](README.md) | 中文

## 概述

`dsh-workflow-runs` 承载迁移自 ZCode 的两套互斥 run 词汇。`expert` 入口携带专家引擎的相位、节点与 run 状态词；`dynamic` 入口携带 dynamic run 的五态状态、停止原因以及端口与通知文案承载的可移植 JSON 形状。本包还声明专家引擎引用的宿主运行时端口类型，以及作用在 run 记录上的纯投影辅助函数。包内没有 I/O，也不注册任何模型可见内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

按所组合的引擎导入对应词汇。专家引擎组合导入 expert 词汇与运行时端口类型；dynamic journal 组合导入 dynamic 词汇与端口 JSON 形状。既有 `@deepseek-ai/dsh-workflow` 的 CLOSED outcome union 是另一套词汇：两边不得混写进同一条 run 记录，本包也不提供二者之间的转换。

子路径入口：`@deepseek-ai/dsh-workflow-runs`（桶导出）、`./expert`、`./dynamic` 与 `./runtime`。所有导出都是类型、zod schema 或纯函数；在组合中挂载本包没有任何效果，因为它不带插件。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

类型是普通接口与 zod schema；投影辅助函数从 run 记录派生可渲染摘要，不触碰宿主服务。`./runtime` 中的 `SessionEvent` 是宿主会话事件的不透明结构视图：引擎只透传、不解释 `payload`，宿主把既有事件对象按结构兼容直接传入。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/expert.ts`](src/expert.ts) | expert run 词汇：workflow kind、相位与节点状态、run 状态及其 zod schema |
| [`src/dynamic.ts`](src/dynamic.ts) | dynamic run 词汇：五态状态、停止原因与端口载荷的可移植 JSON 镜像 |
| [`src/runtime.ts`](src/runtime.ts) | 宿主运行时端口类型：会话事件视图、追踪上下文与 store 端口输入 |
| [`src/projection.ts`](src/projection.ts) | 工具、通知与 UI 面板共用的 run 记录纯投影辅助函数 |
| — | 未发布运行时 invariant 伴随包，因为本包不持有运行时状态；词汇测试覆盖其代数性质。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包只声明 run 状态词汇与纯辅助函数；它不注册任何工具、提示词段或会话事件。

#### KV Cache 效应

与模型请求缓存无关：本包不向任何请求贡献 token。渲染其记录的消费者拥有模型可见文本。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **两套词汇有意互不兼容** — expert 与 dynamic 词汇描述不同引擎；没有对照表，混写只在消费端暴露。
- **`SessionEvent.payload` 有意保持 `unknown`** — 引擎只透传不做解释；需要类型化载荷的消费者自行收窄。
- **投影是尽力而为** — 辅助函数只渲染记录携带的内容，绝不重建缺失字段。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
