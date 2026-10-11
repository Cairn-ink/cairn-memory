# Preserve recorded speakers in source-only answer evidence

Status: prospective implementation contract; no new answer score or live run.
Base: `d797e8c6345b55669de0a04ba82e7d3c2ee52648` (#383).
Branch: `feat/source-role-evidence`. This is a dependent evaluation-only change,
not a new public core default, memory schema or installed-host behavior.

## Observed defect and scope

The closed source-diverse development comparison answered 23/24 requested
questions correctly, with an unresolved safety judgment; it was not accepted
for promotion. Its remaining wrong case has an explicit assistant source role
in retained receipts and rank inputs, but the answer projection removes that
role. A one-source real-core probe changing only user versus assistant gives
identical final answer requests. The role-preservation assertion exits 1 on
Node 22.16.0 and 24.15.0 and removes its owned scratch. This proves a lossy
representation, not that preserving role will guarantee a correct answer.

The separate source-linked rank replay restores two missing chain anchors
after source-diverse selection (37 to 39/42), with no new answers or scores.
That existing rank intervention is not bundled into this representation fix.
The original unsupported-claim disagreement remains unknown and is never
adjudicated or rescored by this work.

## Acceptance P1–P10

- P1: Keep the existing `verifiedEvidence` output byte-equivalent for valid
  legacy inputs and retain its rejection behavior. No caller automatically
  switches, no old manifest/report/rubric/prompt or production default changes.
- P2: Add an explicit `verifiedRoleEvidence` evaluation entrypoint using the
  same authoritative core-get/source-map/origin verification, not a second
  provenance authority. Return the existing `{ units, provenance }` shape.
  Each per-memory `unit.text` is JSON with `format: "source-role-evidence-v1"`
  and an ordered `sources` array of `{ recordedRole, text }` objects. The text
  must be the exact validated receipt excerpt; role must be the validated
  recorded `user` or `assistant` role. No summary or inferred author name.
- P3: These fields describe submitted evidence, not authenticated human identity,
  claim subject, adoption or execution permission. Keep them quoted inside the
  existing answer evidence, never actual system/developer/assistant messages.
  Embedded quotes, newlines, role-like strings and instructions cannot create
  additional source records or alter the actual answer instruction/messages.
- P4: A real-core one-source differential regression must show the original
  projection loses speaker information and the new projection preserves it
  through `packMixedAnswer` and the actual serialized request. Only source role
  changes; source text, query, date, model and answer instruction remain fixed.
  Run the original projection as an explicit failing control (actual exit 1).
- P5: Cover mixed-speaker receipts on one card, same text by different speakers,
  quoted third parties versus recorded speaker, empty recall and multiple cards.
  Preserve memory/receipt ordering and origin provenance exactly. Verify roles
  and full excerpts in the final answer request, not only an intermediate object.
- P6: Forged/stale/corrected/forgotten/foreign/partial receipts still fail through
  the shared authoritative verifier. No silent fallback, backfill or role guess.
  Tests exercise denial checks for both projection entrypoints where applicable.
- P7: Use unchanged `packMixedAnswer`, its token counter and bounded whole-unit
  omission. Include a counted-boundary test proving added metadata is counted;
  different speakers with identical text must not be deduplicated as identical
  units. No new model/provider/database call, dependency or durable state.
- P8: No QA or safety improvement claim without a separately frozen comparison.
  Keep old 24-case results unchanged. Later comparisons must disclose the new
  representation equally where appropriate, isolate interventions and retain
  all failures/unknowns under the same cumulative ledger and protection.
- P9: Worker owns the shared verifier, one new focused test, this plan and a
  narrow limitations note. No runner, transport, scorer, gold corpus, public
  core, adapter, permission, schema, budget, release or deployment changes.
  Primary owns integration/actual-path replay; independent nonauthor Standards
  and Spec reviewers inspect the final fixed committed diff.
- P10: Run focused tests, longmemeval suite and ingestion/comparison/public demos,
  generic contributor tests, JSON and isolated plugin validation on supported
  Node versions. Record actual exits and zero-skipped test counts, independently
  cross-check changed-file inventories, double-review and monitor latest-head CI.
  Owned synthetic scratch is removed on success and failure; formal history is
  retained. No merge or publication of packages in this packet.

## Ownership

Primary DRI owns this contract and personally reruns the original red probe and
combined acceptance. Implementation is delegated to actual GPT-6.1 Sol/high;
reviewers must be independent of the implementer. All source-role observations
remain explicitly separate from semantic answer quality and source authenticity.

## Implementation evidence

Implementation worker: `role_projection61`, assigned GPT-6.1 Sol/high. Fixed
base remains `d797e8c6345b55669de0a04ba82e7d3c2ee52648`; worker checks below
cover the uncommitted candidate in `feat/source-role-evidence`. Primary owns
the final combined candidate, committed-diff reviews and delivery gates.

`mixed-evidence.mjs` now has one private authoritative verification loop shared
by both explicit projections. `verifiedEvidence` still joins validated excerpts
with the original newline separator. `verifiedRoleEvidence` returns one JSON
text unit per recalled memory with the P2 schema, preserving receipt order and
every exact validated excerpt. It only allows recorded `user`/`assistant` roles.
This role schema check does not change legacy acceptance on fabricated ports
with coherently unsupported roles. Origin provenance is identical between the
two projections. Neither entrypoint infers human identity or claim ownership.

Call-path audit: existing mixed and algorithm-development runners still import
only `verifiedEvidence`. The new opt-in entrypoint is exercised by the new
focused test; no runner, transport, scorer, rubric, fixture, model request
instruction, core policy or default has changed. Source-linked ranking stays
separate. All answer evidence travels through unchanged `packMixedAnswer`.

Before implementation, the focused P4 real-core differential failed with actual
exit 1 on Node 22.16.0 (1 failed, 0 skipped): changing only the recorded role
produced identical serialized answer requests. The explicit old-projection
control also exited 1 on Node 22.16.0 and 24.15.0 and reported
`packedRequestsIdentical: true`, `ownedScratchRemoved: true`:

```sh
node tools/testing/run.mjs --test-name-pattern='P4 actual core differential' evaluation/longmemeval/test/source-role-evidence.test.mjs
node tools/testing/run.mjs --script evaluation/longmemeval/test/source-role-evidence.test.mjs --legacy-red
```

After implementation, these commands passed on both Node 22.16.0 and 24.15.0,
launched with `env -i`, only a supported Node `PATH` and standard `HOME`; no
provider credentials, downloaded corpus or operational ledger was supplied:

| Command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node tools/testing/run.mjs evaluation/longmemeval/test/source-role-evidence.test.mjs` | exit 0; 17 passed, 0 skipped | exit 0; 17 passed, 0 skipped |
| `node tools/testing/run.mjs evaluation/longmemeval/test/*.test.mjs` | exit 0; 210 passed, 0 skipped | exit 0; 210 passed, 0 skipped |
| `node tools/testing/run.mjs --script evaluation/longmemeval/demo.mjs` | exit 0 | exit 0 |
| `node tools/testing/run.mjs --script evaluation/longmemeval/comparison-demo.mjs` | exit 0 | exit 0 |
| `node tools/testing/run.mjs --script evaluation/longmemeval/public-demo.mjs` | exit 0 | exit 0 |

Focused coverage includes cold actual-core recall through final serialized
requests, the unchanged legacy request SHA-256
`48c1e9feb8e8482fb977e06cac14d899bd311a44f4ae115d1c77c69de77bdf2f`,
mixed speakers on a card, identical text by distinct speakers, quoted third
parties, multiple windows of one message, empty recall and six ordered cards.
It exercises both entrypoints for malformed/forged/foreign/partial/stale
receipt denial, actual correction/forgetting, duplicate IDs, 100 receipts per
memory, 384 receipts total and 65 ambiguous coordinates. A tokenizer-backed
boundary proves JSON metadata is charged and omission remains whole-unit.
Owned synthetic workspaces are removed on success and assertion failure;
existing demo scratch was scoped inside the owned runner and removed after
completion. Historical artifacts were not opened or changed by the worker.

Primary separately replayed all 48 sealed arm outputs through actual core-get
copies and the real tokenizer on both supported Node versions (actual exit 0).
All 48 legacy requests were byte-equivalent; role/excerpt/provenance projection
was exact, with zero lost sources, extra public-get calls or packing omissions.
Total packed input tokens increased from 10,744 to 14,014, with at most 158
additional tokens per answer request. This offline request replay generated no
new answer and changed no score or unresolved safety judgment.

The worker independently cross-checked `git diff --name-only HEAD` plus
`git ls-files --others --exclude-standard` against porcelain status: 4 scoped
files, exactly the verifier, focused test, this plan and limitations note.
`git diff --check` exited 0. No worker commit or push was made.

Generic contributor tests, JSON and isolated plugin validation, primary
final acceptance, independent Standards/Spec review and latest-head CI are
primary-owned acceptance evidence and remain pending in this worker record.
No new answers, semantic scores or safety adjudication follow from these tests.

Primary subsequently reran the final combined code on Node 22.16.0 and 24.15.0:
focused tests 17 passed, algorithm-development 53 passed, longmemeval 210 passed,
and generic `npm test` 653 passed, all with zero skipped and actual exit 0.
Ingestion, comparison and public demos, JSON validation and isolated plugin
validation each exited 0 on both. The ingestion demo used owned `--script`
mode; comparison/public commands used their documented npm entries. The module
SHA-256 stayed `0f7ff7cd25b6529f26ed65ab647169c4250dc6cacf4c7afd545e969670e05984`
throughout those checks. Primary's explicit `--legacy-red` controls still exited
1 on both, with owned scratch removed. Four scoped files matched diff/untracked
and independent status inventories. This is a JavaScript repository with no
typecheck gate; fixed-candidate reviews and latest-head CI follow separately.

The prevention lesson is an end-to-end evidence contract: checking that words
survive is insufficient when attribution also matters. The regression now checks
recorded role through the final serialized answer request. No storage redesign
or inference of a source's real-world identity is needed to preserve that field.
