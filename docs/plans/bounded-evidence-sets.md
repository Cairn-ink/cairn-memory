# Bounded evidence-set assembly: second development candidate

Status: implementation contract fixed before delegation; offline only.
Owner: primary DRI. Base: `db447d2fba82ec5075bdf1c12fb268924c12ae1b`,
the closed first-comparison result in #380, depending on #379 and #378.
Fetched public main is `253f5ddb10f6fa8e9b182521313077e42946d5e9`;
this isolated dependent branch does not merge or change those results.

## Goal and limits

The near-term goal is better requested-answer correctness while remaining a
lightweight, source-backed memory layer. The first full-label intervention was
rejected under its original frozen rule; see [the unchanged report](algorithm-dev24-results.md).
That run also exposed an overly demanding answer rubric. Its original scores
are not ordinary QA accuracy and will not be rescored. Future paid comparisons
need a separately frozen requested-answer/context-completeness distinction and
a new paired baseline, with the ordinary concise answer prompt unchanged.

The concrete algorithm hypothesis here is narrower: a ranker can select a
relevant card while dropping another selected card that supplies an exact
cross-card reference. D11's recorded replay demonstrated this loss at rank output.
An ephemeral, bounded evidence set might retain both. Literal shared identifiers
are navigation cues, not proof of identity, truth, adoption or a semantic relation.
This candidate cannot recover uncaptured, unselected or pre-rank omitted sources.

## Observable acceptance (E1–E9)

- E1: Add an evaluation-only rank-model wrapper and pure evidence-set assembler
  under `evaluation/architecture/`. No product default, core schema, persistent
  graph, new database service, archive, provider protocol or source-retention change.
  Preserve all other model ports. Delegate rank exactly once with the detached,
  immutable original request, even for a small or empty candidate pool.
- E2: Only supplied candidate receipts may produce links. Define and document a
  bounded case-sensitive identifier grammar (letters plus digits, not bare
  numbers, dates or common words). Match exact text, without normalization or
  evaluator IDs. Retain receipt identity, candidate namespace/memory/revision
  and exact UTF-16 source offsets for every suggested link. Summary text cannot
  create a link. Same namespace is mandatory. Repeated occurrences in one card
  do not create extra neighbors; an identifier on more than two distinct cards
  in one namespace is ambiguous and creates no edges.
- E3: Compile unambiguous connected components of at most three cards (at most
  two hops), from at most 36 candidates. Bigger components are not partially
  traversed or silently trimmed into valid sets. Visit validated ranked seeds
  in their original order; put a fitting seed's whole component immediately
  after that seed, ordered deterministically by candidate order. Subsequent
  ranked seeds already present are skipped. The existing limit (1–12; experiment
  normally 6) never increases. If a set cannot fit, retain only the original seed
  when a slot remains and explicitly report that expansion as skipped. Record
  any original later seed displaced by an admitted set. Empty rank stays empty.
- E4: Treat invalid, duplicate, foreign or stale-revision rank refs as errors,
  not cues to repair a model output. Reject malformed/accessor-bearing input,
  preserve original errors/cancellation, and bound counted input/output as in
  the existing rank wrapper (6,000 / 1,024 tokens). No extra model call, fetch,
  caller budget enlargement or source fabrication. The real core still owns
  allowed-reference validation and final freshness reads.
- E5: A controlled integration uses the real core and source-only answer packer.
  More than six candidates must reach ranking: three linked cards plus at least
  seven unrelated distractors, with a scripted ranker omitting bridge/support
  cards. Baseline must lose a required packed source; the intervention must
  restore the complete fixed chain. Assert identical rank requests/calls,
  exact packed-source provenance, actual candidate count and fixed limit. A
  switchable baseline-only control must fail the restoration assertion.
- E6: Cover a full six-ref rank output from at least 12 candidates, explicit
  displacement, input permutations, repeated/ambiguous identifiers, cross-
  namespace collisions, summary-only links, numeric/date/common-word negatives,
  oversized components, insufficient set capacity, and absent rank seeds.
  Do not describe literal graph completeness as an improved semantic answer.
