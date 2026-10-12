# Matched card-plan comparison projection — prospective offline contract

2026-10-12. Initial fixed base fcdc99dbce182bf9f63880dd86dc780e7d376ad7,
worktree /home/chichieh/Github/cairn-memory-worktrees/card-plan-projection,
branch experiment/card-plan-projection. Primary may serialize the independent
CQ dependency before final acceptance, recording the new full base explicitly.
CW independent reviews passed; exact-head CI is a separate pending gate.
This offline packet normalizes evidence presentation for a prospective A/B/C
comparison; it neither runs a cohort nor changes source selection or scoring.
Keep the closed v1 cohort and first judgments immutable.

Allowed five paths only:
- evaluation/architecture/card-plan-projection.mjs (new)
- evaluation/architecture/test/card-plan-projection.test.mjs (new)
- .github/workflows/ci.yml (existing required architecture command extension)
- docs/plans/card-plan-comparison-projection.md (exact final contract prefix)
- docs/limitations.md (append only, primary serializes dependency integration)

PX1 — Export compileOrdinaryCardSelection(request, result, countTokens). The
caller supplies its literal actual ordinary core-rank request and first returned
{refs}, never inferred candidates. Validate bounded descriptor-only JSON,
proxies/accessors/hooks without executing them. Reuse genuine CP preparation
and compiler, preserving every input candidate/ref identity and returned order.
Require each ref to match exactly one actual candidate; reject duplicates,
foreign/stale refs, unknown fields, excess selections and malformed values.
No sorting/deduplication/truncation, extra rank/select, model call or fallback.
Build only deterministic singleton chains for exact selected refs, each with
its existing first receipt endpoint. Entire cards still reach the unchanged
assembler, not just that endpoint. Empty refs produce empty selectedCards and
chains. Return a frozen record with origin ordinary-ref-assembly-v1, compiled
genuine capability, ordinaryRefsSha256 and syntheticAssemblyRequestSha256.
The latter is NOT the ordinary wire/request/output hash or a paid planner call.

PX2 — Preserve CP cancellation, output bounds and one-use actual-core assembly.
The preparer's new schema has its own conservative6000-token check, even though
it is never sent to the ordinary model: document that additional mechanical
assembly boundary. The future preflight must prove that all frozen candidate
requests fit it without changing the ordinary model's actual request or excluding
cases; failure is not permission to substitute a zero/fake counter.
The future coordinator owns one actual ordinary invocation; this pure compiler
does not claim to prevent arbitrary callers making another API call.

PX3 — Export packGroupedCardPlanAnswer({evidence,countTokens}). First require
the genuine already-assembled CP capability by using unchanged packCardPlanAnswer.
For nonempty evidence, add exactly one unverifiedOrganization property to the
first card JSON. Its closed structure is:
{version:'card-plan-organization-v1',status:'unverified',
 indexMeaning:{members:'selected-card-index',sourceMember:'chain-member-index',
 receipt:'receipt-index-within-card',terminal:'chain-source-index'},
 chains:evidence.proposal.chains}.
Do not expose original candidate indices or add source text, inferred relations,
facts, provenance or evaluated answer hints. The flat array is in selected-card
order, so the validated member indices keep their original interpretation.
For zero cards, leave the packed payload exactly unchanged.

PX4 — Strip only that one organization property and JSON.stringify must recover
each literal original flat unit byte-for-byte, with identical order, full receipt
texts/roles/IDs, card IDs/revisions and unique-card count. Return frozen {units,
packed,projection:'card-plan-grouped-source-v1',semanticSufficiency:'unassessed'}.
The sole serializer remains unchanged packMixedAnswer, with the exact original
question/date, instruction, answer model and512 output. Independently verify
<=6000 full serialized request tokens,0 omissions/duplicates, exact unit order
and payload. No synthetic truncation or altered cap. No new answer HTTP client.
Only declared organization differs from B; C reuses B's already selected source
capability and must never trigger rerank/reselection or claim semantic truth.

PX5 — Tests first, independent literal oracles. Actual cold SQLite scripted
source capture, actual bounded-source recall, ordinary first-ref callback compiled
with the helper and accepted authoritative assembly must run end-to-end.
Given identical literal ordinary/B selections, their flat answer request must be
identical. Verify the ordinary rank receives its ORIGINAL request bytes and runs
once,0 selects; synthetic assembly hash cannot be recorded as wire hash.
New-card B can use existing pure scripted compiler to create a genuine plan;
CW wire was verified separately. Test shared prerequisites, multiple receipts,
distinct equal-text cards, reordered selected indices, explicit role/date,
three-member chains and all six selected cards. Grouped-to-flat exact removal
must hold while terminal/member metadata remains unverified and separate.
Reject forged/cloned evidence, stale revision/namespace/query, hook/proxy drift,
duplicate refs, absent/ambiguous candidates, cancellation, repeated assembly,
overbudget counts and exact local whole-request boundary. Count mismatch must
fail, not silently trim. Source correction after recall must remain rejected.
Success and deliberate assertion failure leave no unexpected owned scratch.

