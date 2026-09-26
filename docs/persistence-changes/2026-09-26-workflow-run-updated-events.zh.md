---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-workflow-run-updated-events

[English](2026-09-26-workflow-run-updated-events.md) | 中文

## 概述

新增两个仅写日志的工作流运行投影事件 expert-run/updated 与 journal-run/updated，由移植自 ZCode 的工作流引擎（workflow-expert-core 与动态工作流 journal）发出，供 UI 客户端实时渲染运行进度。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-workflow-run-updated-events
baseline: false
changes:
  - root: "event:expert-run/updated"
    previous: null
    after: "489ce67974001f25c5afc2890ef99a4d75a09a20b10bcc6fe8dcd92013c0516a"
    decision: same-version
  - root: "event:journal-run/updated"
    previous: null
    after: "cd3f90f19720553b97a16c7790576cf441ff69c3977d30d6f37fcfe8947c5d80"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

同一 Session 格式版本内的两个新根。既有日志不含这两个事件，仍然有效；旧读取器按所有读取时必填事件的同一规则拒绝携带它们的日志。两个事件均为只追加的进度投影；工作流运行 UI 面板是唯一消费者，按运行读取最新一条事件。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/workflow/workflow-runs packages/workflow/workflow-notifications packages/workflow/workflow-expert-core packages/workflow/tool-dynamic-workflow：16 个文件 154 条测试全部通过，含对新事件载荷做往返验证的投影 thread-safe 规格；pnpm run gen-persistence-catalog 依据源定义重新推导了两个根的摘要。

<a id="dev-note"></a>
## 开发备注

无。