- E7: Real-core mutation controls must still reject stale evidence if an added
  or seeded memory is corrected/forgotten during ranking. Tests close resources
  and clean their owned scratch on both success and expected assertion failure.
  No historical scratch sweep, operational ledger, provider key or paid request.
- E8: Primary inspects the real diff and runs targeted architecture tests, generic
  tests, validation and isolated plugin validation on Node 22.16 and 24.15;
  there is no TypeScript gate in this repository. Record actual exits and two
  independent changed-file inventories. Independent nonauthor Standards and
  Spec reviews inspect the same final committed diff before PR delivery.
- E9: Preserve all original corpus/rubric/judgment/report bytes. This packet
  enables no paid rerun, promotion, merge, release or deployment. At most two
  unsuccessful implementation correction rounds before primary re-scopes.
  Later answer-quality evaluation remains required before this can be a default.

## Ownership and next gate

Primary owns this contract, integration and observed verification. One bounded
GPT-6.1 Sol/high worker owns the new algorithm module, tests and its technical
description. Two separate nonauthor reviewers own Standards and Spec. Execution
evidence is appended here and in the PR rather than a new tracker.

After the offline hypothesis passes, the next packet freezes a prospective
QA-versus-context rubric with concise-versus-explained invariance controls,
then independently reviews a new paired baseline/treatment experiment. The old
24 cases, if reused, are previously seen development, never a fresh holdout.
Current protected-budget status is recorded in #380; it is not authorization to
resume the closed run. No new paid run is performed by this implementation packet.

## Implementation packet

Worker: assigned GPT-6.1 Sol/high; fixed base remains
`db447d2fba82ec5075bdf1c12fb268924c12ae1b`. No worker commit, push or provider
call. Only the new module/test, this implementation section and the required
limitations paragraph are in scope; E1–E9 above are unchanged.

`createSourceLinkedEvidenceModel(model)` preserves the other model ports and
the captured/bound token counter. It always calls the captured rank method
once with the detached, deeply frozen original request and the same abort
signal, including empty and small candidate pools. It validates the original
rank output before assembly, separately counts raw and compiled outputs, and
returns only `{ refs }`. Core validation/final freshness remain authoritative.

The pure exported evaluator-free API is
`assembleSourceLinkedEvidence(input, rankOutput)`, where `input` is the original
`{ query, limit, candidates }` rank input and `rankOutput` is the original
`{ refs }`. Its immutable result is `{ output: { refs }, diagnostics }`.
Diagnostics include exact source-bound `links`, connected `components`,
`ambiguousIdentifiers`, `skippedExpansions` and `displacedSeeds`; semantic
coverage remains `unassessed`. No DB read, token callback or model is used by
the pure helper. It cannot recover candidates absent from its supplied input.

Identifier grammar: a whole token of 1–8 ASCII letters followed by an optional
single ASCII hyphen and 1–8 ASCII digits. Matching is case-sensitive and exact;
Unicode letter/mark/number, underscore or hyphen neighbors prevent substring
matches. Calendar month/day prefixes and time/timezone fragments are excluded
by a case-insensitive calendar classification only; source text and link
identity are never normalized or case-folded. `L8`, `E17`, `BR-6` and `PO-63`
are recognized; `PO 63`, aliases, bare numbers, dates and common words are not.
Hyphenated matches resolve contiguous existing source-part boundaries. Each
link retains candidate namespace/memory/revision, receipt ID and exact UTF-16
offsets. The first occurrence per identifier/card is retained; repeated
receipts/occurrences cannot create extra neighbors. More than two cards sharing
an identifier in one namespace create no edge. A same-namespace reused code
can still connect unrelated records: the graph is a navigation suggestion,
not proven identity or semantic sufficiency.

Assembly visits ranked seeds in their original order. An eligible component
has at most three cards; its seed comes first and remaining members follow the
actual candidate order. Oversized components are never trimmed. A component
that cannot fit is explicitly skipped while retaining its seed if capacity
remains. Admitted sets can displace later seeds; those refs are recorded.
The original limit stays fixed and empty rank output stays empty. No source,
interpretation, prompt, adapter protocol or host answer behavior changes.

