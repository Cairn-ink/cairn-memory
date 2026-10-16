# Source-to-proposition builder: bounded offline prototype

Delivery update (2026-10-17): the subsequently frozen controlled comparison is
complete and **failed**. [Public retained result](../evidence/source-proposition-comparison.md):
10/24 to 11/24 source passes, net +1, ten lost correct decisions, three new
severe assertion instances in two sources. Do not adopt. The historical offline
prototype contract/status below is preserved; no production default changes.

Status: bounded offline implementation; primary contract corrections recorded
below after the first scripted implementation. Evaluation only. The previous
post-hoc refiner failed its no-harm gate. This prototype explores replacing
extraction plus qualification with one joint source-only call, not adding a
second pass or a never-downgrade rule. It establishes plumbing, not semantic
accuracy or a product architecture win.

## Scope and ownership

- Fixed base: `ad274b6117f86446fbf0ff16f503ae69d0278ce5`.
- Isolated worktree branch: `experiment/source-proposition-builder`.
- Worker: actual GPT-6.1 Sol, high reasoning, as dispatched by the primary.
- Owned files: this plan, `evaluation/architecture/source-proposition-builder.mjs`,
  and `evaluation/architecture/test/source-proposition-builder.test.mjs` (3).
- Initial timebox: 60 minutes; checkpoints at contract, implementation/test
  milestones and at least every 15 minutes. Elapsed time and agent cost remain
  unknown unless directly measured. No paid calls are authorized or performed.
- No core, adapter, prompt file, persisted DTO/schema, runtime caller, browser
  entrypoint, MOC, lexical/vector index or product default changes. No provider,
  environment/key, operational ledger or historical paid-case access. The
  primary owns final verification, selection, commits and independent reviews.

## Acceptance contract

P1. `prepareSourcePropositions(input)` accepts the existing trusted capture
envelope (`namespace`, `client`, `eventId`, `sessionId`, `messages`, optional
`causal`). It first copies a strict JSON-data boundary, rejecting accessors,
non-plain objects, symbols, sparse arrays, cycles, malformed Unicode and
non-finite numbers without invoking supplied getters or `toJSON`. Input has
1–3 messages, user/assistant only, unique trusted message IDs, each 1–800 raw
UTF-16 units and still 1–800 units after existing canonicalization. Oversize
input is refused, never silently truncated. Existing `captureSnapshot` and
`retainedSourceView` produce the trusted source view; normalization/redaction is
the existing core contract, not preservation of raw text byte offsets.

P2. Preparation uses `createQualificationCandidateSnapshot` on an internal
evidence-catalog scaffold solely to reuse canonical receipt handling and
non-overlapping, code-point-safe 200-unit candidate splitting. The scaffold is
never admitted or exposed to the model. The frozen request contains only a
general instruction and
`{candidates:[{candidateIndex,sourceIndex,segmentIndex,role,text}]}`; no source
IDs, namespace owner, session identity, prepared card/kind, prior qualification,
gold, oracle or case labels. Candidate indices are transient evidence references.
`sourceIndex` groups segments from the same original message; `segmentIndex`
orders that message's canonical windows. Both are transient positions, never
trusted receipt/message identities. Trusted state is held in a module-private WeakMap keyed by the frozen prepared
handle, separate from its frozen request and schema. Callers cannot manufacture
trusted state or mutate it through an input/request/output alias.

P3. Compact joint wire (exact keys at every level):

```text
{propositions:[{
  content, kind, confidence, evidenceIndices:[candidateIndex,...],
  role:{value:"observation"|"choice",evidenceIndices:[...]},
  claimant:{value:string|null,evidenceIndices:[...]},
  subject:{value:string|null,evidenceIndices:[...]},
  property:{value:string|null,evidenceIndices:[...]},
  scope:{value:string|null,evidenceIndices:[...]},
  applies:{value:string|null,evidenceIndices:[...]},
  value:{value:string|null,evidenceIndices:[...]},
  attribution:{value:"direct"|"reported"|"quoted"|"proposed"|"unknown",evidenceIndices:[...]},
  commitment:{value:"adopted"|"considered"|"rejected"|"unknown",evidenceIndices:[...]}
}]}
```

