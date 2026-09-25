# Indexed-window evaluation provenance: offline integration

Fixed base: `dbfe5d80a6c0091c2e086a0ec4c5eb4d91e46920` (PR #220).
Branch: `test/indexed-window-provenance`. Primary owns this frozen contract;
GPT-6 Sol/high implements. Do not begin implementation until primary confirms
the dependency's exact-head CI and both independent review axes have passed.
No merge, release, deployment, real ledger access or paid request is included.

## Goal and status

Build toward a lightweight reliable shared memory core usable through Hermes,
MCP and other harnesses. The immediate question is whether later source passages
can survive capture and be honestly used in an evaluation. PR #220 supplies
optional indexed windows; the existing evaluator intentionally accepts only
exact prefix receipts. This packet adds a separately identified offline path,
not a new score or proof that those windows improve answers.

The completed six-case development smoke remains terminal: Cairn 2 correct,
4 wrong, 0 unresolved; full history 3/3/0; no memory 0/6/0. All three completed
6/6. The older 30-case result remains unchanged. Neither cohort may be rerun,
replaced, pooled as one protocol, or relabeled indexed-window evidence.

## Frozen acceptance

- I1 Separate entrypoints: add `planIndexedWindowLongMemEvalCase`,
  `ingestIndexedWindowLongMemEvalCase` and `runIndexedWindowPublicComparison`.
  New plan schema is `cairn-longmemeval-indexed-window-ingestion-plan-v1` and new
  comparison schema is `cairn-longmemeval-indexed-window-public-comparison-v1`.
  They retain the corresponding legacy option shapes; callers cannot inject an
  arbitrary policy or receipt validator. Internal sharing uses closed immutable
  policy dispatch. Existing exported entrypoints, plan/report schemas, prompts,
  digests, error behavior and legacy exact-prefix verification stay unchanged.
  Pin deterministic legacy plan and answer-request golden controls against the
  fixed base; do not assert equality on clocks or randomly generated store IDs.
- I2 Trusted preparation: reuse the existing deterministic source partition,
  batching, client, event/message IDs and source map. Before any capture callback,
  snapshot each planned batch with `captureSnapshot(input, 'source-bound-v2',
  'indexed-windows-v1')` and derive its real `sourceWindowCatalog`. Record the
  indexed digest, not the old plan's default digest, and explicit source policy
  and qualification in the new plan. Every catalog entry is host-derived from
  normalized/redacted text, not caller/model offsets. Preserve raw reconstruction
  and original source date/role/identity. If indexed preflight or catalog building
  fails, retain a finite `indexed_window_preflight_failed` blocker and make the
  whole plan non-executable: zero capture callbacks, no partial ingestion or
  automatic rebatching, policy fallback, repair, retry or raised limits.
- I3 Indexed outcomes: validate the actual opt-in capture success envelope,
  including exact `sourceWindowCatalog` fields and values matching this submitted
  batch's trusted catalog. Require it for every successful response, including
  duplicate/processing, and reject extra, missing, malformed or mismatched fields.
  Failure envelopes stay the existing closed shape with no success metadata.
  Do not strip metadata in a caller wrapper to bypass the old classifier. A small
  shared internal classifier may validate the legacy portion only after the new
  entrypoint has checked its own metadata. Retain outcome metadata in the new
  record; it describes the submitted view, not prior execution or semantic
  coverage. Preserve statuses, stop-on-first-incomplete, all planned denominators,
  immutable snapshots before await and finite safe errors. No success promotion.
- I4 Exact provenance: preserve every existing source-only recall and authoritative
  full-get check (namespace, active/current state, matching revision, exhaustive
  receipt set, unique memory/receipt IDs, role, client, session and message ID).
  For the new path only, accept a receipt iff its exact canonical excerpt is a
  member of the trusted indexed catalog for that same message. Never accept an
  arbitrary substring, concatenated windows, foreign same-text message, stale
  revision, partial get, forged offsets or recap-generated evidence. Existing
  legacy verification must still reject incompatible tail receipts. Equal text
  repeated within one source proves membership, not a unique raw occurrence;
  do not expose or claim an occurrence offset. Candidate mapping returns only
  the source fields already used by the answer path, not the full transcript,
  memory paraphrase, catalog, model claim, evaluator label or reference answer.
- I5 Report identity and limits: new reports explicitly identify
  `captureSourcePolicy: 'indexed-windows-v1'` and
  `captureQualification: 'source-bound-v2'`; keep source-time metadata-only and
  semantic-coverage-unassessed limitations. Existing answer template versions,
  counters, packing, arm order, deadlines and prior-timeout stop behavior are
  unchanged in this offline packet. Record that this is not a balanced paid
  comparator. The existing official scorer must reject the new report before
  calling a judge; do not modify it or relabel the report to force scoring.
  Old paid guards continue to reject the new extract wire. No CLI/live-runner,
  native/MCP flag, new capability, price, model or budget change is included.
- I6 Actual-flow evidence: use synthetic histories and a real core with scripted
  ports for capture/admission/qualification, close and reopen before recall/get,
  then inspect the answer request for a useful passage after unit 800. Cover
  multiwindow support, Unicode/NFKC/redaction, mixed roles, exact identity,
  wrong namespace/revision/session/message/role, arbitrary substrings, missing/
  extra/duplicate receipts and inconsistent catalog metadata. Include empty and
  duplicate captures, partial classification, early failure with later not_run,
  caller mutation while awaiting, unrepresentable indexed preflight with zero
  callbacks, old classifier refusal and old scorer refusal with zero judge calls.
  At least one base-version red probe must demonstrate the actual integration
  mismatch, not just absence of the new export. Capture success metadata and
  tail-source refusal are appropriate seams. Never use downloaded corpus/keys.
- I7 Verification: worker traces changed callers including public-pilot and
  official-scoring without widening them. Run focused new tests and full
  `test:longmemeval`, all three LongMemEval demos, `npm test`, JSON validation,
  verified local pinned Claude Code 2.1.260 strict validation on both Node
  22.16.0 and 24.15.0. Because shared ingestion/comparison is consumed by live
  runners, also run `test:live-evidence-offline` with isolated adapters on both.
  Run request-guard tests to preserve W10 refusal if tests touch that integration;
  do not alter guard code. No typecheck exists in this JavaScript repository.
  Primary inspects the full diff, personally reruns final integrated tests and
  both runtime gates, then obtains separate Standards and Spec reviews of the
  same original-base candidate. After fixes repeat affected gates and both axes.
  Deliver as dependent PR against `feat/retained-source-windows`; require all
  exact-head CI checks and mergeability before ready. Do not merge.

## Allowed files

This plan; `evaluation/longmemeval/ingestion.mjs` and `public-comparison.mjs`;
at most one small policy/provenance helper in that directory if needed; focused
new tests under `evaluation/longmemeval/test/`; a synthetic demo and a new root
package demo script if useful; technical `docs/indexed-window-provenance.md`,
bounded clarifications in `docs/longmemeval-ingestion.md`,
`docs/longmemeval-comparison.md`, `docs/limitations.md` and `CHANGELOG.md`.
No core, adapter, scorer, ledger, guard, live-runner, packaging, host, dependency,
storage or model changes. If an interface needs any such change, report the
concrete mismatch to primary before editing; do not quietly loosen acceptance.

## Next gates and resume protocol

After this offline integration is accepted, freeze scoring compatibility and a
separate guarded, balanced fresh comparison protocol. Isolate window effects
with qualified-prefix versus qualified-window controls; comparing default to
qualified-window changes qualification too. Fresh development and untouched
held-out cases, finite shared ceilings and failure-inclusive denominators remain
mandatory. MOC routing and Mem0 comparison are distinct experiments, followed
by installed growing-collection measurements and cold-context onboarding.
No pass here establishes S2 answer quality, S3 competitor parity or S4–S5.

At every resume read this contract and the latest evidence section, check the
actual worktree/branch/head and current PR CI, then continue the first unpassed
gate. Record commands, final SHAs, review findings and retained failures here or
in the PR. Never infer launch permission from an offline green check. User API
ceiling is US$200 cumulative; the actual operational ledger is still US$100.
Last audited reserved amount is US$86.171460, 12,633 terminal requests; these
numbers are historical, not a fresh ledger read. Do not access or migrate the
operator ledger for this packet. No user decision is pending.