The new focused suite uses real cold SQLite copies, normal source rendering,
`verifiedEvidence` and `packMixedAnswer`, with the ordinary concise answer
instruction unchanged. Ten candidates (three chain cards plus seven unrelated
cards) reach rank in both arms, with one identical scripted original rank
request/call per arm. The baseline packs one required chain source; assembly
packs all three with exact receipt/origin coordinates. A twelve-candidate,
six-seed control restores the chain while displacing two later seeds. Other
controls cover identity/grammar/caps, candidate permutations, capacity,
ambiguity and privacy boundaries; seeded/added correction and forgetting during
rank must fail freshness. All scratch is freshly owned and cleaned in `finally`,
including deliberately failing restoration assertions. The integration tests
are dynamically imported on Node >=22.16; pure tests remain runnable on Node20.
The controlled mechanical integration uses a labeled deterministic local
counter, not a provider tokenizer or cost estimate; source preparation calls
the dependency-free `prepareMixedSourceCase` directly with synthetic hashed
IDs/dates. Primary identified that importing the development runner/tokenizer
would silently require isolated adapter dependencies absent from generic CI.
Those imports were removed, not hidden behind supported-runtime skips or a
broader CI install. Primary's separate recorded-input replay uses the actual
pinned tokenizer for real local-token diagnostics.

Primary can expose the red control with
`CAIRN_EVIDENCE_SET_BASELINE_ONLY=1 node tools/testing/run.mjs
--test-name-pattern='E5 real-core' evaluation/architecture/test/source-linked-evidence-model.test.mjs`.
This runs the baseline against the same three-packed-source restoration
assertion and must exit 1; it is not a semantic answer assertion.

Primary's initial read-only source-bound replay across all 48 old arm slots
found only two changed slots: D11 full restored packed anchors from 1/2 to 2/2
(188 to 248 answer-input tokens), while D10 ordinary added a redundant card
without restoring the missing anchor (still 2/3; 270 to 321 tokens). The other
46 slots were unchanged. Ordinary D11 remained 1/2: its mural/order bridge
never reached rank, so this rank-only policy cannot repair it. Original report
and all 24 closed DB hashes stayed unchanged. These are context diagnostics,
not new QA scores or permission to rerun the 24 cases. The narrow policy is
held from a paid rerun pending candidate-selection/source-diversity work;
final fixed-candidate replay and independent review remain primary gates.

Initial worker Node22 focused verification exited 1 because two integration
expectations incorrectly assumed admission order. Actual bounded-keyset rank
candidate order differs; the algorithm already restored all three sources.
The tests now independently derive the expected component member order from
the observed rank input, as E3 requires. The corrected focused run exited 0
with 14 passed, zero skipped. Both-runtime/red verification follows below.

Worker verification on Node 22.16.0 and 24.15.0: the focused new suite exited 0
with all 14 tests passed and zero skipped on each runtime. The explicit
baseline-only E5 control exited 1 on each, with the actual packed-source
restoration assertion `1 !== 3`. The suite was also run from a fresh owned
`git archive HEAD` source copy with only the four scoped working files overlaid;
both root and isolated adapter `node_modules` were asserted absent. In each
source-only copy the normal suite exited 0 (14 passed, zero skipped) and the
baseline-only child exited 1 with that same expected assertion. The proof
driver itself exited 0 and its owned archive was removed on each runtime.
No supported integration was skipped to conceal a missing dependency.
The complete architecture glob also exited 0 on both runtimes, with 98 passed
and zero skipped on each. Shared snapshot validation failures are translated
to typed core `MemoryStoreError` codes, so the core model-call seam does not
launder malformed output into an ordinary provider failure. Worker code/tests
are handed off unchanged for primary's final replay and independent reviews;
broader generic, validation and isolated-plugin gates remain primary-owned.

## Primary verification and next algorithm decision

The primary inspected the complete module/test and personally ran these gates
on Node 22.16.0 and 24.15.0, using an empty application environment and owned
test scratch. Every ordinary command below returned actual exit **0** on both:

- `npm test`: 637 passed, zero skipped on each runtime.
- `node tools/testing/run.mjs evaluation/architecture/test/*.test.mjs`:
  98 passed, zero skipped, rerun after the final code handoff.
