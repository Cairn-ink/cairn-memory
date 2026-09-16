# Migration memory lifecycle acceptance

Base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9` (origin/main).
Isolated branch: `test/migration-memory-lifecycle`. No merge, release,
deployment, production database or new model authorization.

The user supplied a migration incident timeline to move evaluation from isolated
relationship proposals to persistent write/update/read behavior. First locate
the failing boundary; do not assume another model call fixes it.

## Acceptance

- ML1: Freeze synthetic events: unconfirmed API-v1 dependency hypothesis;
  confirmed Production dependency and conditional field-removal restriction;
  confirmed retirement of relevant v1 clients, with other dependencies unknown;
  late ingestion of a pre-retirement report; unaffected Staging/backup rule.
  Keep event time separate from arrival order in evidence. No actual migration
  command or external service call is permitted.
- ML2: Exercise real shared SQLite core capture/classification/rationale/recall
  APIs with deterministic injected models, fresh temporary storage and a fresh
  reader process after writes. Preserve traces of sources, interpreted stored
  content, qualification, proposed relations, versions and recalled context.
  No fixture answer, old transcript or writer model closure may reach the fresh
  reader except through persisted memory and ordinary configured APIs.
  Label scripted semantic choices as scripted, not measured model reliability.
- ML3: Separate an integration positive control from adversarial model outputs
  and a complete-source diagnostic control. Show whether hypothesis qualifiers,
  changed premises, unchanged rules and late historical evidence reach the
  reader. Never treat an existing restriction's challenged premise as permission
  to execute, an automatically adopted replacement, or proof all dependencies
  vanished. Unassessed links remain unassessed. Do not hand-author successful
  answers and call them observed agent behavior.
- ML4: Audit source-version dependencies of generated MOC titles/labels and
  proposed rationale. Correct a source through public APIs, restart, then verify
  old revisions/derived content cannot silently reappear as current. Check
  unrelated rules remain unchanged. If a boundary fails, preserve a reproducer
  and identify the minimal production fix before changing runtime semantics.
- ML5: Avoid a second memory engine, unbounded graph, new provider method,
  summary authority or lexical heuristic that pretends to prove semantic truth.
  Initial implementation scope is evaluation/tests and technical documentation.
  A demonstrated deterministic runtime defect may receive a separately scoped
  fix with regression evidence; semantic failure must not be hidden by mocks.
- ML6: Primary inspect traces and rerun relevant gates on Node22.16 and24;
  generic tests, JSON and strict plugin validation plus the complete affected
  suites. Independent Standards and Spec review inspect the same fixed candidate
  before PR. Publish precise passed/failed/unmeasured boundaries, not a blanket
  reliable-system claim. If a paid follow-up is needed, freeze its own bounded
  spec/fixtures, use the existing shared USD50 ledger and reviewed guard; do not
  reuse or rerun the prior once-only experiments.

Implementation delegated to one Sol/high worker for cross-layer persistence and
fresh-process test boundaries. Primary owns acceptance, source-version audit,
integration and any separately scoped runtime-fix decision. Independent reviewers
do not implement. Agent cost/elapsed metrics are unknown unless exposed.

## Implementation record

The Sol/high worker implemented ML1–ML4 in
`core/test/migration-lifecycle.test.mjs`, with a standalone cold reader in
`evaluation/architecture/migration-lifecycle-reader.mjs`. Tests live in the core
suite because SQLite requires Node >=22.16; the generic suite still supports
Node 20. Primary inspection required per-source qualification descriptors
(including the unaffected Staging scope), temporary-store cleanup, and a
restart check after explicit correction. No runtime behavior was changed.

The observed boundary and limitations are recorded in
`docs/migration-memory-lifecycle-evidence.md`. In particular, adding conflicting
evidence is not source-version correction; structurally valid model mistakes
remain possible; and rationale context is an explicit recall mode, not the MCP
default. A passing scripted test does not close those product gaps.

Next: evaluate a bounded source-supported current-state interpretation without
deleting historical evidence or upgrading a challenged premise into execution
permission. Freeze positive, uncertain and adversarial cases before any model
run; separately measure false certainty and useful answers. This PR does not
authorize or implement that follow-up.