There are 0–5 propositions in returned order. Content is canonical, nonempty,
well-formed text of at most 600 UTF-16 units; kind is the existing
fact/preference/decision/instruction/context enum; confidence is finite 0–1.
Subject/property/value and claimant are canonical text at most 160 units;
scope/applies at most 120. Null claimant means unknown, never namespace owner.
Known fields need citations; role needs 1–4; unknown fields may have 0–4.
Each reference array is unique, in-bounds and at most four; every field reference
must belong to the proposition's nonempty selected `evidenceIndices` (1–4).
Across source selection, seven fields and two sidecars there are at most four
distinct candidates per proposition. Qualification itself must cite at least one.
An observation has unknown decision commitment. A choice may have unknown
commitment: an offered option does not establish any stance of its represented
claimant. Adopted/considered/rejected require explicit source interpretation;
none is inferred from the role. An observation with a known commitment is
rejected as a consistency guard, not semantic proof. Choice represents an
option or preference within its conditions; it does not establish semantic
correctness. Preserve conditions, negation, unknown time
and the represented chooser. Value names the option/value, not meta-status such
as “considered”. Confidence does not substitute for stance or grant authority.

P4. `compileSourcePropositions(prepared, output)` accepts a JSON object or exact
JSON string (at most 40,000 UTF-16 units), rejects the entire proposal on any
invalid member, and returns frozen owned copies of `originalOutput`,
`extractedItems`, `items` (real core-compiled items), and `sidecars`, aligned by
proposition index. `originalOutput` preserves an exact original string or an
unchanged detached JSON value before core compilation. No partial substitution.
Selected global candidates map to trusted original receipts; extracted items use
the existing `extractedItems` binder. Their local qualification snapshots may
renumber candidate IDs: remap by original receipt identity and exact span
(start/end/text), never by coincidental candidate index. The existing
`compileQualificationCandidates` validates all seven fields. Role/claimant stay
eval-only sidecars carrying original candidate IDs plus actual trusted receipt,
receiptIndex, start/end/text citations. No model receipt text or identity is
accepted. Existing label canonicalization is not used to silently repair this
wire: raw descriptive labels must already be canonical. Empty output remains
explicitly empty in all four arrays and makes no success/coverage claim.

P5. `buildSourcePropositions(model,input,deadline)` prepares before any supplied
callback and invokes existing `callModel` exactly once through injected method
`proposeSourcePropositions`. No SDK, provider, retry, fallback, persistence,
admission or later model stage. Reuse 6,000 counted input tokens, 1,024 counted
output tokens and minimum 8,192 context; the optional deadline uses the existing
core contract. Strict JSON Schema is returned for offline validation only;
provider compatibility is a separate future gate. The call wrapper validates
and copies the callback result before `callModel` serialization/counting, so
non-JSON accessors/toJSON output is refused without executing them.

P6. Closed errors: `invalid_source_input` for rejected input; `invalid_preparation`
for a foreign handle; `invalid_proposition_output` for malformed JSON/shape/text,
Unicode, duplicate/foreign/unselected/misaligned refs, observation/commitment mismatch or core
compile rejection. Existing `callModel` errors remain unchanged:
`model_not_configured`, `context_budget_exceeded`, `token_count_unavailable`,
`model_timeout`, `model_cancelled`, `invalid_model_output`, and
`proposition_build_failed`. Errors contain no source/model payload. Accessor or
non-JSON model output is surfaced by callModel as `invalid_model_output`.

