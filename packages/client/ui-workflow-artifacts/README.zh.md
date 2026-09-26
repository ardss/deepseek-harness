---
description: "工作流 run artifact 的浏览器预设板面（chart、table、metrics、board），带宽松 spec 解析与降级卡片。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workflow-artifacts

[English](README.md) | 中文

## 概述

`dsh-client-ui-workflow-artifacts` 在浏览器里把工作流 run 的 artifact 渲染成预设板面：chart、table、metrics 与 board 四种布局，每种都由宽松的 spec 解析器驱动——接受残缺或松类型的 artifact spec，解析失败时回退到降级卡片而不是抛错。本包是 web 平台客户端插件：挂载进浏览器组合、渲染投影后的 run 记录，不在宿主侧或模型侧注册任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

把本包加入 web 客户端组合；客户端 loader 会把它与 locale、renderer、slot 等包一起注入。run 详情与 run 面板把投影 run 记录里的 artifact spec 交给它渲染。解析器无法理解的 spec 会渲染出带原因的降级卡片，因此单个坏 artifact 不会拖垮周围板面。

`parseChartSpec`、`parseTableSpec` 等解析器已导出，供测试以及想在板面之外复用同样宽松语义的消费者使用。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 — 点击展开</summary>

每个预设持有一个把 spec 规整成类型化视图模型的解析器；缺失字段变成空态而不是错误。板面是共享 slot 表面上的 CSS-module 组件，所有字符串经客户端 locale 包解析。降级卡片携带解析原因，run 作者可以据此修复发出方的 spec。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/presets/spec.ts`](src/client/presets/spec.ts) | chart、table 及相关预设视图的宽松 spec 解析器 |
| [`src/client/presets/`](src/client/presets/) | 预设板面与降级卡片 |
| — | 未发布运行时 invariant 伴随包，因为本包渲染浏览器状态；其测试覆盖解析器与渲染行为。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包是对已落日志 run artifact 的浏览器侧呈现；它不注册任何工具、提示词段或会话事件，用户读到的内容也绝不进入模型请求。

#### KV Cache 效应

与模型请求缓存无关：本包不向任何请求贡献 token。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **预设是闭合集合** — chart、table、metrics、board 是仅有的布局；新增布局是包变更。
- **宽松解析可能掩盖书写错误** — 按宽松规则能解析的 spec 可能与作者意图不符地渲染，而不是响亮失败。
- **大表全量渲染** — 尚无行虚拟化；超大 artifact 依赖降级路径兜底。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
