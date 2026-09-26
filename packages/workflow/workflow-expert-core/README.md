---
description: "Expert workflow engine core: phase state machine, DAG graph scheduler, artifact seeding, snapshot persistence ports, and resume lifecycle, with zero host I/O."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-expert-core

English | [中文](README.zh.md)

## Summary

`dsh-workflow-expert-core` is the expert workflow engine kernel: the phase state machine, the `WorkflowGraphScheduler` that dispatches a DAG of nodes, artifact seeding from a phase artifact, the `WorkflowStorePort` for snapshot persistence, and the resume lifecycle (reconcile, cancel, reopen, seed, and prompt update). The kernel owns no host I/O: every side effect goes through injected store and runner ports, and the run vocabulary comes from `@deepseek-ai/dsh-workflow-runs`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose the kernel when you are building an expert-workflow runner host, not when you only want to start a workflow: end-user compositions mount a runner package that embeds this kernel. A host implements `WorkflowStorePort` for snapshot persistence and the runner port for execution, then drives the lifecycle entry points. Subpath entries: `@deepseek-ai/dsh-workflow-expert-core` (barrel), `./scheduler`, and `./lifecycle`.

The kernel never reads a clock, a filesystem, or a network by itself. Tests in this package drive it with in-memory ports; a host that sees different behavior owns the port implementation it injected.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The phase state machine validates transitions before the scheduler observes them; the scheduler dispatches nodes whose dependencies are complete and records skips and cancellations on the graph. Seeding builds the initial graph from a phase artifact so a resumed run reuses the same derivation as a fresh one. The lifecycle functions are pure state transitions over a snapshot plus ports: reconcile aligns a restored snapshot with the definition, and cancel, reopen, and prompt updates return the next snapshot for the host to persist.

### Source map

| File | Role |
|---|---|
| [`src/definition.ts`](src/definition.ts) | Built-in expert workflow definition and strategy defaults |
| [`src/expert.ts`](src/expert.ts) | Phase state machine and engine state |
| [`src/scheduler.ts`](src/scheduler.ts) | Workflow graph scheduler over the node DAG |
| [`src/lifecycle.ts`](src/lifecycle.ts) | Resume lifecycle: reconcile, cancel, reopen, seed, and prompt updates |
| — | No runtime invariant companion is published because the kernel owns no host state; the lifecycle tests pin its transitions. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the kernel registers no tool, prompt section, or event of its own; the runner and tool packages that embed it own every model-visible line.

#### KV Cache effect

Independent of the model request cache: the kernel contributes no tokens to any request. Its snapshots reach model context only through the consumers that render them.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **All I/O is the host's responsibility** — a lost or partially applied snapshot write surfaces at the host, not as a kernel retry.
- **The scheduler is cooperative** — node dispatch trusts runner results; there is no kernel-side enforcement of runner claims.
- **The vocabulary is closed** — adding a phase or node status is a `dsh-workflow-runs` change, and old persisted snapshots must stay reconcilable.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