P7. New small scripted fixtures cover mixed observation and choice, a conditional
settled choice, considered negative option, reported claimant, measurement versus
chosen limit, unknowns and legal empty output. They verify actual source→receipt→
anchor binding, exact identity exclusion, one call, immutable ownership, strict
JSON/schema, candidate collisions across items, reordered references, multi-item
compilation, canonicalization and non-BMP boundaries. Tests use the real compiler
without asserting that arbitrary model claims are true. No future cohort or
paid protocol/cases are authored here. Run through `tools/testing/run.mjs` on
Node 22.16.0 and 24.15.0; run pure fixtures/schema on Node 20 without top-level
SQLite imports. Record actual exit codes. Re-derive the three-file inventory
through Git and an independent filesystem/blob comparison and report the count.

## Evidence boundaries and next gate

Raw evidence, model Memory interpretation and host-curated Card keep distinct
roles. Citation validity does not prove segmentation, claimant, conditions,
commitment, truth or semantic support. Joint generation may hallucinate,
mis-segment, lose correct choices, alter card/candidate counts or overflow the
1,024-token output capacity. One call alone is no quality claim. Unknown does
not mean false, forgotten or deleted.

A future separately authorized prospective comparison would freeze 24 NEW
source cases and rubric before any paid run, pair baseline versus joint builder
with the same pinned model and inputs, include every failure in denominator 24,
require net ≥3 source gains and zero lost correct decisions/new severe errors,
record all calls/tokens/cost, and retain a separate cold gate. This prototype
provides neither those cases nor authority to spend, and does not change the
previous no-harm result.

## Checkpoint and verification record

- Contract checkpoint: plan/wire drafted before implementation and sent to the
  primary. Read shared workflow/model routing, public CONTRIBUTING/glossary,
  capture input, retained view, qualification input/candidate compiler, model
  call/budget and qualification guidance. No runtime entrypoint is changed;
  this eval module is imported only by its new offline tests.
- First scripted implementation: 14 tests passed on Node 22.16.0 through the
  owned runner, actual exit code 0. This predates the primary's corrections.
- Primary correction checkpoint: allow choice/unknown for merely proposed
  options without claimant adoption; add transient source/segment grouping to
  request candidates; remove machine-local absolute path from this public plan.
  Added proposed/unknown and multi-window, multi-source grouping fixtures.
- Worker verification after those corrections:
  `node tools/testing/run.mjs evaluation/architecture/test/source-proposition-builder.test.mjs`
  on Node **22.16.0** and **24.15.0**: **16/16 passed**, **actual exit 0** on
  each. Every model callback is scripted; no provider, network, key, ledger or
  database is used. The entire module/test import graph uses pure compiler
  helpers, without top-level SQLite imports. Node 20 execution is not measured
  locally (no available binary found); compatibility is not claimed as a run.
- Inventory cross-check: Git tracked diff plus untracked names versus an
  independent filesystem traversal compared with the fixed base tree agreed
  on **3 files**, exactly the owned paths above. No existing tracked file was
  changed. The filesystem route includes root/config, scripts, docs and public
  paths when present, and excludes Git metadata and known generated directories.
- Primary still owns the final combined checks, candidate commit and two
  independent fixed-diff reviews. No semantic effectiveness or spend/cost claim
  follows from these scripted results. Agent elapsed time and cost are unknown.
- Review round 1 correction on candidate `9c38fd5`: original JSON response
  strings now use their raw UTF-16 length for the compiler's 40,000-unit bound,
  preserving the exact string without charging another JSON wrapper. JSON
  object/parsed-value limits and the existing `callModel` serialized accounting
  are unchanged. Added exact 40,000 accept/40,001 reject and escape-heavy wire
  fixtures, plus a model-call regression retaining its stricter envelope bound.
  This corrects the declared boundary; it is not a semantic method change.
- Review round 1 verification: the focused owned-runner suite passed **17/17**
  on Node **22.16.0** and **24.15.0**, **actual exit 0** for both. The three-file
  correction inventory was cross-checked using Git names and independent
  filesystem/base-tree membership plus blob hashes against `9c38fd5`.
