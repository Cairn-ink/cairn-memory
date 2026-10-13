# Readable exact-source view — prospective offline probe

Fixed base: `fa5e6d1b4f8e56ad89c7fcc0c63426d3a867a070`; branch
`experiment/readable-source-view`. One retained actual GPT 6.1 Sol/high worker
owns module, test, this plan and append-only limitations. Primary owns architecture,
serialized test-lane grants, final verification, independent reviews and delivery.
No worker commit/push or paid/model access is authorized.

## Decision and observable acceptance

V1. Question: can the memory interface give a less deeply serialized exact-source
view without changing evidence or adding interpretations? Current QA24 delivered
all required B anchors for three wrong cases; this does not prove a formatting
cause. The old relation-instruction branch is closed with zero QA gain and is
not retuned. This packet changes presentation only, not retrieval or answer
instructions. Any later gain must be called evidence-presentation benefit,
not improved capture, recall or proven memory truth.

V2. Add ONLY an evaluation opt-in `packReadableCardPlanAnswer({evidence,countTokens})`
in `evaluation/architecture/readable-source-view.mjs`. First reuse the genuine
`packCardPlanAnswer` capability/whole-source validation; accept no fabricated or
cloned assembly object and no caller-supplied prompt/formatter port. Reuse
`packMixedAnswer` for the final request. Old modules and exports stay unchanged.
No new model, service, database, request, selector, reader rule or context budget.

V3. Render each existing whole card into one source-readable text unit: fixed
format/version header, original memory ID/revision, and one framed block per
source with original receipt ID, recorded role and EXACT source text. Use
unambiguous length framing for deterministic recovery (length units documented),
JSON-encoded metadata if needed. All source text remains untrusted quoted data.
No time parsing, NFKC, trimming, summarization, deduplication, reordering,
repetition, inferred subject/scope/status, gold/anchor data, or extra receipts.
IDs and role labels are provenance, not authenticated speech/authorization.
Do not emit model-proposed organization, group focus or trusted state labels.

V4. Independently recover every original card's format/id/revision and ordered
source id/role/text fields from the rendered representation and compare against
the genuine original flat bytes before accepting. Preserve all original source
characters, including quotes, newlines, CJK, emoji, delimiters, denials and
conditions. The conversion should fail on malformed framing rather than guess.
Keep decoder/internal helpers private unless there is a documented test seam;
no new public core API. Accept unchanged empty evidence as an exact flat fallback.

V5. Both original and new requests must fit existing 6000 local input cap with
real tokenizer at integration. Zero omitted/duplicate units; selected whole-card
order unchanged and at most6cards. Question/model/system/temperature/output512/n
identical; only evidence text differs. Verify actual complete serialized request
token counts, not source-only length. On overflow reject, never trim or increase
caps. Source bytes can be smaller or larger; no lightness/performance claim
without actual observations. No override of packer ownership/token checks.

V6. Add `evaluation/architecture/test/readable-source-view.test.mjs` using the
owned workspace helper and genuinely assembled sources from new synthetic
core stores/capture/recall. Reuse current fixture/helper capabilities; no old
RQ/CQ/BQ/D/R source or answer is loaded or replayed. Fresh exact-source controls
cover (a) same subject versus neighboring scope, (b) adopted replacement versus
explicit non-reconfirmation after a premise changes, and (c) reconciled versus
unresolved conflicting claims. These are preservation fixtures, NOT scripted
proof of model understanding. Include mixed speaker roles and multi-source cards.

V7. Negative controls exercise genuine capability rejection (clone/wrong shell),
malformed metadata/framing as reachable through chosen seam, counter failure,
exact boundary/overflow, empty evidence, complete-source ordering and malicious
delimiter-looking quoted content. Show a retained local mutant failing when a
qualifier/source is omitted or changed, then restore exact implementation bytes
and pass. This is a red-capable data-preservation loop, not a reproduction or
resolution of an old semantic failure. Do not call existing closed runners.

