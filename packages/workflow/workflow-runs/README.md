---
description: "Run-state vocabulary for the migrated ZCode workflow engines: expert and dynamic run words, host runtime port types, and pure projection helpers."
kind: "package-reference"
---

# @deepseek-ai/dsh-workflow-runs

English | [中文](README.zh.md)

## Summary

`dsh-workflow-runs` holds the two mutually exclusive run vocabularies of the migrated ZCode workflow engines. The `expert` entry carries the expert engine's phase, node, and run status words; the `dynamic` entry carries the dynamic run status, stop reasons, and the portable JSON shapes that ports and notification copy carry. It also declares the host runtime port types the expert engine references and pure projection helpers over run records. The package holds no I/O and registers nothing model-facing.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Import the vocabulary that matches the engine you compose with. Expert-engine compositions import the expert words and the runtime port types; dynamic-journal compositions import the dynamic words and the port JSON shapes. The existing `@deepseek-ai/dsh-workflow` CLOSED outcome union is a separate vocabulary: the two sides must not be mixed in one run record, and the package provides no conversion between them.

Subpath entries: `@deepseek-ai/dsh-workflow-runs` (barrel), `./expert`, `./dynamic`, and `./runtime`. All exports are types, zod schemas, or pure functions; mounting the package in a composition has no effect because it ships no plugin.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Types are plain interfaces and zod schemas; the projection helpers derive a renderable summary from run records without touching host services. `SessionEvent` in `./runtime` is an opaque structural view of a host session event: the engine forwards it without interpreting `payload`, and the host passes its existing event objects directly.

### Source map

| File | Role |
|---|---|
| [`src/expert.ts`](src/expert.ts) | Expert run words: workflow kind, phase and node status, run status, and their zod schemas |
| [`src/dynamic.ts`](src/dynamic.ts) | Dynamic run words: five-state status, stop reasons, and portable JSON mirrors of port payloads |
| [`src/runtime.ts`](src/runtime.ts) | Host runtime port types: session-event view, trace context, and store port inputs |
| [`src/projection.ts`](src/projection.ts) | Pure run-record projection helpers shared by tools, notifications, and UI panels |
| — | No runtime invariant companion is published because the package owns no runtime state; the vocabulary tests cover its algebra. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the package only declares run-state vocabulary and pure helpers; it registers no tool, prompt section, or session event.

#### KV Cache effect

Independent of the model request cache: the package contributes no tokens to any request. Consumers that render its records own the model-visible text.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The two vocabularies are deliberately incompatible** — expert and dynamic words describe different engines; there is no crosswalk, and mixing them in one record fails only at the consumer.
- **`SessionEvent.payload` is `unknown` by design** — the engine forwards it without interpretation; a consumer that needs typed payloads owns its own narrowing.
- **Projection is best-effort** — the helpers render what a record carries and never reconstruct missing fields.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
