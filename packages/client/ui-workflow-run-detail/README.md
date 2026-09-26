---
description: "Workflow run detail side pane: status header, vertical phase spine, results and artifacts, event log, and run actions."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workflow-run-detail

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-workflow-run-detail` is the browser side pane for one workflow run: a status header, a vertical phase spine, the run's results and artifact boards, the event log, and run actions. The pane projects the durable run record and its events into a view model and renders it with the shared client surfaces. It is a web-platform client plugin and registers nothing on the host or model side; the artifact boards themselves live in `@deepseek-ai/dsh-client-ui-workflow-artifacts`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the package to a web client composition; the client loader injects it alongside the right-sidebar, renderer, locale, and job-controller packages. The pane opens from the workflow run list and follows the selected run. Actions it offers (cancel and resume where the run state allows) dispatch to the host run controls; the pane renders whatever the projected record and events contain and never mutates run state itself.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The pane derives one view model from the run record plus the event stream: the spine is a projection of phase and node states, the event log is the filtered run's events in sequence order, and the results region forwards artifact specs to the artifact preset boards. All strings resolve through the client locale package, and actions are enabled from the run status alone.

### Source map

| File | Role |
|---|---|
| [`src/client/`](src/client/) | Pane components, view-model projection, and locale wiring |
| — | No runtime invariant companion is published because the package renders browser state; its tests cover projection and rendering behavior. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is browser-side presentation of durable workflow records; it renders logged runs without changing model context.

#### KV Cache effect

Independent of the model request cache: the package contributes no tokens to any request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Read-only over the record** — the pane renders and dispatches; it cannot repair a run whose record is inconsistent.
- **Event log is append-only order** — late-arriving events append; there is no reordering or merging view.
- **Actions follow run status, not permissions** — a status that allows cancel shows the control even if the host later rejects it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