V8. Add `docs/plans/readable-source-view.md` recording V1–V10, design choice,
alternatives, exact preservation/fit checks, observed source/wire token counts,
worker ownership, actual exits, source hashes and limitations. State falsification
criteria for future NEW matched first-answer data: no baseline error opportunity,
no positive QA/error reduction, useful-answer loss/over-abstention/new unsupported
certainty, reliance on extra information/order or greater model effort. A zero
signal stops the probe; no tuning until favorable. Any model diagnostics require
their own frozen new cases, rubric and reviewed budget/accounting scope. Existing
P4 and Stage3/Hermes/resource gates remain unchanged. No future score is claimed.

V9. Append ONLY to `docs/limitations.md`, preserve entire fa5 base201575bytes
SHA6f6ddc0b90a33fd58c65c1a4c88c08c1ba4b30806037c4e20763b22b771ced9d.
Exactly FOUR allowed paths (module, test, plan, limitations). No package/CI,
dependency, core, protocol, old plan/fixtures/scorer/transport/default edits.
No extra tracker. Base may later integrate the results-documentation PR through
an explicit source-identity check; worker does not merge/rebase on its own.

V10. One actual GPT6.1 Sol/high implementation owner; root owns architecture,
verification and integration, followed by independent fixed-head Standards/Spec.
Read repo CONTRIBUTING/CONTEXT/relevant existing projection and packer before
work. Use apply_patch. Primary's generic test lane is currently occupied: worker
may author code/tests and do bounded static/syntax checks but MUST NOT launch
any test/native/model workload until root grants the lane. Before test execution
report proposed test cases and exact commands. Independent two-route file
inventory/count and actual exit codes required. No commit/push before root
acceptance; no claiming QA or product success from tests.

Research considered (design inspiration only): Context-faithful Prompting
https://aclanthology.org/2023.findings-emnlp.968/; ALCE
https://aclanthology.org/2023.emnlp-main.398/; Lost in the Middle
https://aclanthology.org/2024.tacl-1.9/. They motivate separate correctness/support
and controlled presentation/order, not this specific renderer's effectiveness.
The query-hit index alternative is deferred: it adds source repetition and a new
lexical relevance policy, making the first preservation experiment less isolated.

## Design and caller inspection (prospective)

Only new callers opt in to `packReadableCardPlanAnswer({evidence,countTokens})`.
It first calls unchanged `packCardPlanAnswer` to verify genuine already-assembled
capability and complete flat-source fit. Existing CP, canonical/RG, runner,
transport, answer instruction and defaults are untouched. Then only evidence
unit text changes before unchanged `packMixedAnswer` builds the complete request.
The result is frozen `{units,packed,projection,semanticSufficiency}`; projection
is `card-plan-readable-source-v1` and semantic sufficiency stays unassessed.

Fixed per-unit header: `card-plan-readable-source-v1\n`. One canonical JSON
metadata line holds original flat format/memoryId/revision and structural
sourceCount. Each following canonical JSON receipt/role/textLength line precedes
exact unescaped source text and a single framing LF. textLength is JavaScript
UTF-16 code units (emoji typically occupies two), not bytes, tokens or code
points. Length-based parsing never treats a delimiter-looking source line as
metadata. No normalization, date parsing, interpretation, emphasis, duplicate
source or reordered card/receipt is inserted.

The bounded `decodeReadableSourceUnit(text)` is a documented evaluation-only
data test seam; it returns only frozen original flat card DATA. It grants no
assembly capability, trusted semantics or execution authority. The packer
independently decodes every generated unit and requires JSON.stringify of the
recovered original fields to equal the genuine original flat unit bytes.

Alternatives: retaining nested flat JSON remains the unchanged baseline and the
empty-evidence fallback. A query-hit index is deferred because it adds repeated
source text and lexical selection policy. A changed reader instruction is not
this presentation factor; the older relation-binding trial remains closed and
is not retuned. No renderer effectiveness is inferred from anchor delivery.

## Prospective verification mapping

New tests use fresh literals only and genuine project-scoped helper/capture,
closed-and-reopened SQLite, bounded source scan and genuine CP assembly.
Independent raw role/date-wrapper/source ordering assertions precede packing.
Three preservation scenarios distinguish neighboring scope, adopted replacement
versus non-reconfirmation, and reconciled versus unresolved conflict. These are
data controls, not scored model answers.