- `node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs`:
  14 passed, zero skipped, also rerun after the final code handoff.
- `npm run validate` and `npm run validate --prefix tools/plugin-validation`.

The primary's first plugin-validation attempt exited **1** because its own
`--ignore-scripts` dependency install omitted the native validation executable.
After confirming this worktree's install was not a shared symlink, the normal
locked install exited 0 and both validations exited 0. No product code or gate
was weakened. The focused generic test's original optional-tokenizer dependency
was removed before delivery; source-only archive verification is recorded above.

The primary also ran the baseline-only E5 command on both runtimes: actual
exit **1**, the intended one-versus-three packed-source assertion. A separate
offline replay used the actual local tokenizer, the unchanged 24 closed capture
snapshots and all 48 original arm observations. Original requests, recorded
rank responses, source provenance and baseline packing matched exactly. With
the final module, both full replays exited **0**, reconfirming the D11 gain,
D10 redundant exposure and 46 unchanged slots above. The replay's independent
D11 baseline-only restoration check exited **1** on both. All replay scratch
was removed on success and failure; original database/report hashes and absence
of sidecars were rechecked. There were no new answers or provider calls.

Final worker module SHA-256:
`d17115c99d11e476a8125f613af97e47d245cf21e9f002f8eb680f5f14e7a625`.
Test SHA-256:
`eb4a151386dd918157ec4c747ec9c2c87b9834459a317d4b5a50535dba557952`.
The primary's separately retained replay-helper SHA-256 is
`913370a35e4a2e1a758498664e403a2bff12a57ccb3c648432550f592d9a5a8d`.
`git diff --check` exited 0. Diff-plus-untracked and porcelain-status inventories
independently matched exactly four scoped files. Final independent reviews and
latest-head CI are recorded in the PR; these local results do not replace them.

Decision: keep the bounded assembler available for development, with no default
or paid QA promotion. Its literal-only reach is too narrow to justify a general
24-case rerun on this evidence. This closes the second candidate's offline
mechanism review, not Stage 2's answer-quality gate. Neither candidate has
established the required net three-answer gain. The next bounded revision
must address the earlier selection boundary before another paid comparison.

A separate GPT-6.1 Sol/high read-only architecture audit, checked against the
code by primary, identified the smallest useful seam: source-distinct expansion
within the original selection-visible candidate page, using public `get` and
the existing model-selection wrapper pattern. Native recall still validates
every returned ref against that original page. The next implementation packet
will freeze a cap on inspected seeds/candidates, receipts/bytes, rereads and
added refs before work, then require:

1. A red control in which selected cards repeat the same billing source while
   an exposed complementary bridge is omitted; the bridge must be recovered
   from observed source text, without evaluator IDs or an all-store scan.
2. Duplicate-fragment identity based on namespace, submitted source coordinates
   (`client`, `sessionId`, `eventId`, `role`) and exact excerpt, not per-memory
   receipt UUID. Different excerpts from the same turn and equal text from
   different origins must remain distinct; provenance still does not prove truth.
3. Negative/cap controls for unrelated or contradictory evidence sharing a key,
   foreign/historical/forgotten/awaiting/stale sources, and bridges beyond the
   inspected pool. No silent fallback, cap enlargement or claim of completeness.
4. Separate observation of selection reachability and post-rank preservation;
   do not bundle both changes and attribute a gain to only one. Preserve the
   unchanged answer prompt, count actual packed provenance and all added cost.
5. A prospective requested-answer/context rubric with concise-versus-explained
   invariance, independently reviewed before a new paired model experiment.
   Old judgments remain immutable and reused material remains seen development.

This does not implement an inverted source-key index. Current query candidate
generation is a bounded flat literal-overlap scan, not a topic-guided MOC walk.
For genuinely unseen sources, existing `get(...).placements` plus
`map(parentRef)` can inspect indexed MOC neighbors, but adding those refs to
native recall requires a separately designed candidate-expansion seam. Public
`get` may paginate receipts; source-evidence `fetch` returns one whole card's
source projection per page or rejects it as too large. Multiple public reads
are not one atomic multi-card snapshot. The authoritative final read and
freshness checks cannot be bypassed to make a navigation experiment pass.
