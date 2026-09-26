---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-26-workflow-run-updated-events

English | [中文](2026-09-26-workflow-run-updated-events.zh.md)

## Summary

Adds two log-only workflow run projection events, expert-run/updated and journal-run/updated, emitted by the migrated ZCode workflow engines (workflow-expert-core and the dynamic-workflow journal) so UI clients can render live run progress.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

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
## Compatibility

New roots in the same Session format version. Existing logs contain neither event and stay valid; readers that predate them refuse a log carrying them, as every required-on-read event does. Both events are append-only progress projections; the workflow run UI panels are their only consumers and read the latest event per run.

<a id="verification"></a>
## Verification

pnpm exec vitest run packages/workflow/workflow-runs packages/workflow/workflow-notifications packages/workflow/workflow-expert-core packages/workflow/tool-dynamic-workflow: 154 tests passed across 16 files, including the projection thread-safety specs that round-trip the new event payloads; pnpm run gen-persistence-catalog re-derived both root digests from the source definitions.

<a id="dev-note"></a>
## Dev Note

None.
