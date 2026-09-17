# Experimental source-context units in the shared core

## Scope and fixed base

Delivery branch `feat/source-context-units-main`, isolated sibling worktree
`source-context-units-delivery`, fixed main base
`3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`. Review the entire delivery diff
against this base. Only the two source-passage helper commits from PR167 are
included as prerequisites (delivery commits `2daf520` and `1393ad3`); no older
pending feature stack is included. The helper's SP1–SP6 acceptance lives in
`docs/plans/source-passage-partition.md`; its older verification is historical,
not a substitute for verification on this delivery base.

The worker developed CU on dependency base
`5ab9a3b8c414262fee62540fbd567930b2062201` in `source-context-units` and froze
commit `3823764`. Primary integrated only this scoped change onto main plus the
helper, resolving a changelog context conflict by retaining main's history and
adding only the CU entry. All primary verification and independent review must
run on the final standalone delivery candidate. No merge, release, deployment
or model call in this slice.

The private source-context prototype established mechanical source binding only.
It did not establish semantic reliability. Move the reusable pure compiler into
the existing public core, using its actual source partitioner and qualification
validator. Frozen old experiments remain immutable evidence, not active engines.
Do not import private experiment files, require artificial relation edges, or
duplicate the existing partition/qualification engine.

## Acceptance

CU1. Export pure `prepareSourceContextUnits(input)` and
`compileSourceContextUnits(input, proposed)` through core/index.mjs. Input is exactly
`{sources:[{receipts:[{role,excerpt}]}]}`: 1..6 sources, 1..4 receipts each, role
user|assistant, nonblank well-formed exact original excerpt <=800 UTF16 units.
Reject unknown fields, relation edges, malformed JSON trees, secret-bearing source
text under existing redaction rules, invalid indices and excessive inputs without
normalizing/trimming source text. Use actual partitionSourcePassages and
qualificationInput. All helpers are provider-independent, no filesystem/network,
model callbacks, store/database access or module-load operational side effects.

CU2. Preparation returns detached frozen source-only `input` with enumerated
source/receipt/passage IDs and exact passage text, plus strict responseSchema.
No system prompt or provider settings in this pure core slice. Bound both serialized
raw input and prepared input at6000 UTF16 units; this is explicit source-only input
budget, not an equivalence claim to old prompt-inclusive private limits.
Schema follows the accepted SC shape: 0..8 units; factual_claim versus decision_state;
eight value/evidence fields subject/property/scope/applies/value/attribution/polarity/
quantifier; decision-only state considered|adopted|rejected|not_approved|
not_withdrawn|pending_reconfirmation|unknown; eventTimeContext/reporterContext arrays.
No model focus, literal date/reporter quote or relationship fields.

CU3. Validate each unit/reference against its own original source/receipt. Derive
sorted unique focus from field/state/context references, requiring1..4 passages.
Never add intervening/missing references, select another unit's source or repair a
malformed proposal. Use existing qualificationInput for all qualification anchors
and values; retain SC's label normalization only for interpretation labels, never
source excerpts. Every known field requires its own evidence; existing qualification
evidence requirement remains even for unknown fields. Decision state maps only
considered/adopted/rejected to qualification commitment; other states remain
explicit on unit while commitment unknown. Keep polarity/quantifier own anchors.
Each context is exact original passage anchors plus model-proposed-unverified label,
not a parsed timestamp or reporter identity. Retain source/receipt/result-local
unit indices, exact offsets, optional state, duplicate protection and deep freezing.
Top-level result assessment-only/not-stored; each unit model-proposed-unverified.
Reject entire malformed batch. Bound serialized proposed and compiled result at
24000 UTF16 units, fail closed rather than truncate. Use existing MemoryStoreError
conventions: invalid_input for source input; invalid_model_output for proposal or
compiled-result bounds. Structural acceptance never implies truth or permission.

CU4. Existing capture/admission/qualification/storage, rationale, recall, SDK store
methods, MCP tools and adapter prompts remain unchanged. No new model-costing
operation or automatic enablement. This exports a pure opt-in building block only;
source identity/revision binding and cold-session use are subsequent slices.
Explain these boundaries and broad-context precision tradeoff in technical docs;
add a narrow unreleased CHANGELOG entry for the new opt-in library exports, with
no version bump or release;
do not advertise improved accuracy or a completed memory loop. Update the protocol
boundary without claiming new stored fields or expanding capture permissions.