The test-only independent framing parser checks recovered source fields/bytes;
the exported strict decoder adds malformed/header/metadata/length/trailing-byte
negatives. Packer controls reject forged/cloned capabilities, wrong shells,
accessors/proxies without hooks, invalid counters, exact6000/overflow and
whole-request omissions. Empty evidence keeps exact flat request. Complete
ordinary/readable request objects differ only in evidence text; model, question,
system, temperature, n and output512 remain fixed. Real tokenizer/source/wire
counts will be reported only after authorized integration, with no inference
about cost/latency/lightness.

A retained local omitted/changed qualifier mutant must fail the independent
preservation assertion before restoring exact implementation bytes and GREEN.
All fixture teardown uses createTestWorkspace and closes core handles; owned
child success/setup/assertion failure cleanup is independently checked.

## Historical authoring checkpoint

Contract and source APIs were read fully. Static caller inspection found no
existing caller of the new module; only the new evaluation test opts in.
At that checkpoint native/test lane was HOLD while primary ran results-document
gates. No tests or tokenizer/SQLite work had run, and source/wire measurements
were unknown. The following record supersedes only that prospective verification
status; it does not establish provider behavior or a QA result.

## Observed offline verification

Primary explicitly granted the one serialized lane after its docs gates closed.
Initial full focused Node 22.16.0 passed 10/10, actual exit/close 0; its supervisor
also exited 0. A local qualifier-loss mutant then removed only the literal
condition ` only while the seal is intact` inside rendering, retaining IDs,
roles, selection order and matching text-length framing. The unchanged genuine
capture/flat pack succeeded before the new exact recovery check rejected the
changed source with `card_plan_answer_incomplete`. The selected preservation
control exited/closed **1**, 0/1 passed, as expected; its expected-RED supervisor
exited 0. This tests data preservation, not any closed semantic failure.

The original module was restored byte-for-byte (read-only comparison exit 0).
Restored full focused Node 22.16.0 and final Node 24.15.0 each passed **10/10**,
actual test exit/close and supervisor exit **0**, no skipped/cancelled tests.
Owned process identities/cleanup were verified; every caller scratch directory
was empty and removed, no live survivor remained. Three deliberately owned
child modes asserted actual exit/signal **0/null, 1/null, 1/null** for success,
setup failure and assertion failure, each leaving an exact empty owned parent.
No unexpected failed correction round occurred. All original RED artifacts and
the exact original/mutant module copies remain retained privately.

Actual child argv was `node tools/testing/run.mjs evaluation/architecture/test/readable-source-view.test.mjs`
under pinned Node 22.16.0 then 24.15.0. The mutant added only
`--test-name-pattern=preserves neighboring-scope` before the file. Each owned
supervisor supplied sanitized PATH/LANG, newly owned TMPDIR/TMP/TEMP,
NODE_DISABLE_COMPILE_CACHE=1 and CAIRN_CARD_PLAN_TOKENIZER_REQUIRED=1; its 600000ms
test-work watchdog does not change any product deadline. Module/test syntax
checks each exited 0. Read-only dependency inspection reused root-provisioned
tiktoken@1.0.22; the worker installed, removed or changed no dependency.

### Token/byte observations, not resource or QA benefit

These are measurements on the final restored module and new synthetic actual
capture IDs. Evidence-unit token counts below include source metadata and the
concatenated entire unit texts, not just raw utterances. Request counts include
the complete exact serialized answer request with the unchanged system/question,
model/temperature/n/output512. UUIDs and receipt order can change between fresh
stores, so counts are not future-run estimates or a cross-runtime speed claim.

| Synthetic preservation case | Node 22 unit tokens flat → readable | Node 24 unit tokens flat → readable | Node 22 full request tokens | Node 24 full request tokens | Full request bytes, both Nodes |
| --- | ---: | ---: | ---: | ---: | ---: |
| Neighboring scope, 2 cards / 3 receipts | 316 → 341 | 330 → 355 | 549 → 573 | 563 → 587 | 1669 → 1763 |
| Replacement/non-reconfirmation, 2 / 4 | 397 → 425 | 397 → 425 | 649 → 675 | 649 → 675 | 1923 → 2023 |
| Reconciled/unresolved conflict, 2 / 3 | 326 → 351 | 322 → 347 | 559 → 583 | 555 → 579 | 1708 → 1802 |

