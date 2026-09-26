# GLOSSARY：ZCode 文案里的宿主工具名 → dsh 对应工具

对话面提示词以 ZCode 英文原文为逐字基准（spec-conversation-flow §十二 第 10 条），只有点名 **ZCode 宿主工具** 的少数词做替换；实现集中在 `src/glossary.ts`，本文件是核对表。

| ZCode 原词 | dsh 替换 | 出现处 |
|---|---|---|
| `TaskOutput`（阻塞等待任务） | `job_output`（带 `wait`） | CreateWorkflow/ResumeWorkflowRun 启动劝阻句、GetWorkflowRun 描述「waiting tool」段 |
| `TaskStop` | `job_kill` | deliveryGuidance 的 stopped(model) 分支、AmendWorkflow 描述、GetWorkflowRun/Resume 描述 |
| `Skill`（大写工具名） | `skill`（dsh 小写） | 技能门拒绝文案、四个写作工具描述 |
| `Agent tool` / `Agent/Task subagent tools` | the subagent tools / subagent delegation tools | CreateWorkflow 描述路由段 |
| `AskUserQuestion` | `ask_user_question` | ResolveWorkflowQuestion 描述 |
| `CreateWorkflow's resume_from` | AmendWorkflow（dsh 一期以 amend 为修订入口，无 resume_from 字段） | ResolveWorkflowQuestion 描述最后一条 |

工具名本身（CreateWorkflow/AmendWorkflow/…/escalate/submit_result）保持 ZCode 的 PascalCase / 小写原名：终态通知与工具描述互相引用这些名字，改名会让通知文案与工具面对不上。

## 与 ZCode 的其余措辞级偏差（逐处核对过 P2/P8）

1. CreateWorkflow 端口缺席占位：ZCode 写 "The workflow script compiled cleanly."（它的宿主恒有类型检查）；dsh 一期没有 lowering 编译器，占位改为 "The workflow script was accepted for submission."，编译器缺席另有专属 NOTE（COMPILER_UNAVAILABLE_NOTE），不说谎。
2. ResumeWorkflowRun 的通知投递归引擎模块的端口实现（同一 runId，不注册新 job），启动句保留 ZCode 的 backgrounded 措辞。
3. deliveryGuidance 的兜底支（未知终态词）最后一句原提 "error code Interrupted"；dsh 无此错误码词汇，改为指向 `job_output` 与 ListWorkflowRuns。
