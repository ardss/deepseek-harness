---
description: "Pure minting of dynamic-workflow notifications: terminal task-notification XML, delivery guidance, provider-stop error rows, escalation and stall copy, and artifact line projection."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-notifications

English | [中文](README.zh.md)

## Summary

`dsh-workflow-notifications` mints every notification line the dynamic workflow surface sends: the terminal `<task-notification>` XML, the per-outcome delivery guidance, the table-driven provider-stop `<error>` row, the escalation and stall mid-run notices, and the artifact line projection shared by the notified consumer, the GetWorkflowRun snapshot, and the UI manifest. The package is a set of pure functions with zero I/O; delivery belongs to the calling tool.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Call the minting helpers with plain JSON inputs (the port shapes from `@deepseek-ai/dsh-workflow-runs`) and send the returned text yourself. `formatWorkflowTaskNotification` renders the terminal notification; `workflowDeliveryGuidance` returns the guidance line for a run outcome; the escalation and stall helpers render their mid-run notices. Nothing here records an event, schedules a delivery, or touches a session: the delivering consumer owns all of that.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The terminal notification is truncated to `TASK_NOTIFICATION_MAX_CHARS` with XML text escaped defensively. Provider stops render through a table keyed by stop kind, so an unknown kind still produces a stable `<error>` row instead of an unbounded string. Artifact lines project one row per artifact with the same rendering everywhere, which is why the notified consumer, the run snapshot, and the UI manifest can share it.

### Source map

| File | Role |
|---|---|
| [`src/task-notification.ts`](src/task-notification.ts) | Terminal notification, delivery guidance, and stop-tool naming |
| [`src/copy.ts`](src/copy.ts) | Escalation and stall notice copy and the provider-stop table |
| [`src/artifacts-line.ts`](src/artifacts-line.ts) | Shared artifact line projection |
| [`src/xml.ts`](src/xml.ts) | XML escaping and the notification truncation cap |
| — | No runtime invariant companion is published because the package owns no runtime state; the copy tests pin every rendered line. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the package only mints notification text as pure functions; the tool that delivers a notice owns every model-visible line.

#### KV Cache effect

Independent of the model request cache: minted text enters model context only when a delivering consumer sends it, and that consumer owns retention and reuse.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Copy is fixed at build time** — the guidance and notice lines are code, not configuration; a wording change is a package change.
- **The truncation cap is blunt** — long result payloads drop a suffix marker rather than a structured summary.
- **Unknown stop kinds degrade to the generic row** — the table renders a stable but unspecific `<error>` line for kinds it does not know.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