PX6 — Existing required real-tokenizer gate remains mandatory; add only this
test path to its existing architecture command. No package/default/core/CP/CW
changes. Both Nodes22.16/24.15 focused old+new relevant integration, generic and
validate; primary actual reruns plus both Claude validators. Exact five-path
Git-vs-independent fullfilesystem/base-blob inventory. Scoped candidate, separate
fresh nonauthor Standards/Spec same full base/head, exact-head CI/mergeability.
No worker commit/push. No main merge/release/deploy.

PX7 — Explain that the new A identity-bearing whole-card projection differs
from the old closed baseline serialization, so no historical pooling. B-v-A is
the sole promotion test; C is matched-source grouping diagnostic only. These
mechanical controls prove source fidelity, not correct reasoning, reliability,
MOC scale, lightweight fit or Hermes readiness. New corpus, actual store/runner,
retained observations, first-judgment/scorer bindings, prepared-artifact review
and budget preflight are separate gates. No real-model/provider calls, keys or
operational ledgers, old result/corpus/holdout reads, mocks as QA scores, reruns,
scoring, retention expansion or changed400USD/protected30USD limits.

Checkpoints: behavioral red plus interfaces before implementation (wait for
primary); actual-core integrated oracles before broad (wait); final gates and
inventory then stop writing. Two unsuccessful fixes on the same issue escalate.

## Implementation and evidence record

Requested and actual bounded implementation owner: GPT-6.1 Sol, high.
Initial base: fcdc99dbce182bf9f63880dd86dc780e7d376ad7. Primary owns final
integration, acceptance, independent reviews, commit, push and delivery.

Only evaluator-only entrypoints are added: compileOrdinaryCardSelection and
packGroupedCardPlanAnswer. No existing consumer or core entrypoint changes.
The only CI change appends the new test path to the existing required offline
architecture command. Its existing four required flags and runtime matrix stay.
ordinaryRefsSha256 hashes the validated literal {refs} envelope in returned
order; syntheticAssemblyRequestSha256 hashes the genuine prepared schema-bearing
assembly request, never the actual ordinary wire/request/output. Future explicit
coordinator work owns once-only actual ordinary calls and wire observations.

Checkpoint 1: actual Node 22.16.0 interface success and two behavior failures,
actual exit 1, after genuine B assembly. Primary inspected the actual files and
preserved red log before approving implementation. The initial fixture-ID
invalid_question failure also had actual exit 1; its standalone log was overwritten
and is unavailable. A labelled transcript-derived failure record documents that
retention gap, not a recovered raw log or passing run.

Checkpoint 2: actual cold SQLite source capture, close/reopen, bounded recall,
literal ordinary first refs, genuine CP compilation/assembly, and matched flat
and grouped answer requests. First run: actual exit 1, 8 passed/2 failed, retained.
One correction resolves JSON null-prototype comparisons and the toy multi-receipt
candidate-order assumption using actual candidate receipt cardinality. Corrected
run: actual exit 0, 10 passed, no skips, retained. Primary inspected both logs,
source and tests before approving final gates. No closed source fixtures or scores
are used. After the toy fixtures, implementation and approved checkpoint 2 were
already complete, a limitations append-context read accidentally crossed into
preceding closed-result prose. It was reported; those details were not used.
Source and tests retain the approved checkpoint-2 bytes for independent review.

The new fixtures independently check literal canonical dates, roles, receipt
bytes, IDs, revisions and selected order. Equal-text distinct cards, all six
cards, shared prerequisites, three-member chains, multiple receipts, explicit
empty selection and the first-card organization object are exercised. Negative
controls cover malformed/foreign/stale/duplicate/ambiguous refs, unknown fields,
accessors/proxies/hooks, forged/cloned evidence, source correction after recall,
query/namespace drift, repeated assembly, cancellation, exact local token bounds,
omissions, count mismatch and owned assertion-failure cleanup. The cancellation
fixture has a separately named owned signal seam around a literal actual request;
core.recall has no external-signal argument. Ordinary actual-request identity
checks use the original core request and first result without that seam.

Final required commands, on both Node 22.16.0 and 24.15.0:

- Existing required architecture command with all four flags plus the new test.
- npm test and npm run validate (JavaScript repository; no TypeScript gate).

Run at most two runtime sequences concurrently, with no source writes during
these final gates. Preserve exact commands, raw logs and actual exit codes in
the existing primary evidence directory. After both sequences, compare the Git
changed/untracked file list to an independent filesystem/base-blob inventory;
expected scope is exactly five paths. Stop writes/processes for primary freeze.
Any subsequent dependency integration invalidates this candidate evidence and
requires primary final-base verification and independent review again.

