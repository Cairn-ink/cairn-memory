# Offline predecessor source binding

Owner: delegated GPT-6.1 Sol worker, reasoning high. Primary owns acceptance,
integration, independent two-axis review, full gates and delivery. Fixed base:
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`; branch
`experiment/neighbor-source-binding`. No worker commits or pushes. No further
workers. Token/cost/elapsed measurements unavailable unless recorded below.

This packet is real-core offline feasibility, not an answer-quality experiment.
Only this plan, `evaluation/architecture/neighbor-source-binding.mjs` and its
new synthetic test file may change. No old cases, fixtures, gold, private
outputs, credentials, budgets or live services are inputs.

Primary delivery integration also updates `docs/limitations.md`, as required
by `CONTRIBUTING.md` for evidence boundaries. The three-file worker ownership
above is unchanged; this fourth file only discloses the offline experiment's
limitations. No product-readiness or semantic gate changes.

## Observable acceptance, frozen before implementation

- N1: Build detached trusted snapshots with real `captureSnapshot` using explicit
  `indexed-evidence-v1` and real `sourceWindowCatalog`. Validate the entire original
  output with `extractedWindowItems` before expansion. Malformed batches fail,
  empty output remains empty; generated content/kind/confidence stay identical.
  Reuse core redaction, UTF-16 spans, identities and existing input/catalog caps.
  Consume the one first-output invocation before validation, including failures.
- N2: For each original selected index in ascending canonical order consider
  exactly index minus one, once. The predecessor may be in the same message or
  the immediately previous submitted message. Never recurse, skip roles, infer
  time/causality, or search other batches/sessions/history/staging/Raw.
- N3: Keep original selection and receipt order intact. Deduplicate exact receipt
  identities; append only into spare existing four-receipt item slots. Preserve
  800-unit/window, 64-catalog and five-item caps. Diagnose no predecessor, already
  retained, attached, receipt cap, disabled, or optional deterministic added-byte
  exhaustion. A supplied byte bound is evaluation-only; baseline always remains.
  Preserve existing core output bounds (40,000 raw JSON units and 1,024 tokens)
  using the exact trusted synchronous model counter: original overflow fails;
  optional additions crossing either bound are skipped with `output-cap`.
- N4: Both arms use the same extractor-selected/dialogue-context projection.
  These roles express mechanical provenance, never semantic support, adoption,
  reaffirmation or supersession. A text-free evaluation sidecar binds namespace,
  capture/item/window/span, actual canonical memory ID/revision/content digest,
  actual receipt ID and identity/content digests. Cold authoritative get and
  source-evidence fetch must reject stale/deleted/foreign/missing/mismatched
  bindings; publish only core text. No production DTO/schema changes. Count actual
  aggregate receipts, including deduplicated memories exceeding four receipts.
- N5: Baseline/enabled normal `core.capture` use the same first scripted extraction
  output, real indexed binder/atomic admission/classification, then close/reopen.
  Added exact bytes and speaker role survive source-evidence reads; original
  anchors/content remain identical. Compare extractor invocation input to the
  trusted catalog before transformation. No direct-admission substitute.
- N6: Disabled intervention loses only the added passage. Synthetic controls cover
  first window, preselected/duplicate neighbors, four selected receipts, long
  message and non-BMP boundaries, resource exhaustion, malformed/empty outputs,
  unrelated adjacency and an unadopted assistant recommendation. These establish
  mechanical provenance only.
- N7: Synthetic real stores exercise namespace/redaction/correction/forget/replay
  and cold reads. Replay never reruns extraction or resurrects forgotten memory;
  sidecar is never authority. Any unexplained first-attempt completion regression
  blocks acceptance. Only real SQLite tests may skip on unsupported Node 20;
  Node 22.16 and 24.15 must pass with zero skips.
- N8: No generation beyond existing scripted extract/classify, embeddings, MOC
  policy, services, defaults, host or retention changes. Production adoption
  needs explicit retention-contract review; raw archival is unimplemented.
  `sourceSnapshot` is capped at 12 and is not a normal retrieval guarantee or QA
  substitute; this experiment uses authoritative get/fetch instead.
- N9: Report per-item selected/added/skipped receipt counts and UTF-8 bytes, actual
  core/model calls, canonical aggregate receipt counts and cold source presence.
  No answer-quality claim. A next semantic study remains unauthorized/unselected:
  independently authored fresh paired QA, common reader/schema/budgets, preserve
  all failures, require at least 3 net supported-answer gains out of 24, increased
  retained and packed necessary evidence, no new severe/unsupported/stale use and
  no lost correct required decisions. Never mutate closed cases or select by gold.
- N10: Worker runs owned focused tests on Node 22.16/24.15 and records actual exit
  codes. Cross-check changed-file lists from Git and independent filesystem
  enumeration, diff lists and print count. Primary reruns full gates and obtains
  fixed-SHA two-axis non-author review before push.

## API and caller boundary

`createNeighborSourceBinding(input, { countTokens, enabled, maxAddedBytes? })` retains a
detached bounded trusted snapshot/catalog. `transform(request, originalOutput)` validates
then modifies sourceIndices alone. `summary()` reports mechanical accounting.
`bind(core, firstCaptureResult)` resolves admitted canonical IDs using the existing
core fingerprint and get. It returns `{ sidecar, expectedDigest }`, with the
SHA-256 pin stored separately by the trusted operator or frozen manifest.
`resolveNeighborSourceBinding(core, namespace, sidecar, expectedDigest)`
checks authoritative capture membership through `inspectAdmission`, get and
source-evidence fetch and projects both provenance
roles with the same schema. Sidecars contain digests/IDs, never receipt text.
The explicit expected digest is never read from the sidecar: a self-supplied
checksum is not an integrity authority. The pin covers the full JSON-serialized
sidecar, including provenance roles, item/window/spans and capture payload digest.
Serialization/deserialization preserves the representation; reordering fields
requires a fresh trusted pin. No signing or production schema is introduced.
The required `countTokens` function must be the same synchronous deterministic
function installed as `model.countTokens` for this normal capture. If a tokenizer
uses `this`, bind it once and share that same bound function. The helper cannot
inspect which model object the caller passes to core, so this is an explicit
caller prerequisite, not an enforced model-identity guarantee. Counter callbacks
receive only immutable serialized strings; there is no heuristic fallback or
provider call. The helper reuses core token-count validation and the exported
1,024-token output constant; the existing 40,000 raw JSON limit remains exact.

Entrypoints/callers: new offline helper and its new tests only. Existing core
capture/extraction/admission inspection/classify/get/fetch/correct/forget APIs are consumers
under test and remain unchanged. No UI, browser replays, routes or old URL/text
assumptions are affected. No package/CI/host integration is added.

## Evidence and limitations

The helper and sixteen new ordinary synthetic tests implement the packet. No
production caller imports the helper. Both arms successfully complete their
first normal capture and classification using exactly one scripted extract and
one scripted classify. Cold readers expose only a local token counter, with no
generation methods. Source-evidence fetch requires this existing counter port.

The paired first-output control observes:

| Observation | Disabled | Enabled |
| --- | ---: | ---: |
| Selected receipts / UTF-8 bytes | 1 / 73 | 1 / 73 |
| Added receipts / UTF-8 bytes | 0 / 0 | 1 / 69 |
| Skipped predecessor attempts / UTF-8 bytes | 1 / 69 | 0 / 0 |
| Cold authoritative sources present | 1 | 2 |
| Core capture calls / scripted extract / classify | 1 / 1 / 1 | 1 / 1 / 1 |
| Core get / inspectAdmission / source fetch calls | 4 / 2 / 2 | 5 / 2 / 3 |

The added passage is the immediately preceding user's consideration. The original
selected passage remains an unadopted assistant recommendation; there is no
adoption/support inference. A second mechanical control merges three identical
generated items into one actual canonical memory, retaining six receipts (three
selected, 133 bytes; three added, 90 bytes), all six visible cold. Four is the
per-item admission limit, not a global per-memory retention claim.
Both summary and pinned sidecar also report `itemCounts`: each row includes
`itemIndex`, selected/added/skipped counts and their UTF-8 byte counts. Tests
independently reconstruct selected bytes from original source indices and
canonical windows, reconstruct addition/skip bytes from predecessor outcomes,
then sum all per-item fields and compare with the preserved aggregates. This
covers duplicate/preselected/capped/resource controls, the paired real-core
control and the six-receipt merged canonical memory. Primary requested this
bounded N9 reporting correction separately from N4 and output-cap corrections.

Exact focused commands, each actual exit **0**, sixteen passes and zero skips:

```sh
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/architecture/test/neighbor-source-binding.test.mjs
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/architecture/test/neighbor-source-binding.test.mjs
```

Two earlier Node 22.16 runs had actual exit **1**. The first failed before any
capture call because a test Proxy violated the frozen public API's invariant;
plain forwarding instrumentation fixed it. The second completed all actual
captures but cold fetch rejected `token_count_unavailable`; adding only the
required deterministic local token counter fixed the test setup. These are
explained harness failures, not unexplained first-attempt capture regressions;
no core behavior was repaired or retried to hide failure. The deliberate scripted
classification failure is retained as an explicit failed post-admission result,
and replay never retries it.

Git `diff --name-only HEAD` plus `ls-files --others --exclude-standard` was
cross-checked against independent filesystem enumeration of the two scoped
directories minus fixed-base `ls-tree` paths. Sorted path sets were identical,
**3 files**; comparison exit **0**. All are additions, with no tracked edits.
The owner made no commits, pushes, production writes, network/provider calls or historical
cleanup. Primary inspection requested one N4 integration correction before freeze:
protect the whole sidecar with a separately trusted pin and reject forged
empty/subset capture results. The worker implemented this bounded feedback and
added tampered-valid-role/window/span/payload tests, exact canonical member and
suppression accounting, a real correction-kind/revision race and actual forgotten
item suppression. All twelve tests passed on the first run after that correction.
Primary then found a distinct first output-resource defect: optional indices
could turn a valid original output into an over-budget result after extract
returned. This was concealed by earlier constant token counters. The worker's
first output-cap correction requires the same real synchronous counter,
validates original output before additions and skips only optional indices
exceeding the existing raw/token bounds. New normal-core controls prove baseline
and enabled outputs both complete when the original is exactly 1,024 tokens and
an addition would count 1,025, and at exactly 40,000 raw JSON units. Original
1,025-token and 40,001-unit outputs still fail atomically. Failure-consumed tests
reject any second transform after malformed output, catalog mismatch, over-budget
output or asynchronous/invalid counting. Ordinary tests now also use a
deterministic nonconstant counter. All fifteen tests passed on the first run of
this correction. A subsequent primary reminder about counter closures added
explicit revalidation of caller-owned original output after every counter call;
mutations during either original or proposed-addition counting fail rather than
silently using a detached stale copy. The final sixteen-test runs both exit zero
with no skips, taking about three seconds each. Total task
elapsed/token/cost measurements are unknown.

## Primary acceptance before candidate freeze

Primary inspected the complete helper and synthetic tests, personally reran
the integrated paths, and made only the contributor-required limitations note
and this verification record. The implementation remains the delegated worker's.

| Gate | Actual result |
| --- | --- |
| `npm test`, Node 22.16.0, compile cache disabled | exit 0; 651/651, zero skips |
| `node tools/testing/run.mjs evaluation/architecture/test/*.test.mjs`, Node 22.16.0 | exit 0; 99/99, zero skips |
| Same architecture command, Node 24.15.0 | exit 0; 99/99, zero skips |
| Focused predecessor test, Node 22.16.0 | exit 0; 16/16, zero skips |
| `npm run validate` | exit 0 |
| Pinned Claude Code 2.1.260 marketplace and strict plugin validation | both exit 0; owned temporary config removed |
| `git diff --check` and JavaScript syntax check | both exit 0 |

Primary independently compared Git diff plus untracked names against filesystem
enumeration and fixed-base Git blob hashes: **4 changed files**, identical sets,
exit 0, 1,634 nonignored files inspected. These are the three worker additions
plus `docs/limitations.md`. A scoped diff confirms no core, adapter, integration,
plugin, schema or CI change. Full test time was approximately 203 seconds; this
is verification runtime, not model latency. Fixed-SHA independent review and
remote CI remain pending at this pre-commit record.

## Remaining boundaries

The capture payload digest in the text-free sidecar records the trusted snapshot;
the public read API does not expose the stored payload digest for comparison.
Cold checks verify the independently held whole-sidecar integrity pin, actual
completed capture membership, namespace, canonical
memory revision/content, receipt identity/content and source-evidence projection.
Sidecar annotations plus a pin are not a signed archive and cannot restore data.
Resolver validation is per entry: it is not a multi-memory atomic snapshot,
and an earlier returned entry can become stale before later entries finish.
No QA, semantic-quality, production retention or ordinary-retrieval guarantee is
established; the next semantic study is not authorized by this packet.
