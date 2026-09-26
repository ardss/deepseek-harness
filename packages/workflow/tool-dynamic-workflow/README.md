---
description: "Conversation tool surface for the dynamic workflow: CreateWorkflow, AmendWorkflow, SaveWorkflow, introspection, resume, and question resolution, plus actor-side escalate and submit result."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-dynamic-workflow

English | [中文](README.zh.md)

## Summary

`dsh-tool-dynamic-workflow` registers the model-facing tools of the dynamic workflow surface: authoring (CreateWorkflow, AmendWorkflow, SaveWorkflow, ListSavedWorkflows), introspection (ListWorkflowRuns, GetWorkflowRun, ListModels), and run continuation (ResumeWorkflowRun, ResolveWorkflowQuestion, EvalWorkflowSnippet), plus the alwaysAsk confirmation gates and a usage-discipline prompt section. Optional escalation and result-submission tools register only where the workflow actor ports are present. Absent run ports degrade to placeholder responses; the plugin never pretends a run started.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the plugin in a composition that provides `ctx.tools` and `ctx.systemPrompt`. The dynamic run journal and the escalation/submission ports are optional seams read with `ctx.get`: without them the authoring and introspection tools still register, run tools answer that no execution capability exists in this session, and the actor-side tools stay unregistered. The generated [configuration catalog](../../../docs/config-catalog.md#deepseek-aidsh-tool-dynamic-workflow) defines `enable` and `enablePromptSection`.

```yaml
- name: '@deepseek-ai/dsh-tool-dynamic-workflow'
```

State-changing tools (CreateWorkflow, AmendWorkflow with a script, SaveWorkflow, ResumeWorkflowRun) pass through an alwaysAsk confirmation gate, so a deployment's approval policy decides whether the user is asked first. The notification minting itself lives in `@deepseek-ai/dsh-workflow-notifications`; this package delivers what that package mints.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Tool factories close over the context and read the optional ports once per call, so a port that arrives or leaves between calls is honored on the next call. The ask gates wrap the handlers instead of the schema, so the model always sees the real schema and the gate owns the confirmation and refusal copy. Run settlements are delivered as `<task-notification>` lines rendered by the notifications package and scheduled through the jobs seam.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, inject, tool registration, and prompt section |
| [`src/tools/writing.ts`](src/tools/writing.ts) | Authoring tools: CreateWorkflow, AmendWorkflow, SaveWorkflow, ListSavedWorkflows |
| [`src/tools/introspection.ts`](src/tools/introspection.ts) | Run introspection: ListWorkflowRuns, GetWorkflowRun, ResumeWorkflowRun, ResolveWorkflowQuestion, ListModels |
| [`src/tools/actor.ts`](src/tools/actor.ts) | Actor-side escalate and submit-result tools (port-gated) |
| [`src/ask-gate.ts`](src/ask-gate.ts) | alwaysAsk confirmation gate over state-changing tools |
| [`src/run-job.ts`](src/run-job.ts) | Run job startup, settlement mapping, and notification delivery |
| [`src/port.ts`](src/port.ts) | Optional port contracts and placeholder responses |
| — | No runtime invariant companion is published because the package is a tool surface; its behavioral tests cover gates, ports, and delivery. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

#### What the model sees

Every parent request in this plugin's registration scope receives the usage-discipline section below when `enablePromptSection` is on.

##### CreateWorkflow discipline

```markdown
Use the CreateWorkflow tool ONLY when the user explicitly asks for a workflow (点名 workflow/工作流): it is mandatory then, regardless of task size. Without such an explicit request, do not start a workflow — delegate with the subagent tools or do the work yourself. A running workflow reports progress by itself; do not poll it.
```

#### Token effect

Small fixed guidance cost per request while the plugin is active.

#### KV Cache effect

Prefix-stable while the plugin scope and section text are unchanged. Activation, disposal, or a `enablePromptSection` change may invalidate reuse from this prompt section.

### Tool schema

#### What the model sees

The generated [`CreateWorkflow`, `AmendWorkflow`, `SaveWorkflow`, `ListSavedWorkflows`, `ListWorkflowRuns`, `GetWorkflowRun`, `ResumeWorkflowRun`, `ResolveWorkflowQuestion`, `EvalWorkflowSnippet`, and `ListModels` schemas](../../../docs/tool-catalog.md#deepseek-aidsh-tool-dynamic-workflow) carry the complete parameter contracts. The escalation and submission tools are not in the default harvest because they register only where the actor ports exist.

#### Token effect

Substantial fixed schema cost for the authoring tools on each request where they are visible; introspection schemas are smaller.

#### KV Cache effect

Prefix-stable while registration and visibility are unchanged. Plugin lifecycle or scoped tool restrictions may invalidate reuse from these schemas.

### Tool-call history and result

#### What the model sees

Calls remain verbatim in the assistant tool call. Authoring calls confirm the saved workflow and its question gates; run tools answer with run status, current phase, artifact rows, or a pending question, and absent ports answer exactly that no execution capability exists in this session. Terminal settlements reach the model later as `<task-notification>` lines with delivery guidance; a refused confirmation gate is a plain refusal result.

#### Token effect

Results are capped rendered summaries; long payloads truncate rather than stream, and notification delivery is bounded by the notification truncation cap.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Absent ports are placeholder answers** — the tools describe a no-capability session instead of failing loudly; compositions that expect execution must mount the journal.
- **Confirmation gates are policy-dependent** — with alwaysAsk approval disabled, the state-changing tools run without a user prompt.
- **No partial amend** — AmendWorkflow replaces the declared parts wholesale; there is no merge semantics for overlapping edits.
- **Actor tools are composition-shaped** — escalate and submit-result exist only where the workflow actor ports are mounted, so their availability differs between runs and sessions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