### Author completion, retained failures and primary handoff

The author stopped all writes and owned processes before the primary CQ
matrix began on 2026-10-12 at 06:53 UTC. On each of Node 22.16.0 and 24.15.0,
the required eight-file architecture command passed 115/115 tests, `npm test`
passed 784/784, and `npm run validate` passed. All six actual command exits
were 0; test failures, cancellations, skips and unexpected owned scratch were
0. The original red and first checkpoint-2 failure records remain retained;
the unavailable initial fixture log is not represented as complete evidence.

Primary independently read the implementation and every new test, inspected
the red and correction logs before approving subsequent work, and parsed the
retained final raw logs. Git changes and an independent full filesystem/base
blob inventory matched exactly five paths and 1,595 source files at the
initial base. The primary link audit checked 119 relative links. Source and
test hashes at handoff were respectively
`b723805993bd57b82cb6b946b0ea148e63ab65fdaf077994799c11b0425685a6`
and `cd11fdef75ec65f30be0f63b267701215c6c4a5e33ec230f8873f4679d201670`.
These hashes were measured after the accidental closed-result prose read;
they are not claimed to be a cryptographic pre-read snapshot. Primary's
earlier direct code inspection and the retained checkpoint-2 evidence remain
distinct from that later hash record.

Raw logs are retained in the primary evidence directory under
`projection-final-22.16.0-{focused,generic,validate}.log` and
`projection-final-24.15.0-{focused,generic,validate}.log`. These author results
do not replace primary verification on the final integrated dependency base,
fixed-diff independent review or exact-head CI. No paid calls, score, commit,
push, main merge, release or deployment was made by the author.

### Primary dependency integration before final acceptance

On 2026-10-12 the primary saved only the five scoped projection paths in the
retained named stash `232623ccfdd729b00b83daea50b022149404f179`, then
fast-forwarded only this task branch to the CQ candidate
`9a1434f0984093f3a44ac37a3fcfd979c653c677`. That is the final integration
base for this projection diff. Main was neither updated nor merged.

Applying the stash returned actual exit 1 for the single append-only
`docs/limitations.md` conflict. Following the shared conflict workflow, the
primary retained the entire new corpus section and the entire projection
append, adding a projection heading for separation. No algorithm, test,
source-case or rubric bytes changed during integration. The original
prospective contract remains the exact document prefix; the named stash is
retained, not dropped. Final-base primary verification and both independent
review axes are required before push and exact-head CI delivery.

## Prospective review disposition: disclosed PX7 author-exposure exception

Primary DRI decision on 2026-10-12, before any evaluated-model call on CQ24.
The original PX1–PX7 contract remains verbatim above. Independent Spec review
of candidate `3a689ff3120c06b0f14c0bce5e3aecab6fac920c` correctly found one
P2 procedural deviation: the projection author read old closed-result prose
after the primary-approved implementation/checkpoint2. The original no-read
requirement was not met. This exception neither erases that finding nor claims
retroactive compliance, a pre-read cryptographic snapshot, or proof that all
unobserved influence is absent.

This bounded projection is accepted for continued prospective evaluation as
a **nonblind engineering control**, not as blindly authored algorithm evidence.
It deterministically projects already selected whole-card sources; it neither
selects answers using gold nor supplies the new dataset, model prompt or scoring
rules. Independent review found no implementation defect or result-dependent
test correction. Rewriting the same mechanical projection would not undo the
historical read. The relevant controls are explicit disclosure, source-fidelity
tests and separate prospective evaluation, not claiming the read did not occur.

This decision is limited to that already recorded incident:

- The independently authored CQ24 source and rubric remain byte-identical to
  `9a1434f0984093f3a44ac37a3fcfd979c653c677`; no question, anchor, minimal set,
  expected claim, severe condition or sample is altered.
- Projection source, tests and CI remain byte-identical to the original reviewed
  candidate. Only this plan and limitations gain the decision record. Both
  independent axes must review the new exact candidate and this exception.
- All PX1–PX6 functionality, real token bounds, source/capability checks and
  failure behavior remain unchanged. No evidence or safety gate is waived.
- B-v-A remains the sole prospective promotion comparison with identical flat
  source context; C remains diagnostic only. Pinned model, budgets, denominators,
  orders, first-response rules and future frozen judging/scoring stay unchanged.
- New evaluated-model calls and independent first judges remain separate later
  gates. No new results were used to make this decision, and it grants no paid
  call, old-cohort repair/rerun/rejudge/rescore or product-quality claim.

Reports and the PR must say that the original Spec review had one disclosed,
primary-accepted procedural exception. A later pass against this amended
prospective scope must not be reported as zero historical deviations or original
PX7 compliance. Author exposure is a limitation of this engineering process;
the separate CQ author and future judges must not be represented as exposed by
it without evidence, or as independent merely because a helper test passes.