All original/readable complete requests fit 6000 in these controls. The view
used **24/26/24 more request tokens and 94/100/94 more bytes**, respectively;
no lightness or token-saving benefit is claimed. The six-card/seven-receipt
control also passed exact preservation/order/whole-request fit, including two
same-text sources with distinct actual provenance. Boundary/overflow/counter
tests separately assert refusal without trimming or cap increase. Delimiter,
newline, quotes, CJK and emoji preservation is independently tested at the
bounded data seam; the renderer preserves already-captured canonical receipts,
not a claim that prior capture normalization retained every original character.

### Fixed source and verification receipts

| Source | SHA-256 |
| --- | --- |
| New wrapper/decoder | `00768249de26d89686cd7fe610ac59c7f7eb9cf1222ed5d684ad93d33fd38cf5` |
| New ten-test source/literal controls | `67da8cb78a89b10a2c1512cba564a77e1f8e2de80320beea9f570e4b8a91510a` |
| Retained qualifier-loss mutant | `6047474eaa40fab0e43937a0516f7f668c63938784dd7670762a046adf540a73` |
| Unchanged genuine CP evidence/packer | `4dff6162bdbee1052ef415244f0971c2a7bbb14d4d7bfd7693353c571cf9107a` |
| Unchanged mixed answer builder | `221d221adb9067eca09cdf73049b506d5d979ee8f44360cbf688b52577269f91` |

| Retained worker observation | Raw log SHA-256 | Proof SHA-256 |
| --- | --- | --- |
| Initial Node 22, 10/10, exit 0 | `bf857b7bad179e8630f062e22c1b80d151024994f3d4567ac8a6cf0289a3d01f` | `3d92145df737f908ce05b0c8d05e574bd38fb35acb4d4d3f396b4da573190bc7` |
| Qualifier mutant Node 22, 0/1, expected exit 1 | `793ca5f08da297fe849c7bef885142e60140a22b533e4806e741efdfbfb805e0` | `04e72dfc493db78cb8c1a55609c2a093338fd2e1bcfad39627f1e1b97fbeec85` |
| Restored Node 22, 10/10, exit 0 | `7da12efa83ac2e6f47bd56b8a00b78b80e7343b273f22de96b48a3999df3ac81` | `157d175cc7f15418ee649172f85e7300e85611b76f4b3e87cca811ae9bc42222` |
| Final Node 24, 10/10, exit 0 | `64c7125fdea3358fd8939d3f0c7425e4c99290dea45285543af8168f3b523d4d` | `07871987e6ed6b67e2097df38521a880de9c10f7a3941029557330dc437590f3` |

Module/test bytes are unchanged from the restored passing pair. This final
documentation records those observations; primary still owns final combined
four-path verification, fixed-head independent Standards/Spec reviews and any
delivery. There was no provider/key/operational-ledger access, closed-cohort
replay, answer generation or semantic judging. Current budget/quality/performance
remain unmeasured by this offline probe. Future matched-data falsification and
all unchanged P4/Stage3/Hermes/resource gates above remain required.

Final worker read-only scope/prefix audit exited 0: Git diff plus untracked-file
inventory and an independent recursive filesystem/base-blob comparison agree
on exactly four changed paths, 1,641 current files versus 1,638 base files.
The complete 201,575-byte fa5 limitations prefix retains SHA-256
`6f6ddc0b90a33fd58c65c1a4c88c08c1ba4b30806037c4e20763b22b771ced9d`.
Both tested module/test hashes match the restored GREEN bytes; original core,
packers, defaults, corpus, transport, dependencies and CI/package sources are
unchanged. `git diff --check` exited 0. This ends worker writes and releases the
test lane; primary gates/reviews/delivery are still separate acceptance steps.