CU5. Public tests are self-contained, no private paths/fixtures/ledger/provider.
Cover source-only strict schema and no artificial edges; original Unicode, whitespace,
punctuation and surrogate boundaries; unknown contexts; nonadjacent union without
widening; every field/state/context foreign/duplicate/out-of-bounds reference;
5-passage union from valid800-unit astral source; fact/decision distinction; every
state mapping; raw/prepared/proposal/compiled bounds; known-field evidence and
existing qualification/redaction checks; accessor/sparse/cycle/prototype/mutation
protection; typed duplicates and equivalent ordering; wrong semantic context can
remain structurally valid but unverified. Do not call that latter test a quality
success. Core fixtures prove exact stored-source association later, not here.

CU6. Include module in artifact allowlist, and a genuine offline installed-artifact
test exercising both named exports with synthetic sources and validating exact
anchor text. Do not substitute source-tree import for installed coverage. Run
generic npm test/validate, full core suite/demo:store and installed artifact checks
on Node22.16 and24, plus affected packaging gates per CONTRIBUTING. Typecheck is
not applicable to this JS repository. Freeze scoped candidate commit, separate
Standards/Spec reviewers and primary rerun before delivery. No credential, public
package publication or production access required.

## Ownership

Primary owns spec, integration, independent verification and delivery. One bounded
Sol/high worker implements source binding/strict validation and tests; separate
Sol/high Standards and Spec reviewers inspect the same fixed candidate. Worker may
edit core/source-context-units.mjs, core/index.mjs, core/test/source-context-units.test.mjs,
packaging/artifact-files.json, packaging/test/source-context-units.test.mjs,
docs/source-context-units.md, CHANGELOG.md and a narrowly scoped docs/protocol.md section.
This plan is primary-owned; do not modify other existing modules or frozen private
experiments. Ask primary before expanding files or changing an acceptance boundary.

## Verification and supervision record

Worker `source_rank_first_impl` used Sol/high for implementation, with primary
integration and direct inspection. The authored dependency-base candidate passed
generic143/core740/artifact76 on Node22.16.0 and24.15.0. Those counts include older
pending features and are not the standalone delivery gate counts.

Primary reran the following on the standalone main-based delivery tree, on both
Node22.16.0 and24.15.0, before freezing the CU delivery commit:

- `npm test`:106/106; `npm run validate`:pass.
- `npm run validate --prefix tools/plugin-validation`:marketplace and strict
  plugin validation pass. The pinned local native installer repaired a missing
  binary caused by installation with ignored scripts; no source fix or model
  retry was involved.
- `npm run test:core`:627/627; `npm run demo:store`:pass.
- `node --test core/test/source-passages.test.mjs core/test/qualification-candidates.test.mjs adapters/openai/test/qualification-candidates.test.mjs`:15/15.
- `npm run test:artifact`:68/68, including both actual installed helper/compiler
  imports; no source-tree substitution.
- `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs`:4/4, synthetic HTTP only.

Primary also checked1600 ASCII/astral excerpts against the previous partition
algorithm on each runtime and reran two independent private source-binding parity
checks against this delivery tree. Neither is semantic-quality evidence. All
scoped code/test hashes match the inspected worker output; only delivery-plan
and changelog integration differs. Original worktrees and private experiment
results remain intact. No paid request, merge, release or deployment occurred.

Independent Standards and Spec review and latest-head CI are subsequent delivery
gates recorded in the PR, not implied by the local results above. Review must use
the fixed main base at the top of this plan and the final committed candidate.

The first independent Spec review of `cb48971` found one low-severity CU5 coverage
gap: foreign-reference tests covered only subject across receipts, not all roles.
The same worker expanded the public test matrix across receipts and sources for
all eight fields, state, and both contexts, including positive own-source and
global-schema preconditions. Duplicate/out-of-bounds state refs and invalid/missing
IDs are also checked. No compiler or runtime code changed.

Primary inspected this correction and reran `npm test`106/106, JSON validation,
full core627/627, actual installed CU test1/1, and private parity2/2 on both pinned
runtimes. Full artifact68/68 and installed rationale4/4 above were run before
this test-only correction; runtime/artifact hashes are unchanged. Both independent
axes must review the corrected final commit, and latest-head CI remains required.
