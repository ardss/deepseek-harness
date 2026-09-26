---
description: "Browser preset boards for workflow run artifacts (chart, table, metrics, board) with lenient spec parsing and a degrade card."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workflow-artifacts

English | [中文](README.zh.md)

## Summary

`dsh-client-ui-workflow-artifacts` renders workflow run artifacts in the browser as preset boards: chart, table, metrics, and board layouts, each driven by a lenient spec parser that accepts partial or loosely typed artifact specs and falls back to a degrade card instead of throwing. The package is a web-platform client plugin: it mounts into the browser composition, renders projected run records, and registers nothing on the host or model side.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Add the package to a web client composition; the client loader injects it alongside the locale, renderer, and slot packages. Run-detail and run panels hand it artifact specs from projected run records. A spec the parsers cannot interpret renders the degrade card with the reason, so one malformed artifact never breaks the surrounding board.

The `parseChartSpec`, `parseTableSpec`, and related parsers are exported for tests and for consumers that want the same lenient semantics outside the boards.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

Each preset owns a parser that normalizes a spec into a typed view model; missing fields become empty states rather than errors. The boards are CSS-module components over the shared slot surfaces, and every string resolves through the client locale package. The degrade card carries the parse reason so a run author can fix the emitting spec.

### Source map

| File | Role |
|---|---|
| [`src/client/presets/spec.ts`](src/client/presets/spec.ts) | Lenient spec parsers for the chart, table, and related preset views |
| [`src/client/presets/`](src/client/presets/) | Preset boards and the degrade card |
| — | No runtime invariant companion is published because the package renders browser state; its tests cover parser and rendering behavior. |

</details>

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is browser-side presentation of already-logged run artifacts; it registers no tool, prompt section, or session event, and what the user reads never enters a model request.

#### KV Cache effect

Independent of the model request cache: the package contributes no tokens to any request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Presets are a closed set** — chart, table, metrics, and board are the only layouts; a new layout is a package change.
- **Lenient parsing can hide authoring mistakes** — a spec that parses under the lenient rules may render differently than its author intended rather than failing loudly.
- **Large tables render in full** — there is no row virtualization yet; very large artifacts rely on the degrade path.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
