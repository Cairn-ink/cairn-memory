# Content-free model failure diagnostics

Base: `85c421df605ed9c231293536bdd6f5a85ddddca1` (unmerged PR #40,
including merged #39). This is a dependent diagnostic slice, not a quality pass.

## Acceptance

- D1: Add an optional trusted in-process diagnostic callback to the OpenAI model
  and support the same optional model callback in the shared core. Existing
  callers and public result/MCP envelopes remain unchanged. No default logging,
  files, telemetry, retries, model/prompt/schema changes or relaxed validation.
- D2: Events contain only a version, allowlisted model stage (extract, classify,
  select, rank), layer and static reason. Never include provider text, exception
  message/stack, query, IDs, receipts, keys, paths, raw responses or input values.
  Publish the finite event schema. Observer throws/rejected promises must not
  alter model/core outcomes or become unhandled rejections.
- D3: Distinguish adapter response envelope, usage, message/content, JSON and
  output bounds failures; core model-call bounds/provider failures; core output
  validation for extraction/classification/select/rank. Distinguish malformed,
  duplicate and non-visible recall references and namespace selection limits.
  Emit only at failing boundaries, without claiming every event is a unique
  failed operation; nested layers can report the same failure.
- D4: Existing sanitizer, exact namespaces, revisions, output limits and capture
  admitted-but-unfiled semantics stay intact. Observability cannot introduce a
  callback after recall's authoritative final read. No mutation or source data
  is supplied to observers. Invalid optional callback configuration fails early.
- D5: Tests use actual core/adapter with synthetic stores and fake HTTP. Cover
  static reasons, all four ports, malformed and foreign/duplicate references,
  observer throw/async reject, disabled observation, success silence and no
  secret reflection. Verify original public failures remain byte-shape equal.
- D6: Run applicable core/adapter tests and demos on Node 22.16 and 24, generic
  plugin/JSON and pinned plugin validations. Independent Standards and Spec
  review exact committed diff before push. No paid calls or private-app changes.
  Include the new helper in the explicit artifact allowlist and verify installed
  artifact tests on both runtimes, not just source imports.

## Follow-up boundary

This first slice supplies diagnostics, not historical root causes: the old
provider bodies were not retained and cannot be reconstructed. A follow-up must
wire bounded diagnostics into the experiment runner and retain nested ingestion
failures before a separately frozen, budget-authorized live test. Only then fix
demonstrated recall defects and rerun the complete Hermes lifecycle. Do not
relabel prior failures, change the benchmark or retry until green.

## Verification and ownership

Separate agents performed read-only loss-point diagnosis, runtime implementation
and independent test implementation. Primary owned acceptance, privacy docs,
artifact integration, code inspection and reruns. Main caught a missing import
and hardened invalid layer handling; tests exposed pre-aborted cancellation
observation, corrected without changing the exception. No paid calls occurred.

Primary verification on Node 22.16.0 and 24.15.0:

- Core suite: 190/190 on each, including 9 new core diagnostic tests.
- OpenAI adapter: 89/89 on each, including 8 new adapter diagnostic tests.
- MCP: 18/18; artifact installation: 14/14 on each, including an actual
  installed-adapter diagnostic probe with no HTTP.
- Plugin: 31/31 and JSON/version validation passed on each.
- Store, MOC, recall, capture and offline OpenAI demos passed on each using
  synthetic temporary SQLite and scripted decisions.
- Pinned Claude 2.1.260 marketplace and strict plugin validation passed.
- `git diff --check` passed. No TypeScript gate exists in this JS repository.

No model or semantic-quality result follows from these offline checks.

## Follow-up acceptance: retain experiment causes

The read-only audit confirmed that comparison summaries drop
`outcome.result.classification.error` for a partial admission. Preserve that
allowlisted cause with stage `classification`; top-level capture failures use
stage `capture`, not a guessed extraction stage. Keep partial status, ingestion
stop behavior, scoring eligibility and all original reports unchanged.

The aggregate should project only a finite `{stage, reason}` failure, with no
memory/source/event IDs, text or arbitrary error fields. Unknown codes must map
to fixed fallbacks, including strings that happen to look like legal code names.
Prove the projection through actual scripted core ingestion and a pilot report;
later batches must remain not-run and baseline arms must still complete.

Separately wire a bounded opt-in diagnostic collector into the actual installed
Hermes experiment path. Rebuild and pin the tested archive, keep old reports,
and verify the collector with fake HTTP before any new paid trial. This is not
implicit authorization to reset the existing budget ledger or run until green.
