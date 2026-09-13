# Installed ordered capture → fresh MCP lifecycle

This is a separately versioned, programmed diagnostic over the installed preview
package. It prepares an offline acceptance gate, not a real-model quality result
or autonomous host integration. The [frozen protocol](plans/installed-ordered-loop.md)
keeps original installed-v1 evidence and the failed history audit unchanged.

## What the new gate exercises

1. Capture Friday, then an explicit Monday update through the installed core,
   closing/reopening the store between source windows. Retain the old record as
   physical history with original receipts and an actual replacement relation.
2. Start a fresh MCP process to recall the current successor and inspect history.
   Separate foreign-owner and foreign-project processes cannot read or mutate it.
3. Start another process, rediscover the current ID/revision, and explicitly
   correct it to Tuesday. Reject a stale correction.
4. Start a new process and recall the corrected record with explicit provenance.
5. Start another process, reject stale forgetting, then forget at its freshly
   inspected revision. No other memories are mass-deleted to manufacture success.
6. Start a final process: current recall must be complete and empty, the forgotten
   successor is inaccessible, and the predecessor remains historical—not revived.

Correction intentionally removes the former successor receipts. History must
show that its selected evidence is unavailable, not pretend Tuesday's correction
was the original Monday source. After forgetting, the relationship must not leak
the forgotten successor's identity or content. The historical predecessor can
remain in inspection listings; an empty current recall is not an empty database.

The target must be unambiguous in fresh recall/inspection before mutation. This
is a narrow controlled lifecycle. It does not claim generic semantic deletion,
support for arbitrary chat histories or automated capture in every MCP client.

## Installation and transport boundaries

The harness verifies the archive SHA256 and every allowlisted installed source
file. Capture uses the installed core/provider; consumers are actual new stdio
MCP processes using that installation. It does not silently substitute source
checkout modules for the installed runtime.

An injected session controls transport. Offline tests script HTTP responses;
the children receive only a local proxy capability, not a real provider key or
the parent application's environment. No key or paid request is needed for
offline acceptance. A future real-provider session must use the separately
authorized combined guard and the existing cumulative budget.

Failures retain attempted envelopes, partial snapshots and later not-run stages.
Cleanup/persistence failure prevents a successful report. Private files use
exclusive writes; inability to persist is explicit, with evidence retained in
the returned failed report when possible. No model or failed-stage retries.

## Verification

Follow [artifact preparation](install-artifact.md) to build, inspect and install
the preview into a dedicated temporary project. Install both isolated adapter
dependency sets, then run the ordinary offline suite:

```sh
npm run test:live-evidence-offline
```

That suite explicitly skips installed tests when the four public selectors are
absent. A skipped positive case is not acceptance. To exercise the real install,
set CAIRN_NODE, CAIRN_EXECUTABLE, CAIRN_ARTIFACT and CAIRN_ARTIFACT_SHA256 to the
verified local Node/executable/archive/hash, then run:

```sh
node --test evaluation/live/test/installed-ordered-capture-loop.test.mjs
```

Run with Node22.16 and24 and require zero skips in that selected file. Do not set
OPENAI_API_KEY: these tests fake only provider decisions while retaining actual
SQLite, adapter, tokenizer, proxy and MCP subprocess behavior.

Even a successful report is `mechanical_pass_pending_semantic_review` and marks
every stage as requiring independent semantic review. It does not authorize a
paid attempt, publication, default-model promotion, release or deployment.
