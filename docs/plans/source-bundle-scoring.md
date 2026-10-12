# Source-bundle first-answer scoring — prospective primary contract

2026-10-11. Planning only until the primary appends the accepted BR SHA and
dispatches a bounded author. This is not a score, live grant, judge invocation,
or permission to inspect/rejudge any closed cohort. Preserve this contract
verbatim in the tracked plan before implementation. It operationalizes CF6's
existing +3 supported-correct gate, without changing that threshold or D12.

## Scope and dependency gate

Exactly five author paths in a new isolated dependent worktree at the accepted
BR commit, targeting its branch after independent delivery:

- evaluation/algorithm-development/source-bundle-scoring.mjs
- evaluation/algorithm-development/source-bundle-judging.mjs
- evaluation/algorithm-development/test/source-bundle-scoring.test.mjs
- docs/plans/source-bundle-scoring.md
- docs/limitations.md (append only)

One actual GPT-6.1 Sol/high author. Primary owns planning, integration and direct
acceptance; separate nonauthor Standards/Spec reviewers inspect the final fixed
full diff. No inherited corpus, rubric, BR/QT/QB, core, transport, ledger,
model/prompt, default, dependency, CI or closed-result edits. No external
requests, environment/credential discovery, operational-ledger access, SQL,
automatic judging, rerun/resume/recovery, publication, merge or deployment.

Use only explicit bounded JSON inputs and pure deterministic processing. The
judging/scoring modules themselves do not open stores or read/write files. A
separate caller later owns exclusive retention of first raw judgments and
manifest/hash binding. No import/execution of an old cohort-specific scorer.
Generic pure validators/verifiers may be reused without modifying them; replay
of recorded reads for provenance validation is not a new retrieval or model run.

## SJ1 — Retained-run integrity and actual evidence

Accept the complete retained BR preparation observation and result, the exact
frozen CF rubric, and a predeclared 32-byte seed. Validate versions, roster/order,
24 cases per arm, 18 answerable/6 qualified cases, question identities, both
manifests/hashes, per-case source/plan/mapping/state/rank hashes and all 67 source
anchor coordinates against the original UTF-16 source bytes. Unknown versions,
missing cases, duplicate identities, changed source/rubric, mismatched manifests
or inconsistent records deny assessment rather than silently omitting cases.
An honestly stopped BR run remains reportable, but cannot be promising.

For every answer actually attempted, cross-check the exact recorded answer
request in the durable physical intent against artifacts.packed.request and
answerResult.packed.request when present. Bind the first returned answer to its
actual response/outcome, canonical question, method, case and arm. No-answer,
failed and not-run slots must retain their truthful execution categories; a
failed answer call can have a request without an answer. A completed-answer
claim without its wire/response/evidence cannot receive a semantic assessment.

Validate authoritativeReads in exact order against their requested memory IDs,
namespace, revisions, receipt identities/roles/excerpts and prepared capture
mapping. The existing pure verifiedRoleEvidence may consume these recorded
reads through a strict one-use replay port; no unrecorded read is permitted.
Do not infer authority from memory content, a label, bundle proposal or summary.

Decode only the two accepted actual answer evidence wrappers:
source-role-evidence-v1 and query-local-source-bundle-evidence-v1. Cross-check all
packed units, order and complete original passage bytes against verified
receipts; reject extra, missing, reordered, duplicated or partial passages and
unknown wrapper fields/versions instead of dropping them. Bundle declaration/
terminal/group metadata is unverified organization, not additional source truth.
For judgment normalize only the wrapper into the same ordered sequence of
{recordedRole,text} passages for both arms. Preserve complete text, roles and
within-answer passage order. Keep the original raw wire and normalization hash
outside the blind payload. Never add a bridge from full sources or a probe to
the evidence the answering model actually received.

## SJ2 — Mechanical stage observations, not semantic verdicts

Independently locate each frozen anchor through original coordinates and
capture/receipt mapping. Report capture availability, actual QA rank visibility,
selected recall receipts and actual packed evidence separately. Match complete
original anchor spans/bytes, never summary-label substrings. A not-reached stage
is not the same observation as a reached stage lacking an anchor. Report all
anchors and whether at least one minimal requiredEvidenceSet is complete at
each observed stage. Optional context anchors never become mandatory support.

Natural-selection probes have their own map/select/post-fetch rank observations
and denominators. Report them separately; they must never affect QA evidence,
completion, supported-correct counts, paired wins or the improvement gate.
The CF6 retention condition concerns complete required sets in actual QA packed
evidence, not the number of optional anchors or a planner's declared intention.

## SJ3 — Blind independent first judgments

Create two independent judge packets with deterministic opaque labels and item
ordering derived from the frozen seed, using distinct judge salts. Use a stable
cryptographic hash ordering rather than ambient randomness. The private mapping
is not judge-visible. Include exactly one item per actual first returned answer;
report excluded no-answer slots explicitly in the private assessment. A judge
packet includes the question/date, original full sources and frozen rubric for
correctness, the separately labeled actual packed passages for support, and the
literal first answer. Preserve source roles as attribution, not authentication.

Do not include arm/version names, paired answer, bundle proposal, terminal/group
metadata, trial aggregates, other judge outputs or private mapping. Source
content can still reveal clues; claim only this implemented blinding, not
perfect concealment. Full-source correctness never implies that those full
sources were supplied to the answering model.

Define and freeze one bounded JSON first-judgment schema before live answers:
opaque item ID, correctness/support yes/no/unknown, unsupported and stale claim
counts (bounded nonnegative integers or null for unknown), a decision for each
predefined severe condition, and short rationale/evidence references. Preserve
both whole raw first outputs and their digests outside parsed assessments.
Missing, malformed, duplicate or unexpected item outputs, invalid references,
internal contradictions (e.g. supported=yes with unsupportedClaims>0), and
unknown values cannot silently become a valid zero or false. Field validity may
be reported independently only if exact item identity remains unambiguous.

The caller retains each judge's FIRST response exclusively, even if malformed.
The pure scorer accepts the two explicit raw first responses and their frozen
packet bindings; it does not call a judge, request replacements, adjudicate,
choose favorable labels or assert independently verified firstness. Report
that provenance/firstness is an external execution attestation. Both nonauthor
judges assess independently and neither sees the other's conclusions before
submitting. Tests must not manufacture model-semantic reliability claims.

## SJ4 — Fixed denominators, paired uncertainty and gate

Keep all 24 cases per QA arm. Report completed answers, consumed failures and
not-run separately; among actual answers report agreed correct/wrong/unknown,
support, unsupported/stale question counts and claim counts, and severe
conditions. Report the 18 known-answer and 6 qualified subsets separately.
No-answer is not a judged supported abstention and never receives correct credit.

A supported-correct first answer requires both first judges to agree correct
AND supported AND mechanical retention of at least one complete required set.
Missing required support, a genuine absent answer, or agreed incorrect/unsupported
judgment proves false. Otherwise uncertainty remains unknown. Do not use text
matching, blanket abstention, probe evidence or missing baseline judgments to
award semantic success. Agreement is still a judgment, not proof of truth.

Report both judges' individual values and fieldwise consensus. Disagreement or
unknown is not resolved by the primary's opinion. Compute conservative paired
gain bounds by treating each arm/case supported-correct as true/false/unknown;
report resolved wins/losses/ties and uncertain pairs. Fixed-denominator proven
counts alone cannot establish the +3 gate if unknown baseline answers could
erase the gain. Its lower bound must be at least +3.

Promising requires all of: an accounted, integrity-valid run; the paired gain
lower bound >=3; more complete required evidence sets retained in bundle packed
evidence; no added unsupported or stale question counts AND claim counts;
no newly positive predefined severe condition on any case; known safety/count
fields for every actual answer; and independently satisfied resource ceilings.
Unknown safety/counts block rather than become zero. Shared existing severe
failures do not by themselves establish a newly added failure, but must remain
visible and cannot clear D12/product readiness. No-answer does not invent a
claim count but utility/completion remains independently visible.

Report reservation, known partial model-price estimate, unknown-usage reserved
amount/count, physical intents and dispatch/settlement distinctions, latency,
stored bytes, and peak RSS unknown unless measured. Do not add inherited
historical spend to per-run spend or treat null prices as free. Agent service
cost is unknown unless exposed. Any unknown/invalid resource accounting blocks
the gate; an unknown conservative usage reservation is not itself a fabricated
known-price total. The original cumulative400USD ledger/protected30USD are
launch-level constraints, not a new allocation or refunded allowance.

Every result is an authored complete-map/scripted-capture mechanism diagnostic,
not natural long-history MOC, official LongMemEval/Mem0 parity, a confidence
claim about population accuracy, deployment readiness or a cleared D12/Stage2/3.

## SJ5 — Offline acceptance and delivery

Author declares concrete exported function names/input/output shapes before
implementation; primary confirms the seam without changing these outcomes.
Use all24 frozen CF cases in the test matrix and independently verify every
anchor, subset and denominator. Include at least one actual BR prepared run
with real core and both imported transports against deterministic fake HTTP,
then derive bounded mutation fixtures from retained observations. No operational
ledger/provider/model invocation, direct memory SQL or efficacy claim.

Test: full-chain correct; correct value missing identity bridge; qualified
answer with optional background omitted; optional unsupported claim; stale
value; wrong subject/scope; each severe-condition comparison; no-answer/not-run;
malformed first raw retained; fieldwise disagreement; internally inconsistent
counts; unknown baseline cannot manufacture +3; new harm blocks; shared harm
remains visible; probe data cannot improve QA; changed/reordered/forged packed
evidence or source coordinates denied; first answer/wire mismatch; fixed24
denominator after stopped run; same seed stable/different judge orders; no arm
or other-judge leakage; and successful/assertion/setup cleanup through owned
workspaces. Assert outcomes, not merely copies of implementation helpers.

Primary reads all5paths, inventories Git versus independent tree/filesystem,
and runs focused, full algorithm-development, generic and validation gates on
Node22.16/24.15 with actual exits and zero skipped required paths. Run both
Claude validators. Comparison/scoring contributor gates additionally include
test:longmemeval and demo:longmemeval-comparison on both; include further public
or mixed demos only if their documented triggers are actually touched. No
TypeScript gate exists. Preserve all observed failures/corrections and unknowns.
Freeze exact tested commit; independent nonauthor Standards+Spec both pass
before push. Monitor all latest-head CI and mergeability. No merge/release/deploy.

Only after this packet's accepted delivery does primary freeze exact runtime,
scorer, source, rubric, manifest, seed and launch protocol for a FIRST new live
comparison and later FIRST independent judgments. No closed-run reuse.

## Primary preimplementation clarification — source identity and resource scope

2026-10-11, before implementation, first new live answers or judgments. The
original contract above is preserved. The read-only concrete BR interface check
found that preparation.cases[].source intentionally excludes evaluator/report
family, while its sourceSha256 binds the complete original CF case. Accept an
additional explicit frozen CF sources JSON input with all original fields.
Validate its exact fixed value hash, schema/roster and every per-case hash;
compare its family-free source projection byte-for-byte with the retained
preparation. Do not invent/reconstruct omitted family or read a source file
inside the pure modules. This changes no runtime data, source, rubric or metric.

Detached prepared/sidecar observations are not runtime capabilities. Provenance
checking may replay only the exact recorded get results through the existing
pure verifier and validate the closed serialized bundle/declaration shape. It
must never rebrand observations into WeakMap/WeakSet capabilities or use a new
retrieval to repair the actual packed evidence.

For SJ4, resource compliance concerns the accepted CF7/BR execution ceilings and
conserved accounting: at most192 physical intents,960000 reserved microUSD,
unchanged per-intent reservation, specified token/deadline limits and truthful
history/settlement accounting. Unknown or invalid accounting, or unknown
compliance with a specified ceiling, blocks the gate. Unknown usage remains
fully conservatively reserved and is not a fabricated free request.

Peak RSS and agent service costs are separately reported descriptive measures;
CF/BR set no RSS or service-cost ceiling. Their explicitly unmeasured values do
not automatically make the narrow mechanism gate impossible. They still prevent
any measured lightweight-footprint, full-cost or readiness claim. This is not a
new or relaxed efficacy threshold: +3 paired lower bound, better complete-set
retention and all original no-added-harm/safety gates remain unchanged. D12 and
original Stage2/3 remain uncleared regardless of a promising local result.

The retention-improvement unit is a QA case with at least one complete minimal
requiredEvidenceSet in its actual answer-facing packed evidence (0..24 per arm).
Report every named alternative set and all67 anchors, but satisfying two
interchangeable alternatives on one case does not earn two case wins. Optional
context never increases this retention gate. Prepared packed data without an
actual dispatched answer request is a separate observation, not evidence proven
visible to an answering model. This fixes the unit before any result is seen;
it does not change the requirement that more cases retain complete support.

## Primary API freeze from the read-only sketch

No implementation GO or accepted BR SHA is supplied by this appendix. After
BR delivery, append the exact accepted runtime commit before author dispatch.
The pure exports are:

```js
prepareSourceBundleScoring({ frozenSources, preparation, result, rubric, seedHex });
scoreSourceBundleComparison({ frozenSources, preparation, result, rubric, seedHex,
  packetBindings, rawFirstResponses });
createSourceBundleJudgePackets({ bindings, seedHex, items });
parseSourceBundleFirstJudgments({ packetSet, rawFirstResponses });
```

The first two live in source-bundle-scoring.mjs; the last two are pure helpers
in source-bundle-judging.mjs. seedHex is exactly64 hexadecimal characters.
Preparation returns version, status ready/denied, issues, bindings, mechanical,
packets, privateMapping and excludedAnswers. Scoring regenerates preparation
and packet hashes; it never trusts an imported private mapping. Its report has
version, status, integrity, bindings, denominators, cases, stages, probes,
judgments, summaries, paired, harms, resources, gate and limitations. Integrity
denial does not produce a semantic assessment. Honest stopped execution is not
automatically source-integrity denial: report valid retained observations and
unassessable parts separately, and never allow its promising gate.

packetBindings contains exactly the two judgeId/packetSha256 pairs for A and B.
rawFirstResponses contains judgeId/rawResponse; rawResponse is a literal first
string or null for missing. Packet-visible versions/names are generic, not an
algorithm/treatment label. A packet hash binds the packet payload, not a
self-referential object containing its own hash.

The strict first response is first-answer-judgment-v1, packetSha256 and items.
Each item has itemId; correctness and support each have value yes/no/unknown,
rationale and refs; unsupportedClaims and staleClaims each have value
integer/null, rationale and refs; severe contains one conditionId/value/
rationale/refs entry for each predefined condition. Freeze bounds before code:
at most48 item outputs, each numeric claim count0..128, each rationale at most
1600 UTF-16 units, each field at most16 references, and each whole raw response
at most4 MiB of UTF-8. References identify an actual packet-local text target
with an exact valid nonempty UTF-16 start/end range. No partial-text extraction
from malformed JSON, replacement output or retrospective schema revision.
An oversized response remains externally retained as the original first raw
artifact; bounded assessment records denial/unknown and its binding, not a
fabricated empty valid response. Judges may use no references for an unknown
field; valid-reference checks themselves do not prove semantic entailment.

Never select returned answers solely by slot.execution===completed: a stopped
or failed slot may retain its actual first answerResult. Conversely, text found
in a transport response without an actual returned answerResult is not silently
upgraded to a returned answer. Preserve these distinctions explicitly.

Resource evidence is also explicit: mechanically validate retained new intents,
ordered deltas, headers, wire/count/token totals, run elapsed and frozen deadline
bindings. Original complete history-prefix preservation and each phase's
absolute deadline enforcement rely on the accepted fixed runtime and external
execution provenance; existing artifacts do not independently reconstruct every
absolute dispatch timestamp or every old history row. Label that basis, never
claim those missing independent measurements, and never use an opaque caller
boolean to bypass observable consistency failures. No new BR instrumentation or
full old-history duplication is required. Missing/invalid specified accounting
still blocks advancement. Consistent artifacts are not proof against fabrication
of an entire transcript; the first live launch separately pins and attests the
accepted runtime execution. This evidence-scope clarification is prospective,
not a relaxation based on observed model results.

Independent prospective planning sanity check found no implementation blocker.
For SJ3, no paired answer means no explicit counterpart or pair presentation
inside an item, and no arm/pair mapping given to judges. Each of the two packets
still contains every actual returned answer in opaque hash order; identical
questions/sources can reveal counterparts. Instruct each judge to assess each
item on its own shown evidence, and report this imperfect concealment. Do not
silently introduce separate executions or replacement judgments per item.
This planning check is not the later fixed-diff independent code review.

## Primary bounded parallel subpacket — SJ3 only before BR delivery

To use the independent work safely while primary finishes BR acceptance, one
bounded SJ3-only author subpacket may start at already accepted CF
51bf373de67680d1fcf5ac0a7b29de1ae0f7055b in the new
experiment/source-bundle-scoring worktree. This prospectively supersedes only
the wait-before-any-implementation rule, not full integration/delivery/launch.
Exactly three paths are permitted at this checkpoint:
evaluation/algorithm-development/source-bundle-judging.mjs,
evaluation/algorithm-development/test/source-bundle-scoring.test.mjs, and this
verbatim contract in docs/plans/source-bundle-scoring.md.
No scoring.mjs or limitations edit yet.
Implement only the two frozen generic judge packet/parser helpers and their
pure bound/blinding/first-raw/unknown/reference/contradiction tests; no BR
imports, core/SQLite/store, ledger, source-file loading, runtime validator or
efficacy score. These helpers are not an execution grant or trusted provenance.

The author runs focused pure tests on both pinned Nodes and validation, then
STOP with those three files uncommitted/unstaged. Primary may fast-forward this
still-CF branch to the exact accepted BR commit only after its delivery, while
independently preserving the three nonoverlapping files byte-for-byte and
recording that fixed base. Only then dispatch the remaining SJ1/2/4/5 work within
the original five-path scope. The eventual PR targets the accepted BR branch;
final full gates, independent dual reviews and CI cover the combined candidate.
No score, first judgment, provider call or closed-cohort access occurs here.

## SJ3 author checkpoint — pure normalized-data helpers only

The author preserved the complete prospective contract above as the original
21,844-byte prefix, SHA-256
`4a2118346cca74e4d6b5d40afe3356b7f407a78b9dfa199848b128ecd44ee9a0`.
This subpacket remains on accepted CF base
`51bf373de67680d1fcf5ac0a7b29de1ae0f7055b`; it does not implement the
runtime verifier, scorer, live execution, resource gate or launch grant.

### Concrete helper interface

`createSourceBundleJudgePackets({bindings, seedHex, items})` accepts closed
JSON data. Bindings contain exactly `sourcesSha256`, `rubricSha256`,
`preparationManifestSha256`, `runManifestSha256`, `resultSha256` and
`runtimeCommitSha`. Hashes and the seed use canonical lowercase hexadecimal;
the seed is 32 bytes. These are consistency metadata, not attestation.
Each of at most 48 items contains exactly `slotId`, `question: {text, date}`,
`sources: [{id, eventTime, messages: [{role, content}]}]`, `rubric`,
`passages: [{recordedRole, text}]` and `answer`. Each source has one message;
roles are `user` or `assistant`. The rubric uses the closed CF case shape,
including separately bound optional context, but is supplied explicitly rather
than loaded from a source or rubric file. The helper checks local literal
anchor coordinates and references; this is not frozen-source provenance proof.

The frozen result has `version`, `bindings`, `seedSha256`, `packets`,
`privateMapping` and `limitations`. The two packet rows contain `judgeId`,
`packetSha256` and `payload`. The payload has generic `version`,
`instructions`, `bounds`, `responseSchema` and `items` only. Its hash does not
include itself. Independent A/B salts derive opaque item IDs and hash order.
Private mapping rows contain `judgeId`, `itemId`, `slotId` and
`normalizationSha256`; neither these rows nor binding hashes enter a judge
payload. The normalization hash covers the canonical role/text passage array.

Visible items contain `itemId`, `question`, `originalSources`, `rubric`,
`packedPassages`, `answer` and `questionTargetId`. Source, anchor and condition
IDs are consistently remapped to item-local opaque targets. The rubric is a
closed serialized JSON text target with its original case ID removed. Source
text, recorded role, time, question text/date, first answer and passage order
remain literal. The helper does not infer provenance from a role. Identical
questions and sources can reveal counterparts even without direct arm or pair
mapping; the instructions require independent item assessment and explicitly
state that concealment is imperfect.

`parseSourceBundleFirstJudgments({packetSet, rawFirstResponses})` accepts the
two A/B rows in fixed order, each exactly `{judgeId, rawResponse}`. A raw value
is the original string or `null` for missing. It never accepts a replacement,
extracts a partial JSON judgment or adjudicates disagreement. Packet hashes,
closed serialized rubric structure, item identities, mapping coverage and
normalization hashes are checked before attribution. Ambiguous item identities
deny all fields for that item; a uniquely bound item can retain independent
valid fields even when another field is missing or malformed.

The frozen parsed result has `version`, `bindings`, `packetBindings`,
`judges`, `items`, `provenance` and `limitations`. Each judge record retains
`judgeId`, `packetSha256`, `rawResponse`, `rawSha256`, `rawBytes`, `retention`,
`status`, `issues` and per-item assessments. Parsed fields contain `status`,
`value` and `issues`; consensus fields contain `status`, `value` and `reason`.
Counts use `null`, never zero, for unknown. Severe conditions retain their
opaque ID and ordinal; consensus uses that ordinal. No supported-correct,
paired lower bound, harm gate or efficacy score is returned in this subpacket.

### First-response and reference rules

The frozen first schema is `first-answer-judgment-v1`: exact packet payload
hash, at most 48 item rows, correctness/support and every predefined severe
condition using `yes`/`no`/`unknown`, and unsupported/stale counts using integers
0 through 128 or `null`. Rationales are at most 1,600 UTF-16 units; each field
has at most 16 references. Known fields require a nonempty rationale and at
least one reference; unknown fields may have neither. All references are
nonempty item-local UTF-16 ranges and cannot split a surrogate pair.

Support and unsupported-claim references may target only that item's actual
answer or packed passages. Full original sources are not answering evidence.
Correctness, stale-use and severe-condition assessments may also target the
separately labeled original sources, question, rubric or condition text. Local
coordinate validity is not semantic validation. Support `yes` together with
a known positive unsupported count makes both fields contradictory/unknown.
Disagreement remains fieldwise unknown; malformed fields do not become
favorable zeros or receive replacement judgments.

Raw responses up to 4 MiB UTF-8 are retained literally, including empty,
malformed, duplicate-key or wrong-binding strings, with their hashes and byte
counts. A larger original remains the caller's external first artifact; the
bounded assessment records its exact hash/size, `external-oversized-first-artifact`
retention and unknown fields, rather than pretending it was an empty valid
response. Duplicate decoded JSON keys, including escaped aliases, are denied.
Input snapshots reject accessors, proxies, hooks, custom prototypes, sparse
arrays and cycles without evaluating hostile input. The pure module imports
only `node:crypto` and `node:util`; it has no filesystem, core, database,
provider, transport, ledger or source/rubric loader dependency.

### Author verification and evidence boundary

Evidence is retained in `/tmp/cairn-sj3-author.kzFBShOc`.
The initial Node22 focused run, `focused-first-node22.log`, actually exited 1:
8/9 tests passed, with no skips. The sole failure compared a defensive
null-prototype JSON snapshot to a normal-prototype test object; text/date
values were identical. The corrected assertion compares their exact serialized
question bytes. Canonical property projection and closed serialized rubric
validation were also tightened; literal role, time and text requirements were
not relaxed. `focused-corrected-node22.log` actually exited 0, 9/9 tests,
zero skips/cancellations. The final Node24 focused run,
`focused-final-node24.log`, actually exited 0, 9/9 tests, zero
skips/cancellations. Both commands use the owned `tools/testing/run.mjs`
entrypoint and the pinned Node22.16.0 / Node24.15.0 executables.

The nine pure tests cover 48 deterministic generic normalized items, both
opaque packet permutations, literal preservation, independent hash checks,
private metadata exclusion, closed-input rejection, first-raw retention,
binding/identity/duplicate/missing rules, fieldwise unknown/disagreement,
contradictions, reference scopes/coordinates, schema bounds, packet tampering,
dependency tracing and owned workspace cleanup after success, assertion
failure and setup failure. Synthetic parser controls are not model judgments
and establish no answer improvement. `npm run validate` actually exited 0 on
both pinned Nodes (`validate-node22.log`, `validate-node24.log`). No heavy BR,
generic or complete algorithm suite was run for this parallel pure subpacket.
The eventual combined scorer still requires accepted BR integration, its
remaining author work, final full gates and independent review.
<!-- Full offline integration notes copied verbatim below; original prefix/evidence preserved. -->

# Source-bundle scoring integration record

Primary prospective clarifications, 2026-10-11. This is not full author GO,
an accepted runtime binding, a launch grant or a semantic score. The immutable
21,844-byte original contract remains unchanged. Full implementation still
waits the explicit corrected-BR prerequisites in the prospective scheduling
amendment below and a separate explicit dispatch.

## Read-only remaining-packet inspection

The same actual GPT-6.1 Sol/high author completed a mailbox-only interface map
while primary ran corrected BR acceptance. No files, tests, provider, ledger
or closed-cohort access occurred. No new schema blocker was identified.

For original anchors, indexed windows include the rendered date/role prefix.
Some originMap.windows originalStart/End fields are therefore null. Reconcile
exact source coordinates through the retained originMap.turns bodyStart/bodyEnd
and normalizedStart/End plus indexed-window offsets. Neither global substring
matching nor treating null window coordinates as missing source is sufficient.
This is a use of the existing retained origin map, not invented source data.

The scorer remains explicit-input pure processing. It must not import the
OpenAI adapter solely for tokenization: that entrypoint reads prompt files at
module load. Validate retained integer token counts, provider counts/usages,
caps, exact request bodies and hash bindings; enforce observable contradictions
and resource sums independently. Real local token measurement is attested by
the accepted fixed BR preparation/runtime, not independently re-tokenized by
the pure scorer. State that evidence basis without calling a recorded numeric
count an independent measurement. An invalid/missing required count or an
unbound body cannot pass. Complete transcript fabrication is already outside
the contract's pure consistency assurance and still requires external launch
provenance. No ceiling, resource exception or favorable unknown is introduced.

The contract permits exactly 64 hexadecimal seed characters; normalize case
to one canonical encoding of the same 32 bytes at the scorer/helper seam.
Do not change seed bytes, ordering salts or the first-response policy. Pure
recorded-get replay may be asynchronous; it opens no store or external port.

The new optional probe.selectFailure records the actual consumed select cause.
A context_budget_exceeded run is reportable as honestly stopped, never
promising. In its probe variant rank is not-reached, not observed-empty. An
allegedly accounted run with a bound globally fatal overflow is inconsistent.

## Prospective aggregate-retention compatibility (runtime correction pending)

BR review subsequently found that valid individual raw responses can sum beyond
the general32MiB observation snapshot: actual192-intent padded fake HTTP completed
and settled but lost its final aggregate report. A bounded coordinator correction
is now in progress under bundle-comparison-correction2-contract.md. It adds only
actual retained response-string bytes to final report capacity, preserving the
32MiB nonresponse budget,500000nodes/depth28 and all upstream per-response/call/
token/cost bounds. Conservative raw allowance is192*262144*3 bytes because the
unchanged ordinary UTF-8 decoder may replace a physical byte with three encoded
bytes. This is bounded admitted data, not an RSS or artifact file-size promise.

When full SC is later authorized, it must consume the accepted complete BR report
without routing its whole literal raw-body aggregate through a single32MiB
generic input snapshot. Preserve pure explicit-input defensive validation and
closed size/node/depth bounds; a body-specific allowance is not permission to
expand corpus, judge packets, metadata, provider calls, or resource ceilings.
Validate the actual retained strings and their bounds consistently; do not strip
raw bodies to get a score. The future SC acceptance must cover a valid admitted
large aggregate and an oversized unrelated metadata negative. Do not treat this
pending correction as reviewed/accepted or begin full SC before explicit GO.

## Accepted runtime binding

Pending final corrected BR primary matrices, fixed-commit independent dual
review, remote CI and mergeability. No full implementation GO yet. The explicit
prospective scheduling amendment below governs when offline implementation may
begin; accepted delivery and live execution still require every original gate.

## Independent prospective sanity check

Nonauthor bundle_transport_spec62, actual GPT-6.1 Sol/high, read-only check at
20:41 UTC found no blocker in these two clarifications. This is neither final
BR nor final SC review and supplies no acceptance or implementation GO.

The reviewer tied pure IO-free processing to contract27–32 and the required
observable ceiling/consistency checks to220–225 and295–306. Existing records
include six preflight local counts and exact wires/hashes, ordinary transport
localInputTokens/requestBytes/provider counts/usage, QT bound wire/count/usage,
and answer packed.inputTokens. No missing required count may become zero and
no opaque caller boolean may replace these checks. Actual QT local tokenization
remains an explicitly labeled accepted-runtime measurement.

For anchor mapping, intersect indexed-window spans with each origin-map turn
body, then translate with normalizedStart + (renderedOffset - bodyStart).
The reviewer correctly cautioned that normalized offsets are not automatically
original offsets when normalizationChanged is true. Validate exact original
body/span bytes and source/capture identity, not only an affine calculation.
Primary adopts this qualification without relaxing exact original UTF-16 anchor
checks or changing any CF source/rubric. No new reads or source repair allowed.

## Primary prospective scheduling amendment — implementation during remote CI

Before full SC dispatch, any new live answers or judgments, primary explicitly
supersedes only the original wait-for-BR-remote-delivery-before-full-offline-
implementation rule. After both corrected BR local matrices and both final
fixed-commit independent review axes pass, and that exact commit has been
pushed to its dependent PR, primary may fast-forward the stopped SC branch to
that exact reviewed runtime commit and dispatch the remaining pure five-path
SC work while BR remote CI runs. This uses independent local work during remote
checks; it is not a waiver of any BR or SC acceptance gate. The three SJ3 files
must be independently hash-preserved during that fast-forward.

Until all latest-head BR CI is successful and mergeability confirmed, call it
a reviewed pending-CI runtime, not an accepted delivered dependency. No full
SC final acceptance, publication, first live grant, model call or judgment may
rely on that pending state. If BR CI identifies a required source correction,
stop dependent SC implementation at its next safe checkpoint, preserve work,
integrate only a newly reviewed/tested exact BR candidate, and rerun all affected
combined gates/reviews. Do not silently substitute a changed branch head.

Full SC final primary two-runtime matrices, independent dual reviews and its
own latest-head CI remain required, after confirmed BR delivery, before a new
live freeze. No corpus, metric, threshold, resource limit, firstness policy,
paid authority, merge/release/deploy rule or closed cohort is changed. Primary
owns this scheduling decision; the author still needs an explicit full GO with
the pinned runtime SHA and the final exact five-path packet.

## Prospective SJ5 fixture decision — offline logic controls only

Primary selected the fixed source-only policy before the feasibility lookup:
sort the actual exposed receipt passages by their literal rendered session-date
prefix, then stable sourceIndex/card identity; ordinary selects the earliest one,
bundle selects the earliest six in two disjoint groups of three (terminal is
the last member of each group), and the separate natural probe selects the
first three. No question, rubric or gold labels enter those fake model ports.
This is a deterministic plumbing policy, not the new live algorithm's policy.

The read-only author lookup and primary independent Node22 JSON calculation
both actually exited 0. The primary also verified all67 exact original UTF-16
anchor slices against the24 frozen sources. Earliest1 has a complete minimal
set in BQ05/BQ13 (two cases); earliest6 in BQ01/BQ03/BQ05/BQ08/BQ09/BQ10/BQ13/
BQ14/BQ15/BQ18 (ten cases). Mechanical case difference is eight, not eleven
alternative sets and not a model score. No alternate policy was tried. The
primary lookup is retained in tool output bf2e7c, 2026-10-11 21:57 UTC.

After explicit full GO, use one genuine all24 BR prepared execution against
fake HTTP with that fixed policy and legal padded raw responses. Answers are
constant plumbing text, not gold-derived text. Predeclare only BQ24 ordinary
answer content as an empty string with valid HTTP/model/usage. Its ordinary
answer parser should produce invalid_answer_response after healthy settlement:
answerInvoked true, packed request retained, answerResult/answer null, while
the raw transport final may correctly be succeeded with failure null. Verify
the actual result rather than assuming those expected statuses. Expected fixed
denominators are48 QA slots,47 actual returned first answers,24 probes,192
intents and120 closed owners. This must leave the mechanical2-to10 observation
unchanged. Returned/persisted reports and all literal raw bodies must agree;
the aggregate exceeds32MiB without relaxing any physical response bound.

Use a second fresh genuine all24 preparation with an already-aborted explicit
caller signal and independent owned synthetic ledger. Verify actual stopped/
cancelled output before first dispatch, all72 not-run slots, zero intents and
null history.base/finalState. Do not fabricate stopped execution, history
hashes or provenance. Retained immutable JSON from these two fixtures may serve
many pure parser/scorer mutations; do not repeat core/ledger runs for every
judgment mutation. Owned success, assertion and setup cleanup remains required.

For arithmetic controls only, independently script judge labels over the
literal plumbing answers. A positive gate control credits bundle BQ01/BQ03/
BQ08, with baseline false through incomplete required sets, and all other
credit false with known no-added-harm fields: paired lower/upper must both be
three. An unknown-baseline control credits bundle BQ05/BQ13/BQ01 but leaves
the two mechanically complete baseline answers unknown: lower one, upper three,
not promising despite a naive3-minus0. BQ03 optional S11 omission cannot remove
minimal-set credit; an added unsupported optional claim must block the harm
gate. BQ13/BQ18 alternatives still count once per case.

Use an incomplete-set case such as BQ02 outside the ten positive cases for
new/shared severe, unsupported and stale question AND claim count controls,
without changing the positive mechanical observation. Test each predefined
severe condition, unknown safety fields, disagreement and contradictions.
Shared harm stays visible and cannot clear D12. Probe mutations cannot improve
QA; absent answers receive no semantic credit. Missing, malformed and duplicate
first judgments stay retained and are not replaced. Integrity mutations must
fail actual source/read/wire/answer consistency, not be repaired by synchronizing
invented execution or history. Retain the raw first outputs and bindings.

The chosen runtime fixture does not contain a complete three-card packed chain
or a literal later-terminal-only answer with an earlier bridge absent. Test
credit denial on actually incomplete packed chains using explicitly scripted
correctness=yes labels; never describe those labels or constant answers as an
observed semantically correct terminal answer. Full-chain mechanical positive
coverage is the actual two-source chain; every three-source anchor remains
independently checked through capture/rank/selection/packing observations.
This is enough for the pure scoring seam, not semantic or three-hop efficacy.

The actual padded fixture must be accepted without trimming its raw bodies.
For a metadata-bound negative, oversize an existing nonresponse string field
and assert the dedicated bound denial; rejection of an unknown extra key alone
does not prove metadata budget isolation. No judge packet/parser cap increase.
These are prospective implementation controls only; no full GO, accepted
runtime, model score, paid launch or changed metric is supplied here.

Unlike BR's internally constructed final report, SC receives caller-supplied
objects. Determine any raw-response allowance through descriptor-first bounded
validation: do not evaluate getters, proxies or inherited hooks while inspecting
result/intents/final/responseBody before its defensive snapshot. Add focused
accessor/proxy negatives proving those hooks are not invoked. This preserves
the original explicit bounded-JSON boundary, not a new product feature.

## Pinned reviewed runtime and full offline author GO

2026-10-11 22:23 UTC. The prospective scheduling amendment is now satisfied:
BR candidate6abed0ccdfe3815d42b25db04adb159483ded156 passed both final primary
eleven-command Node matrices and both final independent full-diff reviews,
was pushed exactly, and is PR401 against experiment/source-bundle-corpus.
Standards PASS has one nonblocking duplicate native-cause predicate suggestion
deferred outside accepted QT scope; Spec PASS has no findings. Remote head is
the reviewed commit, ready OPEN/MERGEABLE; remote CI is still running. This is
a reviewed pending-CI runtime, not yet accepted delivered dependency.

Primary fast-forwarded only experiment/source-bundle-scoring to that exact
commit. The three existing SJ3 files remain byte-identical: judging6dcb63a5...,
testd20cffc8..., plan0463ba8e...; untracked/unstaged status preserved. No main,
GitHub PR merge, release or deployment occurred. A new ignored local adapter
node_modules directory points only tiktoken to the unchanged existing locked
1.0.22 install; no shared npm install or dependency lock was modified.

The separate explicit author dispatch now authorizes the remaining SJ1/SJ2/
SJ4/SJ5 implementation in exactly the original five paths at this pinned base.
Copy these integration notes into the tracked plan after the immutable original
21844-byte contract and existing SJ3 evidence. Preserve those original bytes,
all inherited BR/QT/QB/CF/core/transport/ledger and every resource/semantic gate.
The future runtimeCommitSha binding is the exact6abed0c... BR execution pin,
not an opaque caller declaration of proven external execution. SC's own future
commit is separately pinned by any later launcher.

Full author GO does not grant final SC acceptance, publication or model calls.
Those still require successful latest-head BR remote CI/mergeability, final
SC two-runtime matrices, both independent review axes and SC's own exact-head
remote CI. Any required BR correction stops dependent work at the next safe
checkpoint and requires newly pinned combined verification. No closed-cohort
access, operational ledger, credentials, first judge or live grant is authorized.


## Full offline author checkpoint

Fixed base: `6abed0ccdfe3815d42b25db04adb159483ded156`, reviewed pending-CI BR PR401 at dispatch. Actual author GPT-6.1 Sol/high; primary owns delivery and final matrices. Exactly five paths, no inherited edits. Pure consistency is not external execution/firstness attestation. Existing SJ3 hashes were preserved before these scoped changes. Full modules use explicit inputs only; tests alone own actual fake-HTTP/prepared stores and synthetic ledgers.

## Final BR delivery receipt

2026-10-11 22:34 UTC. The reviewed runtime remains exact
6abed0ccdfe3815d42b25db04adb159483ded156. PR401 is ready OPEN/MERGEABLE;
all27 applicable latest-head remote checks succeeded. Primary's inspector
finished with actual exit0 and exclusively retained a pass:true proof in
bundle-comparison-ci-6abed0c.json. The three independently checked successful,
completed exact-head workflow runs are38180113988 (CI pull_request),
38180114047 (npx setup pull_request) and38180105351 (npx setup push).
Thus the pending-BR-CI requirement above is satisfied, not waived. BR is an
accepted delivered dependency, still unmerged. This receipt changes no source,
corpus, rubric, scoring threshold, firstness or resource policy. Full SC still
requires its own final matrices, independent dual review and exact-head remote
CI before publication is considered accepted or a first live protocol is frozen.

## Full offline scoring implementation and evidence boundary

The current runtime dependency is the accepted, delivered and unmerged BR
commit `6abed0ccdfe3815d42b25db04adb159483ded156`. The receipt below
supersedes only the historical pending-CI status, not the dispatch history or
any acceptance requirement. The author remains GPT-6.1 Sol/high. Primary owns
final whole-repository matrices, the fixed-byte independent reviews, commit,
publication and any separately authorized first live launch.

### Pure retained-data interfaces

The four frozen exports are implemented without filesystem, SQLite, provider,
model, operational ledger or runtime execution in either scoring module:

- `prepareSourceBundleScoring({ frozenSources, preparation, result, rubric, seedHex })`
  returns exactly `version/status/issues/bindings/mechanical/packets/privateMapping/excludedAnswers`.
- `scoreSourceBundleComparison({ frozenSources, preparation, result, rubric, seedHex, packetBindings, rawFirstResponses })`
  returns the bound integrity, fixed denominators, cases/stages/probes, first
  judgments, summaries, paired bounds, harms, resources, gate and limitations.
- `createSourceBundleJudgePackets({ bindings, seedHex, items })` and
  `parseSourceBundleFirstJudgments({ packetSet, rawFirstResponses })` retain
  the closed SJ3 normalized-data/first-raw interfaces recorded above.

Preparation reconstructs the original full source value and per-case hashes,
the exact family-stripped source plans, literal source-role-time mapping and
original UTF-16 turn-body coordinates. Recorded gets are replayed once, in
order, through the existing pure evidence verifier; their actual inputs and
receipts must bind the frozen source mapping. Serialized bundle declarations
are checked without minting, importing or rebranding a runtime capability.
Whole actual evidence units and organization wrappers are preserved.

Prepared packing is observed only when a packed artifact exists. Actual packed
evidence additionally requires the durable dispatched answer intent and exact
literal answer request wire. A settled raw answer without an actual returned
answerResult is not upgraded to an answer. Not-reached and observed-missing
are different observations; natural probes remain separate from all QA credit.
The two supported response decoders follow the pinned runtime: ordinary rank
and select concatenate ordered output_text parts across assistant messages;
QT keeps its single-message/single-part shape. Actual packing retains the
existing disjointness protection. No accepted runtime semantics were widened.

Inputs receive descriptor-first closed JSON validation before nested body
inspection. Getters, proxies and hooks are not evaluated. Only actual retained
`result.intents[i].final.responseBody` strings receive the bounded body-only
allowance; metadata retains 32MiB and the existing node/depth limits. Response
bodies are not trimmed. Judge packet and first-response limits are unchanged.

### Mechanical, judgment and resource policy

All 24 cases, 48 QA slots, 24 probes, 18 known and six qualified cases, and all
67 anchors remain in the fixed denominators. A case retains a complete set if
at least one minimal alternative is complete in its actual dispatched answer
evidence; optional context and multiple alternatives cannot inflate that count.
Supported-correct credit requires an actual returned first answer, a complete
minimal set and agreed correctness/support. False, unknown, disagreement,
missing, malformed and duplicate first judgments are not favorable defaults.

The paired lower bound must be at least three and complete-set case retention
must improve. Unknown safety, added unsupported or stale questions or claims,
newly positive predefined severe conditions, stopped execution and invalid
specified resource accounting prevent a promising mechanism result. Shared
harm remains visible and D12 is not cleared. Scripted labels exercise this
arithmetic only and are not semantic model evidence.

Resources validate retained wires, closed usage/count measurements, caps,
prices, reservations, ordered new ledger deltas and scalar history witnesses.
Known microUSD is a partial known sum; unknown usage/reservation and missing
final records remain explicit. The original complete historical prefix and
absolute per-phase deadline enforcement depend on the accepted fixed runtime
and external execution provenance; they are not independently reconstructed
from absent old rows or timestamps. Recorded token measurements are wire-bound
but not independently retokenized here. Peak RSS and agent service costs remain
unknown; artifact consistency cannot prove against a fabricated full transcript
or prove external execution or firstness.

### Executable fixture and control coverage

One genuine fresh owned all24 preparation and fake-HTTP BR run uses only exposed
literal source chronology/indices: first one ordinary source, first six bundle
sources in two groups of three, and first three natural map items. Ports do not
consult questions, rubric, gold or evaluator labels. The constant plumbing
answers have one prospectively fixed BQ24 ordinary empty response. It retains
192 intents, 120 closed owners, 48 QA slots, 47 actual returned answers and
24 completed probes. Count bodies are 65536 bytes and generation/answer bodies
262144 bytes, totaling 36175872 response bytes; returned and persisted report
and callback body literals are equal. Ordinary generated proposals are split
across two assistant messages/three text parts; the QT envelope remains single.

A second genuine fresh all24 preparation is pre-aborted before any dispatch.
It retains all 72 honest not-run slots with zero intents/owners and no invented
history. Owned workspace cleanup covers success, assertion and setup failures.
The inherited BR store, runtime, transport, adapter, corpus and rubric are
unchanged; test fixtures use only owned synthetic ledgers.

Independent literal slice and stage membership checks cover all 67 anchors.
Mechanical complete-set case retention is exactly ordinary two
(BQ05/BQ13) versus bundle ten
(BQ01/BQ03/BQ05/BQ08/BQ09/BQ10/BQ13/BQ14/BQ15/BQ18).
Scripted positive labels on BQ01/BQ03/BQ08 give paired lower/upper three; the
unknown-baseline BQ05/BQ13 control gives lower one and upper three rather than
a naive favorable three. Optional BQ03 S11 omission preserves minimal credit.
Incomplete packed evidence receives no credit even with scripted correctness.
Each severe condition, new/shared harm, unsupported/stale question and claim
counts, unknown/disagreement/contradiction fields and retained first-raw
malformed/missing/duplicate controls are covered. Source, coordinate, read,
whole-evidence, question, returned answer, exact wire, hash, token, deadline,
resource and probe mutations are denied rather than repaired with invented
execution. An existing allowed nonresponse field exceeds the metadata budget;
accessor/proxy negatives assert zero hook invocations.

The actual fixture has a complete two-source chain but no complete three-card
packed chain or literal terminal-only semantic answer. All three-card anchors
are checked mechanically; scripted incomplete-chain labels establish only
credit denial, not three-hop or answer efficacy.

### Retained author failure and final verification

The first actual Node22 fixture run `first-actual22.log` exited 1 after the
real runtime had retained the expected 192 intents/120 owners/47 answers and
large persisted report. Pure preparation then denied a source comparison
because defensive JSON objects have null prototypes. The bounded fix compares
exact serialized JSON data, preserving literal wire-string comparisons; source
mapping uses actual memory identity rather than assuming candidate order.
The failed log remains untouched. `preabort-seam22.log` subsequently exited 0.

Earlier full Node22 runs `focused22-round1.log`, `focused22-final.log` and
`focused22-closure.log` each exited 0, 17/17, with zero skipped/cancelled.
They are pre-final-byte evidence only. The ordinary split-output seam was found
by primary's source inspection, not reported as a reproduced runtime failure;
its narrow reconstruction fix and actual split-output fixture precede the
final two-runtime runs below.

The final source-held focused commands used credential-free `env -i`, the
version's explicit Node executable and PATH, `NODE_DISABLE_COMPILE_CACHE=1`,
`CAIRN_OPENAI_INSTALLED_OFFLINE=1`, and the owned TMPDIR
`/tmp/cairn-scoring-author.qKb5ntKP/tmp`:
`node tools/testing/run.mjs evaluation/algorithm-development/test/source-bundle-scoring.test.mjs`.
Each version's output has its own retained log; status was captured from the
actual owned runner, not inferred from a pipe or log tail.

| Pinned runtime | Final log | Actual exit | Passed | Skipped/cancelled | Duration |
| --- | --- | --- | --- | --- | --- |
| Node22.16.0 | focused22-final-split.log | 0 | 17/17 | 0/0 | 113.260s |
| Node24.15.0 | focused24-final-split.log | 0 | 17/17 | 0/0 | 99.231s |

Logs are retained under `/tmp/cairn-scoring-author.qKb5ntKP`; the original
failed log and all intermediate greens remain distinct. The owned runner waits
for its process group to settle before workspace cleanup; both fixture tests
also assert cleanup. Each of the scorer, judging helper and test module passed
`node --check` separately on both pinned executables, each actual exit0.
`npm run validate` also exited0 on both pinned PATHs with consistent version
0.3.1. Primary, not the author, owns the remaining full final matrices and
delivery review. No heavy duplicate generic/algorithm matrix was run here.

The final scope audit derives the five changed paths from Git and independently
from recursive filesystem/blob/mode comparison against the pinned base. It
checks the unchanged 21844-byte original contract prefix, verbatim integration
notes/receipt segments, append-only limitations prefix, unstaged/uncommitted
status, ignored tokenizer-only setup and zero inherited modifications. Exact
candidate/log hashes and the two-route audit are retained outside the worktree
for primary's fixed-byte handoff. These tests prove offline data consistency
and conservative scoring controls only; no semantic efficacy, measured
lightweight footprint, provider parity, Stage2/3 clearance or paid authority
is claimed.

## SC correction C1 prospective authorization (verbatim)

# SC correction C1 — observable outcome and token-limit consistency

Fixed rejected candidate a9ec8aa7dd9de1134ee7da40af4fa1f7ec424bd0, full review
base 6abed0ccdfe3815d42b25db04adb159483ded156. Same isolated scoring worktree
and sole existing author. This is a narrow correction under the original SC
contract, not a new experiment or a change to its scoring threshold.

## Ownership and boundaries

The GPT-6.1 Sol/high author may edit only the scoring module, its test, and
append evidence/correction notes to docs/plans/source-bundle-scoring.md and
docs/limitations.md. Preserve the entire original plan/contract prefix and
existing limitations. Do not change judging, source/rubric, runtime/transport,
budgets, limits, dependencies, CI, schemas, product defaults or private operator.
No operational data, credentials, provider, closed cohorts, commit or push.

## Evidence and hypotheses

Independent Spec report is retained in source-bundle-scoring-reviews-candidate1.md.
Primary's source-bundle-scoring-review-probe.mjs executes the actual extracted
validator with synthetic in-memory records. Two identical direct Node22 runs
returned actual exit1 with all four expectations red. This proves the helper
seam only, not the complete retained pipeline. No ledger/provider/files written
by that probe. Ranked falsifiable hypotheses:

1. Ordinary success permits non-null failure: changing only that field passes
   the helper while the planner sibling rejects it; an explicit success
   invariant should reject the contradictory record.
2. Known planner limits are enforced only for success: a legitimate stopped
   failed count at7025 passes resource compliance; outcome-independent known
   token checks should report noncompliance without fabricating measurements.
3. A later retained-input validator might already reject either case. Full
   public prepare/score regressions must establish whether that is true; do not
   count an extracted-function probe as end-to-end evidence.

## Observable acceptance

- Add regressions before source correction and retain their actual red result.
  Reuse the genuine actual24 fixture where possible; mutate only the needed
  retained fields and keep history/wire/source consistency explicit.
- A succeeded ordinary final record with non-null failure must deny assessment.
- An ordinary consumed failed/unknown record with an existing globally fatal
  normalized cause cannot coexist with an accounted run. Use the accepted
  runner's closed cause semantics; do not turn every healthy provider failure
  or timeout into a global fatal error, or invent a new runtime cause.
- A legitimate stopped planner overflow (count/input/output as observable)
  remains an honest retained stopped result and must not claim compliance
  satisfied. Preserve unknown values. Bind known numbers to the actual response;
  contradictory numbers/body/outcome must not be silently trusted.
- Keep valid successful, healthy consumed-failure and stopped observations
  behaving correctly. Existing promising arithmetic, first-judgment semantics,
  denominators, original source bindings and runtime caps must be unchanged.
- Tests must reach the actual public retained-input seam. Prefer an early-stop
  genuine synthetic run for planner overflow rather than a second full192-call
  fixture. No new export merely to test a private helper.

## Verification and delivery

Use the owned temporary-workspace runner. Capture red before the fix; then run
the full focused scoring suite sequentially on pinned Node22.16 and24.15 with
required tokenizer/transport and no key, explicit actual exits and no skips,
cancellations or residue. Run syntax/root validation on both versions. Do not
rerun unrelated full matrices. Primary will inspect the patch, personally run
affected gates, and record prior full matrices as evidence for a9ec8aa only;
the correction needs new exact-candidate evidence and both review axes against
the original base before any push. Report changed paths by two independent
routes, final hashes, evidence and STOP WRITES for primary acceptance.

## C1 implementation and author evidence

The correction owner remained GPT-6.1 Sol/high, in the same isolated
`experiment/source-bundle-scoring` worktree. Fixed rejected candidate:
`a9ec8aa7dd9de1134ee7da40af4fa1f7ec424bd0`; original full-diff base:
`6abed0ccdfe3815d42b25db04adb159483ded156`. The prospective correction
contract above is retained verbatim, SHA256
`4d147b85e5a8662fa891ddeecfb36bc8e4e8f222e2ac9112713cd5bb1a2659dc`.
The original 21844-byte SC contract and every preceding plan byte are preserved.

The primary's prior 18 broad and four exact-commit gates apply only to the
rejected candidate. Standards passed; Spec identified ordinary outcome/failure
inconsistency and failed planner token-overflow compliance. The diagnosing-bugs
workflow used those ranked hypotheses and prior deterministic extracted-helper
REDs, then added public retained-input regressions before changing source.

Author evidence is retained in
`/tmp/cairn-scoring-c1-author.vdd8sSov`; failed logs were not replaced.

- `red22.log`: actual exit 1, six passes/three failures including the failed
  nested-test parent, nine reported tests, no skips/cancellations. The real
  192-intent fixture accepted all three succeeded/failed/unknown ordinary
  authentication-failure corruptions as ready. The new early-stop fixture
  reached eight intents/five owners, but its first assertion incorrectly
  expected the thrown-fetch raw code `provider_failure`; the actual coordinator
  guard retained `provider_failed`. The HTTP503 record did retain
  `provider_failure`. This was an explained test expectation error, not a
  runtime correction. Log SHA256:
  `312152f6472b42bcf2c1b5defe3053403bd5d756f63aff7680233836993d3bea`.
- Only that expectation was corrected, and an independently nonfatal failure
  on a succeeded ordinary record was added before changing source.
  `overflow-red22.log`: actual exit 1, zero/one passes, no skips/cancellations.
  Public preparation was ready and scoring assessed the genuine stopped
  planner count7025 as compliance satisfied. Its actual QT final retained
  inputTokens7025/outputTokensnull, outcome failed, failureCode usage_overrun,
  settlementPersistedtrue and literal body
  `{"object":"response.input_tokens","input_tokens":7025}`, body SHA256
  `cf110625a5f4202389546fd463900942d2a8c01fc1b8cb5a8f67d8dd1366bfc0`.
  The genuine run stopped for usage_overrun after eight intents/five closed
  owners, retained earlier failed HTTP503 and unknown thrown-fetch ordinary
  slots, and completed the BQ01 probe. Log SHA256:
  `ba0797e255c9be4af23e05339f40308b1d386faf08ef23ccdbf0f301af26ae62`.
- Scorer SHA256 stayed
  `95488ad656e44541118f21309c5ee4128d7db04b07731f632cbe850b5122196b`
  throughout both RED runs. Both owned runner/workspace cleanups left their
  parent TMPDIR empty.

The narrow source change requires succeeded ordinary finals to have null
failure. Existing closed coordinator aliases normalize only known causes;
a globally fatal ordinary cause cannot accompany an accounted run. Healthy
provider failures/timeouts are not blanket-classified as fatal. Known planner
count/generation token values bind to their literal response regardless of
outcome, null remains unknown, and an observed failed overflow produces
resource compliance not-satisfied rather than pretending that a stopped run
met its cap. Count output must remain null. No runtime cause, cap, public
export, schema, judgment policy or scoring threshold changed.

The ordinary mutations are explicitly corrupt data controls, not asserted
executions: only the raw outcome/failure and directly bound delta outcome
change; source, wires and answers stay fixed. The early-stop control instead
uses a fresh genuine all24 preparation, the actual imported runner/transports,
an owned schema2 synthetic ledger and source-chronology-only fake HTTP. It
observes healthy failed/unknown continuation before the real QT overflow;
all48 QA/all24 probe slots remain. Contradictory count input/output values are
denied through public preparation. This packet's newly observed runtime
overflow is the count path; no new observed generation-overflow run is claimed.

Final full focused commands used `env -i`, version-specific Node bin PATH,
fresh owned `TMPDIR`, `NODE_DISABLE_COMPILE_CACHE=1`,
`CAIRN_SOURCE_BUNDLE_OFFLINE=1` and `CAIRN_BUNDLE_TRANSPORT_OFFLINE=1`:

```text
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/source-bundle-scoring.test.mjs
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs evaluation/algorithm-development/test/source-bundle-scoring.test.mjs
```

Both actual exits were 0: 19/19 passes, zero failed/skipped/cancelled. Node22
duration130590.975ms, Node24 duration147887.529ms. Final logs:
`focused22.log` SHA256
`df1bf7e8449f59c64dd89dac9bb51cbdc8cb45338c17db9b4aeeb6943a90568c`;
`focused24.log` SHA256
`d5eb323d19e9a08aea65c362a5df1ed88bcf29178984547b2a5f8706a160d5f2`.
The original 192-intent/120-owner/47-answer fixture, all67 anchors, two versus
ten complete cases, first-raw blinding, fixed denominators, paired lower-bound
and harm controls remained green. The new stopped run remained ready/assessed
with compliance not-satisfied. Both parent TMPDIRs were empty after completion.

Both pinned `node --version` commands, both scorer/test `node --check`
commands on each runtime, and credential-free `npm run validate` on each
runtime returned actual exit 0. Source/test bytes were held across both focused
runs: scorer SHA256
`f278258dbace470cd02c492cdced26b1bea666ad858eb4b86d3fa3e8380890f5`;
test SHA256
`2d635cebf2e1767bc9e87059eb231317be6c14eae93ea821c2cb23172c6f1e2f`.
No unrelated broad matrices were repeated. The full algorithm count is
prospectively202 (accepted BR183 plus SC19), not a claimed author full-suite
result. Primary owns new fixed-candidate acceptance, both independent review
axes and exact-head CI.

The final correction audit compares Git's changed paths with an independent
recursive filesystem/blob/mode route against a9ec8aa, count4, and verifies
append-only plan/limitations, the original contract prefix, unchanged judging
and inherited source, unstaged status and owned cleanup. Exact audit/hashes are
retained outside the worktree for STOP handoff. This is offline consistency
evidence, not semantic efficacy, measured lightweight fit, D12/Stage2/3
clearance, external execution/firstness proof or live spending authority.


## C2 final prospective correction contract (verbatim)

# SC correction C2 — planner failure/global-stop symmetry

Prospective primary correction contract, 2026-10-12. Fixed candidate
`a9b3d887dc7cc20e678c493f9b5f89465d62aab9`, original full review base
`6abed0ccdfe3815d42b25db04adb159483ded156`. No paid execution occurred.

## Finding and causal hypotheses

C1 fixed ordinary failure consistency and outcome-independent planner token
limits. Independent Spec review found that a failed/unknown planner final
without numeric overflow still lacks the same known-fatal/global-stop check.
The extracted actual validator admits a known-fatal planner cause in an
accounted result. This probe establishes the helper gap only, not the full
public retained-input path.

Ranked hypotheses: (1) the fatal check is nested under numeric overflow, so
non-overflow failed/unknown planners escape it; (2) later retained validation
may already reject the same record. Establish which is true with a genuine
retained public-seam red before fixing source. A synthetic corruption control
must be labelled corruption, not claimed to have been executed by the runtime.

## Bounded assignment

One existing GPT-6.1 Sol/high author, same scoring worktree and branch. Only
`evaluation/algorithm-development/source-bundle-scoring.mjs`, its existing test,
and append-only notes in `docs/plans/source-bundle-scoring.md` and
`docs/limitations.md`. Preserve original full contract and all prior evidence.
Do not modify judging, corpus/rubric, runner/transport, schemas, thresholds,
budgets/caps, dependencies/CI, product defaults or private operator. No key,
operational ledger/configuration, provider, closed cohort, commit or push.

## Observable acceptance

- A known globally fatal planner failureCode cannot coexist with an accounted
  run, for failed or unknown outcomes, whether or not any token count is known.
- A succeeded planner final still requires null failureCode. A failed/unknown
  final requires a recognized non-null code from the existing frozen QT error
  taxonomy; null, empty, unknown and non-scalar unsuccessful causes are not
  honest observations. Preserve the accepted coordinator normalization,
  including `request_mutated -> rank_mismatch`, before fatality checking.
  This validates existing closed causes; it does not invent runtime causes.
- Healthy consumed planner failure/unknown observations remain accepted;
  genuine stopped observations remain retained without claiming advancement.
  Do not classify all provider errors as globally fatal.
- Preserve the coordinator's existing healthy per-call timeout normalization
  (runner389-400). A raw QT cancelled/deadline_exceeded may normalize to
  model_timeout only using the retained closed plannerFailure witness: matching
  rawCode, normalizedCode=model_timeout, normalization label, consumed health
  with null fatalCode, callerAborted=false and absoluteDeadlineLive=true. Bind
  the phase's settled final and rankFailure/slot failure to that same cause;
  do not trust a free-standing label. Absolute timing/caller provenance remain
  externally attested, as in the original contract. An actual single 30s core
  timeout in the same synthetic fixture is permitted and required to prevent
  over-rejection; no runtime deadline/cap change. Missing or contradictory
  normalization evidence cannot excuse an accounted fatal final. Do not demand
  this exception witness for ordinary nonfatal provider errors or stopped runs.
- Reach public prepare/score with an actual fresh synthetic runtime fixture.
  Prefer a small-output healthy-failure campaign or reuse a suitable fixture;
  do not expand or rewrite the existing 192-intent fixture merely for this.
  Hold all24 cases / 48QA / 24probe denominators fixed. Mutate only relevant
  final cause fields for corruption controls, preserving other evidence.
- Capture red before scorer edits, then the same assertions green. Preserve
  existing C1 stopped-overflow, healthy ordinary failure and successful cases.
  This changes assessment consistency, not algorithm, scorer policy or efficacy.
- Same-path completeness check: the accepted ordinary transport130-195 sets a
  nonempty failure string for every unsuccessful final. Reuse this same new
  fixture's actual ordinary503 observation to test null/empty-cause corruption
  through the public seam. If accepted, require a nonempty string on ordinary
  unsuccessful finals too; do not invent a closed ordinary-code taxonomy or
  change its accepted healthy normalization. If later validation already denies,
  retain that control without unnecessary source changes. No extra preparation.

## Verification

Run owned focused tests sequentially on pinned Node22.16 and24.15, syntax and
root validation; record actual exits, no skips/cancellations/residue, exact
hashes and four-path inventory through two independent routes. Do not rerun
unrelated matrices. STOP WRITES before primary verifies. Primary will rerun
affected gates, commit only scoped paths, and obtain both independent full5
fixed-base reviews before any push. Old full matrices retain old-head labels;
exact-head remote CI remains mandatory before live preparation.

## C2 author implementation and retained evidence

This append preserves all previous plan evidence and the original 21,844-byte
contract. The final prospective C2 contract above is 5,138 bytes, SHA256
`3133973182d5c591cce200f0a99ad8f539b1d1d3f8072c613e198d9f003beaf1`.
Earlier C2 hashes were superseded prospectively before the source correction:
the release clarified the accepted 23-code taxonomy, the next amendment
preserved the actual healthy local-timeout normalization, and the final
amendment added ordinary unsuccessful null/empty-cause checks. None changed
the corpus, score policy, thresholds, runtime, budgets or deadline caps.

The correction remains on experiment/source-bundle-scoring at rejected
candidate a9b3d887dc7cc20e678c493f9b5f89465d62aab9; full review base remains
6abed0ccdfe3815d42b25db04adb159483ded156. The same GPT-6.1 Sol/high author owns
only scorer, its test and append-only plan/limitations. Judging, inherited
sources and private operator are unchanged. No commit, staging, provider,
credential, operational ledger/configuration or closed-cohort access occurred.

### Public-seam diagnosis and minimal correction

One fresh genuine all24 preparation/run uses the unchanged real coordinator,
ordinary/QT transports and an owned initialized synthetic schema2 ledger.
The fixed fake-HTTP policy examines only the format name and predeclared
planner-count ordinal, never question, rubric, family, anchors or gold.
Ordinary counts return HTTP503. The first planner count never responds and
reaches the actual unchanged 30s local timeout; subsequent even planner counts
return HTTP503 and odd counts throw a synthetic error. No generation or answer
dispatch occurs. The original 192-intent padded fixture is unchanged.

The actual report is accounted with 72 intents, 72 settled healthy closed
owners, 48 consumed failed QA slots, 24 consumed failed probes and zero first
answers. All24 planner finals retain null token counts and persisted
settlement: 12 failed and 12 unknown, including the first raw cancelled timeout.
Reserved amount is 360,000 microUSD; all72 intents have unknown usage and the
same full reservation, with zero missing final records. Persisted result
equals returned result. Public preparation is ready and scoring assessed,
resource compliance satisfied and promising false. All48 answers are excluded;
the two honest judge packets contain zero items.

The timeout's actual plannerFailure records rawCode=cancelled,
normalizedCode=model_timeout, normalization=healthy-settled-per-call-timeout,
health={state:consumed,fatalCode:null}, callerAborted=false and
absoluteDeadlineLive=true. Actual rankFailure and slot failure are model_timeout.
These observations prevent blanket rejection of honest healthy timeout or
provider outcomes. Absolute timing and caller provenance remain externally
attested, not independently measured by the pure scorer.

Before modifying the scorer, retained-only corruption controls reached both
public prepare and score. One-field failureCode controls target an actual
failed and an actual unknown planner final: authentication_failed,
redirect_rejected, request_mutated, null, empty, invented code and object.
Eleven controls remove or contradict the timeout witness, its closed keyset,
health, normalized/raw codes, label, caller/deadline flags, rankFailure or
slot failure. Two more change an actual ordinary503 failure to null or empty.
These 27 controls are deliberately corrupted data, not claimed executions.

The first red had 25 wrongly ready/assessed controls. The final prospective
ordinary completeness addition produced a second red with all27 wrongly
ready/assessed controls, while the genuine healthy report stayed ready/assessed.
This confirms the missing outcome-independent fatal check and refutes the
hypothesis that later public validation already rescued these records.

The minimal source correction checks unsuccessful planner causes against the
literal existing 23-code QT taxonomy, projects request_mutated to rank_mismatch,
and checks known fatality independently of numeric overflow. Accounted raw
cancelled/deadline_exceeded is excused only by the exact closed, phase-bound
settled healthy-timeout witness plus matching rankFailure and slot failure.
Genuine stopped observations are not forced through this accounted exception.
Ordinary unsuccessful causes require a nonempty string without a new closed
ordinary taxonomy. Succeeded causes remain null. Existing C1 overflow checks,
healthy provider outcomes and all frozen gates remain unchanged.

### Commands, exits and immutable logs

All evidence is retained under
`/tmp/cairn-scoring-c2-author.Zw8Q4IDg`; red logs were not overwritten.

The focused command used credential-free `env -i`, version-specific PATH
before /usr/bin:/bin, owned TMPDIR, NODE_DISABLE_COMPILE_CACHE=1 and both
CAIRN_SOURCE_BUNDLE_OFFLINE=1 / CAIRN_BUNDLE_TRANSPORT_OFFLINE=1, then the pinned
Node executable, `tools/testing/run.mjs` and
`evaluation/algorithm-development/test/source-bundle-scoring.test.mjs`.
The red commands additionally used
`--test-name-pattern=actual healthy planner failed/unknown counts`.

| Observation | Actual exit | Tests | Log / SHA256 |
| --- | --- | --- | --- |
| Node22 first public red, original scorer | 1 | 0/1; 25 wrong admissions | red22.log / 9cf397ac803e251c581c052c913d5bf852fab423b05a7bd6c34544ce7d9946f6 |
| Node22 second public red, original scorer | 1 | 0/1; 27 wrong admissions | red22-ordinary.log / d037c8f557e4276db6cbc446786ceda78f4e48e7e664bdbabd493c2507e31c5c |
| Node22.16.0 full focused final bytes | 0 | 20/20 | focused22.log / 8c72e38fead9a952fea2d4ea662c8117681a9c7f9b29d2897b94b52a0b376a4a |
| Node24.15.0 full focused same bytes | 0 | 20/20 | focused24.log / 6bf3c61ad83c090c6b5dd04033789b9c8ac969b1da094837de0ece82cc3a15a9 |

Both full focused suites have zero failed, skipped or cancelled tests and owned
cleanup. Durations are 204,861.202565ms / 263,551.154925ms; the C2 subtest took
81,404.909533ms / 138,973.302599ms under its unchanged180s cap. All27 corruption
controls deny through both public exports, while the genuine72-intent report
remains ready/assessed. The original actual192-intent/120-owner/47-answer
fixture, all67 anchor checks, C1 stopped overflow and genuine pre-aborted run
remain green. Scripted labels establish consistency/arithmetic, not quality.

Version checks and `node --check` for scorer and test each exit0 on both
pinned Nodes (six commands). The first Node22 npm invocation exits1 before
validation because setting user and global npm configs to the same /dev/null
causes npm's double-loading-config rejection. Its `validate-22.16.0.log` is
retained as setup failure, not scorer/test/validator failure. The corrected
credential-free commands use NPM_CONFIG_USERCONFIG=/dev/null and a distinct
owned `empty-global.npmrc` containing only a comment; `npm run validate`
then exits0 on both Nodes, recorded in `validate-22.16.0-corrected.log` and
`validate-24.15.0-corrected.log`. No ambient operational config was needed.

Final source-held hashes during both focused runs:
scorer `825e5b8366fd2e8bb5e3ad3af618deaa07e5e92938b01446a20cb316e8fec458`;
test `19327aa7c692e699d681ee115adb4d8354d066c99e21f12527bfe20293b294cf`.
Both reds used original scorer
`f278258dbace470cd02c492cdced26b1bea666ad858eb4b86d3fa3e8380890f5`.
No unsuccessful source-fix round occurred; the second red added the prospective
ordinary control before the single source correction.

The final audit derives exactly four paths independently by Git and recursive
filesystem/blob/mode comparison against a9b3d887, checks preserved plan and
limitations prefixes, the original contract, verbatim final C2 contract,
unchanged judging/inherited sources, unstaged status and empty owned TMPDIRs.
Exact audit and final document hashes are retained outside the worktree for
STOP handoff. All owned test children have settled; no runtime writes occur
after STOP. No unrelated broad matrix was repeated. Full algorithm203
(accepted BR183 plus SC20) is a prospective primary/CI expectation, not an
author full-suite result. Prior broad matrices retain their old-head labels.

Primary owns fixed-byte acceptance, both full-five-path independent reviews
and exact-head CI before live preparation. This packet establishes offline
retained-record consistency only: no semantic efficacy, measured lightweight
fit, independent execution/firstness, D12/Stage2/3 clearance or spending
authority is claimed.


## C3 prospective primary takeover contract (verbatim)

# SC correction C3 — settlement observation consistency

Prospective primary contract, 2026-10-12. Rejected candidate
82b87d7efe9da76bd4517e88bb5d6014a2960e1b; unchanged full review base
6abed0ccdfe3815d42b25db04adb159483ded156. No push or paid execution.

## Narrow ownership escalation

After two author correction rounds left another observable accounted-record
consistency gap, primary takes over only this field-level integration correction
under shared routing. Do not repeat the author assignment. The two nonauthor
reviewers remain independent. Allowed four files: existing scorer, existing
scoring test, append-only tracked scoring plan and limitations. Preserve all
original contracts/evidence, judging, actual runtime, corpus, rubric, policy,
thresholds, deadlines, limits, dependencies, CI and private operator.

## Diagnosis and acceptance

Primary's fast actual-extracted-validator loop ran twice, actual exit1 each:
ten failed/unknown provider_failed flags (false/null/string/zero/object) were
wrongly accepted. A true flag passed; stopped ledger-failure shapes remained
representable. This is helper evidence only, not a public/runtime execution.

Ranked hypotheses, disclosed before full public test:

1. Checks apply only to success and timeout, allowing other unsuccessful flags
   to contradict confirmed healthy settlement. Cause-preserving flag changes
   on genuine public retained input will remain ready/assessed.
2. Later retained validation already reconciles the flag; the same public
   mutations will instead be denied without a scorer change.
3. False could be a legitimate healthy-failure observation. Existing actual QT
   transport and its settlement-failure regression must distinguish that case:
   its flag is boolean, and false accompanies ledger_failed, not provider_failed.

Use the existing genuine C2 all24/72-intent fixture, unchanged HTTP schedule,
30s timeout and denominators. Add only cause-preserving settlement flag controls
for one failed and one unknown provider_failed final. Capture public red before
scorer edits. Preserve the genuine true-flag positive and all27 C2 controls;
do not create another campaign or change the original192 fixture.

The correction must validate the flag's boolean type and reconcile false with
the accepted transport's ledger_failed/stopped semantics. Accounted planner
finals require confirmed settlement. Healthy transition deltas may not claim
settlement for a planner final marked false. Preserve representable honest
stopped ledger failures; do not reinterpret them as successful settlement.
This is observable consistency, not reconstruction of missing history or proof
of source truth/execution. No new score policy or universal efficacy claim.

## Verification and delivery

Run same fast controls after correction. Keep a genuine QT settlement-write
failure regression as evidence of flag semantics; use its existing offline
test, not an operational ledger. Full focused20 on pinned22.16/24.15, syntax,
root validation, owned cleanup and actual exit codes remain required. Primary
owns implementation and verification; do not count self-review as either
independent axis. Append the contract and raw outcomes before freezing full
source snapshots. Two-route four-correction/five-full-path inventories and
exact committed content required. Old broader matrices retain old-head labels.
Both full five-path fixed-base reviews must pass on the new commit, then exact
remote CI before first live preparation. No source/score edit, rejudge or retry
after a live result. No closed-cohort, credential or operational data access
in this correction. Temporary debug probes stay explicitly private diagnostic
artifacts, never product code.

## C3 diagnosis and source freeze

Primary directly owns this narrow correction under the routing escalation after
C1/C2 left another observable accounted-record consistency gap. The independent
Standards and Spec reviewers did not implement it. C2's cause/timeout finding
was closed; candidate82b87d7 was rejected for the newly reproduced settlement
flag gap. No push, provider call or closed-cohort access occurred.

The C3 contract SHA256 is
`8d6824ac6c94ea4a66858e7adb6bf216360eebfc101aad89b2ee44d6de07b18d`.
Only four existing paths change; original contracts, judging, runner, corpus,
rubric, thresholds, budgets, deadlines, dependency/CI and operator stay fixed.

The actual extracted-validator fast loop ran twice with actual exit1: all10
cause-preserving failed/unknown false/null/string/zero/object flag controls
were wrongly admitted. True-flag positives and two stopped-ledger-failure
helper shapes were accepted. Those are synthetic helper observations, not
claims of actual failed storage execution.

The existing genuine C2 all24 fixture then ran through public prepare/score
before source edits. Test command on Node22.16.0:
`node tools/testing/run.mjs --test-name-pattern='actual healthy planner failed/unknown counts' evaluation/algorithm-development/test/source-bundle-scoring.test.mjs`.
Actual exit1, 0/1, zero skips/cancellations/residue. Its real72-intent/72-owner
healthy result stayed ready/assessed; the previous27 controls correctly denied,
but all10 new settlement-only controls remained ready/assessed. This supports
hypothesis1 and rejects the proposed downstream rescue in hypothesis2. Original
scorer hash825e5b8366fd2e8bb5e3ad3af618deaa07e5e92938b01446a20cb316e8fec458
was unchanged through that red. No additional campaign or paid data was used.

Evidence remains in `/tmp/cairn-scoring-c3-primary.g0rcTW0X`. Original red.log
SHA2564f9d45740b8837ecb364b02caeed703a12a73a64f9fc4c05107e6c948c417779;
its test duration82,726.315823ms. The diagnostic wrapper also exited1 after
recording that result because it omitted Node TAP diagnostic backslash decoding.
A separate read-only `inspect-red.mjs` decoded the same immutable log, verified
its hash and all37 observations, and exited0. The red was not rerun or relabelled.

To check hypothesis3 against real transport behavior, the unchanged existing
`node tools/testing/run.mjs evaluation/architecture/test/source-bundle-plan-rank-transport.test.mjs`
passed64/64 on Node22.16.0, actual exit0, zero skips/cancellations/residue.
Its actual synthetic SQLite settlement-write failure retains false, fatal
ledger_failed and a pending reservation, confirming that false is not a healthy
provider-failure observation. Transport log SHA256
1974fe0466d5b4887cb1f6f7c8355efb1ce41ca91b92bd13c6e567cd4ec8e573.

The source fix validates the boolean, allows false only with ledger_failed and
stopped status, and disallows a healthy appended ledger delta for a false
planner flag. It does not turn stopped failures into settled success. Existing
success and healthy-timeout checks are unchanged. C1/C2/C3 fast helper probes
all exit0 on Node22.16/24.15 after the fix, including the stopped helper shapes.

At this documented freeze, full focused20 and the remaining fixed-byte primary
gates are next, not yet claimed passed. Source hashes:
scorer8ac47c8834944c5f8eec6612fcd50da40eed97e3ee6d4d17d73512fae29e01df;
test9cf91336a498d7c682a63d5c1cfcf02280bbc6c998b18a577e4e81220c37f87c.
The final PR records the completed command outcomes, exact candidate and both
independent full-base review results. Previous candidate proofs retain their
old-head identities. This diagnosis establishes retained consistency only,
not algorithm quality, D12/Stage2/3 clearance or first-live authority.

# SC-C4 — reconcile probe progress with retained observations

Prospective correction to original SC/SJ1/SJ2; not a new scoring policy.
Fixed full-PR base: 6abed0ccdfe3815d42b25db04adb159483ded156.
Rejected prior candidate: c2a24f71c425c93dc69b6e5369dbf0e7e7ca54f2.
Worktree: /home/chichieh/Github/cairn-memory-worktrees/source-bundle-scoring.
Branch: experiment/source-bundle-scoring. No push, merge or provider call yet.

## Ownership and scope

This is a distinct probe-artifact consistency finding after C3 settlement was
closed. Return bounded implementation to the original GPT-6.1 Sol/high worker;
primary owns acceptance, not another undifferentiated ledger correction round.
Only source-bundle-scoring.mjs and its test plus append-only entries in the
existing docs/plans/source-bundle-scoring.md and docs/limitations.md may change.
No runner, transport, corpus, rubric, model, resource, schema, source selection,
answering, judgment or gate-policy change. No new evaluation campaign or paid
calls. Keep original 21,844-byte contract, C1/C2/C3 contracts, old evidence and
failure history intact. Original sources/anchors and actual first answers stay
unchanged; integrity mutations are explicit corruptions, never claimed executions.

## Ranked hypotheses, already disclosed to the user

1. Optional-only artifact checks permit completed execution with missing reached
   stages; the extracted real validator admits it. Explicit progress binding
   should deny those corruptions without changing real completed probes.
2. A later public validator already rejects it; mutate only probe artifacts in
   the existing genuine 192-intent fixture to test that claim before fixing.
3. Missing observations may be legitimate on failed/not-run paths. Inspect the
   pinned coordinator and core, and preserve actual early-failure/empty-selection
   semantics rather than indiscriminately requiring every stage for every slot.

Primary source-only diagnostic source-bundle-scoring-c4-probe.mjs ran twice on
the unchanged scorer hash 8ac47c8834944c5f8eec6612fcd50da40eed97e3ee6d4d17d73512fae29e01df;
both actual exits 1, completed probe artifacts={} admitted as four not-reached
stages. It uses a placeholder intent and is not complete public-pipeline proof.

## Observable acceptance

C4.1 The genuine completed 192-intent fixture remains ready/assessed under
unchanged labels and source/answer data. Preserve its actual 24 completed probes,
47 answers and uncertainty/harm/completeness controls. Before changing scorer,
use this fixture to show omission/contradiction corruption is accepted.

C4.2 Replacing a completed probe's artifacts with {}, or omitting its reached
select request/output/recall/call observations, must deny assessment. Cross-check
stage presence with execution, failure, call counts and slot intents; no completed
probe can silently become four not-reached observations. Validate exact retained
request/output bindings and recorded store snapshots where runtime provides them.
Do not stop at checking that artifacts is merely nonempty.

C4.3 Rank observation is conditional on actual rank invocation, not on desired
evidence. Rank count/request/selected references/returned recall must be mutually
consistent with the pinned runner's actual local empty-rank callback. Preserve
empty valid selection and any legitimate no-rank return; do not promote missing
evidence to a completed or selected stage. Contradictory omission and fabricated
progress controls must deny through the public prepare and score seams.

C4.4 Preserve genuine accounted failed probes and stopped/not-run controls in
existing tests. A raw successful HTTP outcome is not proof of semantically valid
selection: preserve invalid-model-output and timeout paths. Trace actual runner
450–490 and dependent core paths before determining which artifacts are required
at which reached stage; document boundaries, not a new state-machine policy.

C4.5 Use named corruption controls sufficient to cover each implemented branch
and regression risk. Test before fix, then green with positive and failure
controls. Two supported Nodes: version, syntax, complete focused scorer suite,
validate, actual exit codes, no skipped/cancelled tests or unexpected owned
temporary residue. Keep required transport/tokenizer tests enabled. No live env.

C4.6 Worker reports exact files/hashes and stops writes. Primary inspects full
diff, personally reruns affected paths, independently cross-checks file inventory
twice, commits scope, checks current gates, and obtains both nonauthor full-diff
Standards/Spec reviews against the original base. Prior candidate proof is stale
for new bytes. Push/PR and exact-head CI only after both axes pass.

## Nonclaims

This closes observable retained-record inconsistency, not transcript authenticity,
model quality or correct source meaning. No accuracy number, Mem0 parity, natural
long-history success, lightweight claim, D12/Stage2/Stage3 or launch is established.
Primary C3 takeover remains historical; this packet's worker must not review it.

## Prospective offline control addendum, before scorer implementation

The unchanged 192-intent fixture has only nonempty successful probes; the C2
fixture has only count-stage failures. Neither proves the empty/invalid-selection
boundary. Primary authorizes one additional genuinely executed owned offline
fixture using the same all24 cold preparation, corpus and runner, fake HTTP only.
Use a predeclared ordinal schedule: first probe returns refs=[], second returns
the duplicate first actually visible ref in a valid successful HTTP envelope.
Stop through the existing caller signal at the first QA pre-record of BQ03, only
after both earlier probes have returned and their owners closed. The callback
must synchronously return undefined. Preserve any actually reached stop intent;
never synthesize or remove records to obtain an expected count.

Assert first probe completed with zero rank calls and empty recall; second probe
failed invalid_model_output with its literal duplicated selection, no rank call,
error recall and healthy closed owner. Later not-run slots retain the stop cause
and fixed 48 QA / 24 probe denominator. No other fatal outcome may masquerade as
this intended signal stop. The public prepare/score must assess those actual
retained observations (not promote the stopped run to promising). Add named
contradictions for these conditional branches. Existing192 and C2 fixtures remain
unchanged. This is synthetic offline regression data, not an additional live
campaign, new question cohort, retry, runtime change or spending authority.

### Timeout boundary extension before final freeze

Primary integration inspection identified a falsifiable C4.4 timeout risk:
core's ordinary select deadline aborts at 30 seconds; the adapter may throw an
AbortError recorded as selectFailure.provider_failed, while core returns
recall.error.model_timeout and the runner records probe.failure.model_timeout.
The ordinary transport can be healthy, closed and settled despite those distinct
layers. Do not require unconditional equality of those recorded causes.

Extend only the new conditional offline fixture with a third probe whose select
generation stays pending until the unchanged core timeout. Move the prospective
caller-stop point from BQ03 to BQ04 first QA pre-record, after all three probe
owners have closed. Keep the first two cases and the original192/C2 fixtures
unchanged. First demonstrate the actual retained positive state and public denial
on the candidate validator. Then, if confirmed, allow only the actual normalized
timeout shape bound to core error, raw timeout observation, and closed healthy
settlement; contradictory witness/cause controls must still deny. Retain actual
stop records and fixed denominators. No timer shortening, transport/runner fix,
blanket failure-code relaxation, paid request or resumed cohort is authorized.

### Precise accounted-timeout reproducer

Before running the extension, the worker correctly noted that the questioned
equality is conditional on result.status=accounted. A deliberate BQ04 caller stop
cannot reproduce that branch. Supersede only the extension's stop schedule:
execute the same single new all24 offline fixture to accounted closure. Keep
first empty selection, second duplicated selection, third actual 30-second
timeout. For every case after the third, use predeclared case ordinals from the
runner's onRecord metadata to return short HTTP503 on each first count request;
no question, answer, source family or rubric controls the schedule. Do not change
timer lengths or falsify result.status/history. These later slots must be honest
failed slots with healthy closed owners, not not-run slots. The older genuine
pre-aborted/stopped fixtures continue to cover not-run preservation.

Establish the actual accounted positive state, expected three early probe
outcomes, recorded normalization and full closed ledger before asserting public
readiness. On the intermediate validator the public readiness assertion must go
red if the hypothesis is correct. Then add only the bounded timeout consistency
exception supported by this genuine record and named witness contradictions.
Keep both earlier red logs and their stopped17/11 positive evidence labelled as
earlier controls, not the final accounted fixture. All other scope and gates
remain unchanged. This refinement corrects the test seam before running it; it
does not replace a paid question, retry a campaign or hide a failed test.

## SC-C4 author evidence and fixed-byte handoff

Author: actual GPT-6.1 Sol/high, sole implementer; primary owns acceptance and
nonauthor reviews. Correction base c2a24f71c425c93dc69b6e5369dbf0e7e7ca54f2;
full review base 6abed0ccdfe3815d42b25db04adb159483ded156. This appendix
preserves all original and C1/C2/C3 evidence. The final prospective C4 contract
above is 9,537 bytes, SHA256
9b46d72e4677ed53cb75da6a37d5340148eb1f4d006ba3a5c4b27fb4fdfd2216.
Earlier addendum hashes d63edc8c and 09b71607 were superseded before the final
accounted-timeout reproducer; their stopped-control logs remain historical.

The work used the shared worktree workflow and narrow diagnosing-bugs loop:
ranked hypotheses, public retained-seam red, pinned runner/core inspection,
minimal progress-binding fix and genuine conditional-path regression. No
inherited runtime, transport, ledger, source, rubric, schema, scoring threshold,
request/deadline cap, judgment or first-answer policy changed. No operational
script, credential, provider, operational ledger or closed cohort was accessed.
All HTTP and ledger execution used owned offline fixtures.

### Actual red and intermediate history

Evidence root: /tmp/cairn-scoring-c4-author.d7Z8Bn2t. Logs are separate,
never replaced by green outcomes.

- red22.log: Node22 actual exit1, 29 of 35 named probe corruptions wrongly
  ready/assessed through both public exports; the other six already denied.
  The unchanged genuine padded192 fixture remained ready, with192 intents,
 120 owners,47 actual answers and24 completed probes. Scorer stayed at
  rejected-base hash8ac47c88. Log SHA256
  3447b88b5b832a225c6f52b68c14bfef058186c875d514bdc20ad47b5334eedc.
  This confirms missing progress binding and refutes later-public-validator rescue.
- conditional-red22.log: actual exit1. The prospectively authorized earlier
  stopped conditional fixture genuinely retained17 intents/11 owners, empty
  selection and successful HTTP with duplicated visible refs, then caller stop.
  Its actual record stayed ready/assessed; nine of ten contradictions were
  wrongly admitted. Log SHA256
  fabedd2ef17304750b06de44300cda53486a5358c7b8c8784b77f443a7df1fec.
  It does not establish the later accounted timeout branch.
- conditional-green22.log: actual exit0,1/1 on that historical stopped variant.
  focused22.log: actual exit0,22/22 on the intermediate C4 implementation
  before the timeout refinement. These are explicitly not final-byte proofs.
- timeout-red22.log: actual exit1 on the prospectively amended accounted
  fixture. Genuine87 intents/78 healthy closed owners were asserted before
  public readiness: port selectFailure.provider_failed, core/slot model_timeout,
  dispatched raw model_timeout/unknown and matching settled unknown ledger
  delta. Both public exports denied probe_mismatch. Log SHA256
  54fe98198f18e8cc0338a9a0d480747df1b4d043341792df52ed2295ba007a27.
  This is a reproduced over-rejection in the initial C4 equality, not an
  inherited runtime bug.
- timeout-green22.log: actual exit0,1/1 after the narrowly bound exception.
  This targeted green preceded the final five named witness tests.

An early untested draft was restored byte-for-byte to the rejected scorer before
the conditional red. A patch-construction boundary assertion failed before
writing and was corrected; neither is claimed as executed model/test evidence.
No timeout or fixture tolerance was increased, and no source was edited during
an active invocation.

### Implemented observable consistency

Completed probes now bind reached snapshots, request/output, call counters,
recall and actual slot intents instead of silently reporting omitted artifacts
as not reached. Not-run probes require no artifacts/intents and the run stop
cause; consumed failed paths remain conditional. Requests bind the literal
original query, namespace map, selected-order candidates and fixed limits.
Rank invocation requires valid nonempty selection and its exact retained request;
successful local recall binds the runner's actual empty-rank result.

A successful HTTP generation may still contain invalid refs. Such literal output
is retained, while mechanically selected evidence is observed-empty, not granted
support credit. Invalid refs require actual core invalid_model_output and no rank;
a different slot cause is admitted only for the exact known fatal global-stop
override. Valid empty selection remains completed, rank not reached and recall
observed-empty. Neither probe outcome can improve QA scoring.

The accounted ordinary timeout exception is only the genuine layer split above:
provider_failed at the port, model_timeout at core/slot, dispatched raw
model_timeout with unknown outcome, and exact healthy closed owner plus matching
settled ledger delta. Wrong raw/core/port/slot cause, missing/unhealthy/unclosed
owner and unwitnessed stopped overrides deny. It does not accept arbitrary cause
differences or reconstruct independent timing/firstness from this transcript.

The existing192 fixture's source-blind chronology policy, padded bodies,47
answers and all67 anchors remain unchanged. Its new nested test covers35 named
artifact/call/request/output/recall contradictions through both public exports.
The one new actual conditional fixture uses first empty selection, second
duplicate actually visible ref, third unchanged30-second select timeout, and
short HTTP503 first counts for later case ordinals. It genuinely closes
accounted87/78, retaining all48 QA/all24 probe slots; later slots are healthy
consumed failures, not invented not-run observations. Exact first-three probe
owner identities/counts are asserted before closed/healthy predicates.
Its16 conditional corruption controls and five raw/closure/override controls
all deny. Old genuine pre-aborted/stopped and C1/C2/C3 controls still cover
their original paths. No synthetic label is model-quality evidence.

### Final author commands and actual outcomes

Final held scorer SHA256
fd1930979300e109b36ebbbee8a81e192d9b71141169edc8d133c63f964958ea;
test SHA256
2bfaa58beb88d44785e3faf307a98ff88e13b12f5555cedae7bee84b5d4cc07e.
Both final full focused commands used tools/testing/run.mjs with the literal
evaluation/algorithm-development/test/source-bundle-scoring.test.mjs path,
pinned Node22.16.0 then24.15.0, env-i, owned TMPDIR,
NODE_DISABLE_COMPILE_CACHE=1, CAIRN_SOURCE_BUNDLE_OFFLINE=1 and
CAIRN_BUNDLE_TRANSPORT_OFFLINE=1. No concurrent heavy suite ran.

- focused22-final.log: actual exit0,22/22, zero failures/skips/cancellations,
 279803.205189ms; SHA256
  d93b18f2d0b96b7d39b79fed0a6a3a4db343512997d74a93fa92b1b77e74bb84.
- focused24-final.log: actual exit0,22/22, zero failures/skips/cancellations,
 333830.595992ms; SHA256
  ab6b100357a66fdee542ef16a6c06b4c259a67ec7ae6ef60de6d6510a1c86f8d.
- Both pinned node --version, node --check scorer, node --check test and
  npm run validate: each actual exit0. Separate version22/24,
  scorer-syntax22/24, test-syntax22/24 and validate22/24 logs are retained.
  Validation uses userconfig=/dev/null and a distinct owned comment-only
  global npm config, avoiding ambient configuration and the historical C2
  duplicate-config setup failure; no install/network is involved.
- git diff --check and independent four-path inventory are closing author
  checks. Inventory cross-checks Git changes against recursively hashed
  filesystem blobs/modes, append-only docs, both immutable contract prefixes,
  unchanged inherited sources and empty owned workspace directories.

All test sessions closed and all seven owned TMPDIRs were empty after the final
runs. The primary separately verifies frozen bytes before committing, runs its
affected gates on both Nodes, and obtains both full-base nonauthor review axes
and exact-head CI. Expected combined algorithm count205 (=BR183+SC22) is a
prospective inventory expectation, not an author full-algorithm pass claim.
Old broader matrices remain pinned to old heads.

This correction establishes observable retained consistency only. Transcript
authenticity, caller/clock/firstness and fixed-runtime timing enforcement remain
external execution provenance. No semantic efficacy, Mem0 parity, natural
long-history success, measured lightweight fit, D12/Stage2/3 clearance, launch
authority or paid spending approval follows.

# SC-C5 — bind failed-probe causes across accounted and stopped runs

Prospective correction, frozen before author implementation or public controls.
Original full-review base: 6abed0ccdfe3815d42b25db04adb159483ded156.
Rejected candidate/correction base: fb8407a2c7c95bbb8478f38ccf44dc5fc33a27d4.
Worktree: /home/chichieh/Github/cairn-memory-worktrees/source-bundle-scoring.
Branch: experiment/source-bundle-scoring. No push or paid invocation has occurred.

## Ownership and scope

One bounded original GPT-6.1 Sol/high author handles this follow-up to C4.
C4 closed completed-probe omissions but its first failed-probe consistency
implementation did not fully bind stopped causes and core envelopes. This is
one coherent correction, not separate rounds for each error string. Root owns
planning, actual-diff inspection and independent acceptance. If this correction
again fails the same binding requirement, use the routing escalation rule.

Only source-bundle-scoring.mjs, its existing test, and append-only additions to
docs/plans/source-bundle-scoring.md and docs/limitations.md may change. Preserve
all previous contracts, evidence and failure history, including the original
21,844-byte and final C4 9,537-byte contracts. No judging helper, runner, adapter,
core, corpus, rubric, model, schema, resource limit, deadline, scoring gate,
first-answer/judgment policy, product default, dependency or closed cohort edits.
No operational configuration, key or ledger access, provider call, push, merge,
release or deployment. Offline fixtures use the existing owned test runner.
Do not add an optional test-helper refactor merely to resolve a nonblocking smell.

## Reproduced problem and ranked hypotheses

Spec review identified one P2 against original SJ1/SJ2: inconsistent failed-probe
records can still be assessed. The completed-probe omission finding is closed.
Primary ran source-bundle-scoring-c5-probe.mjs twice at scorer SHA256
fd1930979300e109b36ebbbee8a81e192d9b71141169edc8d133c63f964958ea;
both actual exits1 demonstrated the stopped port/slot check bypass in the real
extracted block. This shallow synthetic diagnostic is not a complete public
retained execution; its initial generic core error was not a proved runtime
positive. Use the actual generic-provider core cause recall_failed in the public
fixture. Preserve the original diagnostic evidence instead of calling it a
full-pipeline or legitimate stopped proof.

Ranked hypotheses disclosed before the next tests:

1. Accounted-only and equal-port/slot shortcuts skip observable cause binding.
   Actual retained corruptions will remain assessed until these shortcuts are
   replaced by consistent checks across both run statuses.
2. Some differences are legitimate layer normalization. Actual HTTP-successful
   invalid selection, local timeout and a later known fatal override must remain
   reportable; unconditional string equality would over-reject those controls.
3. An earlier complete validator already rejects the shallow mismatches. Test
   both public exports against genuine retained fixtures before source changes.

The consolidated review additionally demonstrated shallow admissions when port
and slot both change to invalid_model_output or an invented code against an
unchanged failed HTTP503 count, and when core cause/retryability is changed.
These are the same failed-probe binding requirement, not transcript authenticity.

## Observable acceptance

C5.1 Trace the pinned sourceBundleFailureCode projection, probe coordinator,
ordinary transport/adapter, core call/recall and contract failure envelope.
Write a concise layer table in the existing plan: observable raw failure/output,
port failure, core result, slot failure and allowed run/global-stop relationship.
Bind what the actual record establishes; do not invent missing exception types,
clock measurements or full transcript provenance.

C5.2 For accounted AND stopped records, a generic failed HTTP503 count retains
raw provider_failure, normalized port provider_failed and core recall_failed,
retryable=false. Slot cause follows the pinned coordinator unless an actual
known fatal global override applies. Changing only the port, changing port and
slot together, invented closed-projection codes, contradictory core causes or
retryability must deny through BOTH prepareSourceBundleScoring and
scoreSourceBundleComparison. Agreement between two labels is not sufficient
when they contradict the actual failed request.

C5.3 A stopped status is not a generic bypass. Preserve a known fatal slot
override only when it is consistent with the actual retained stop reason and
the underlying port/core/raw record; do not permit an unwitnessed nonfatal or
different-fatal substitute. The established local timeout layer split must
remain narrowly bound to the recorded core/raw outcome and healthy closed
settlement, in both accounted and honestly stopped controls. Successful HTTP
with parsed invalid refs is distinct from transport failure and remains valid
failed execution. Do not replace these normalizations with unconditional equality.

C5.4 Every retained failed core envelope obeys the existing contract:
retryable is true exactly for storage_busy, false otherwise. Reject impossible
error codes/relations where the reached stage and actual record establish the
cause, without requiring artifacts from a stage that legitimately was not reached.
Preserve the original successful, pre-aborted, stopped, C1/C2/C3 and C4 controls.

C5.5 Before changing source, use the existing C4 accounted fixture's genuine
later failed probe for named public cause/core-envelope corruptions. Keep its
87-intent/78-owner positive and original timeout/invalid/empty outcomes intact.
Add one new genuinely executed all24-cold offline stopped fixture below. Assert
its real preconditions and public baseline separately before mutations. Keep
all48 QA/all24 probe slots, including later honest not-run slots. No mutation
fixture may be described as an actually executed positive.

C5.6 Keep concise named mutations covering status, raw/port/core/slot cause,
closed projection, retryability and allowed override boundaries. Both public
exports deny contradictions; actual baseline records remain ready/assessed,
with promising=false for stopped or unsuccessful controls. No test-only scoring
exception, threshold relaxation, removed failure or model-quality claim.

C5.7 Run targeted public red first, narrow green, then complete focused suite,
version, source/test syntax and validate on Node22.16/24.15. Use key-free owned
workspaces, required dependencies, actual exit codes and no skipped/cancelled
required tests or unexpected residue. No tolerance/timer/cap increase. Record
red/intermediate/final hashes and exact content; do not edit during active tests.
Then STOP WRITES with four hashes and independent two-route inventory/count.
Primary repeats affected acceptance, scoped commit, current gate inspection and
both full fixed-base nonauthor review axes before push and exact-head CI.

## Prospective honest-stopped offline fixture

One new all24 cold preparation, the same runner/core/transports/corpus, fake HTTP
only; no hand-assembled positive result/status/history. Use predeclared case and
method ordinals from onRecord metadata, not question, source, rubric or answers.
All QA arms fail honestly at their first count with a short HTTP503 response.
Probe schedule:

1. BQ01: short HTTP503 count; normal provider failure, no generation or rank.
2. BQ02: valid count, then generation pending until the unchanged actual core
   30-second timeout. Require actual settled raw/core/port/slot evidence.
3. BQ03: valid count and HTTP-successful response containing duplicate first
   actually visible ref; semantic invalid_model_output, not transport failure.
4. BQ04: short HTTP503 count. Abort the existing caller controller only from
   onCheckpoint for BQ04_probe_select, after that real owner is closed healthy.
   This witnesses a later caller-cancel override of the otherwise ordinary
   failed probe. Callback must return undefined synchronously. Do not throw or
   rewrite observations. All later slots remain honest not-run/cancelled.

Require exact first-four probe owner identities/order, actual closed/healthy
settlement, literal returned/persisted equality, original fixed denominators,
and the actual override before public readiness. Expected physical counts are
a prediction to check, not permission to synthesize records. If the pinned
callback seam cannot produce these states, report the actual behavior before
changing the prospective schedule. No paid/cohort retry or new runtime API.

## Nonclaims

This is retained-observation consistency, not a new algorithm, semantic score,
whole-transcript authentication, official LongMemEval/Mem0 parity, natural
long-history success, measured lightweight fit, D12/Stage2/Stage3 or launch.
The purpose is to obtain a trustworthy first comparison; keep this correction
bounded and proceed to the already planned new experiment after delivery.

## SC-C5 author trace, public evidence and handoff

Sole author: actual assigned GPT-6.1 Sol/high; worktree workflow and narrow
diagnosing-bugs loop. Correction base fb8407a2c7c95bbb8478f38ccf44dc5fc33a27d4;
full-review base6abed0ccdfe3815d42b25db04adb159483ded156. Full C5 contract:
9,046 bytes/SHA2563e98a3d4389397c9a95a32d2c92e14589d643a1604202b38d762fe014a2ffc1a.
All earlier prefixes/evidence remain intact. No inherited runtime, judging,
corpus/rubric, policy, schema, caps, dependency, deadline or firstness change;
no operational data/config/key, provider, closed cohort, commit or push.
Author token/service cost remains unmeasured.

### Pinned layer trace and correction

Source truth: runner126–145/473–490, ordinary transport send and adapter post,
core model-call75–87/recall118–119/contract143–148, all at BR pin6abed0c.

| Actual observed path | Raw | Port / core | Slot relationship |
| --- | --- | --- | --- |
| HTTP503 count | failed provider_failure | provider_failed / recall_failed,false | provider_failed unless terminal known fatal override |
| Actual local30s select timeout | dispatched unknown model_timeout + settled delta | provider_failed / model_timeout,false | model_timeout unless terminal known fatal override |
| Parsed duplicated visible refs | successful HTTP200, literal selected output | no port failure / invalid_model_output,false | invalid_model_output, no rank |
| Final BQ04 closed-checkpoint abort after503 | unchanged provider_failure | unchanged provider_failed / recall_failed,false | cancelled; matching stop, later slots not-run |

The corrected scalar port uses the pinned closed projection. Observed failed
ordinary finals bind generic core recall_failed, except the narrow raw-timeout
shape with healthy closed owner and matching delta, in BOTH run statuses.
Core retryable is true exactly for storage_busy. Slot follows fatal port,
otherwise core timeout priority, otherwise port; only an exact known stop
override is allowed. Fatal probes must have no later executed cases or physical
intents. Stage presence remains conditional; empty/invalid selection and stopped
settlement paths are not turned into success or required to invent observations.
This is ordinal/data consistency, not reconstructed timestamps/authenticity.

### Actual public red/green evidence

Root: /tmp/cairn-scoring-c5-author.t9TmAutQ. Logs are unique and retained.
Both public exports were exercised. The earlier shallow diagnostic's generic
invalid_model_output was not treated as a legitimate positive: actual failed503
core is recall_failed/retryable=false.

| Log | Held scorer/test prefix | Actual exit/count | Observation |
| --- | --- | --- | --- |
| red22.log | fd193097/02a6b630 | 1,0/2 | Genuine accounted87/78 and stopped14/12 ready/assessed;9/12 accounted and17/18 stopped corruptions wrongly admitted |
| green22.log | a27aa5ad/02a6b630 | 0,2/2 | Actual baselines preserved; all30 new cause controls denied |
| override-red22.log | a27aa5ad/d81c99df | 1,0/1 | Four earlier fatal-cancel substitutions admitted despite later work; prior18 controls denied |
| override-green22.log | c990e207/d81c99df | 0,1/1 | Actual final BQ04 override preserved; all22 stopped and raw-timeout contradictions denied |
| focused22-final.log | c990e207/d81c99df | 0,23/23 | Complete final suite,440398.44636ms |
| focused24-final.log | c990e207/d81c99df | 0,23/23 | Complete final suite,385366.890244ms |

Every invocation had zero skipped/cancelled tests. Hypothesis1 is confirmed,
public-rescue hypothesis3 refuted; hypothesis2's real normalizations preserved.
The primary requested the C5.3 ordinal control before freeze; no new schedule,
runtime instrumentation or extra campaign was introduced. The first green is
explicitly intermediate, not final-byte evidence.

Red SHA2567dec4c7945e2321a4a9263d37d3127b21cfec09464117477e843ed31e29e7cc4;
override red9ae71ef979be6a8ad7197fa576badfacbf32a089b74a625b07f8c898d830ddc3.
Final22 log3a3a2b7f3c502d4ad22109e13bdb8079f28a5cf2049646bab430c12584746764;
final24 log89dbf5a47208357cdacde15c7abd2ebc588810fdb7466201985c6f220433bfe9.
All intermediate log hashes also remain in final-inventory.json.

One new genuine all24-cold stopped fixture follows the frozen ordinal schedule:
QA counts503, probe count503/actual30s timeout/duplicate visible refs/count503,
then caller abort only at BQ04's closed healthy checkpoint. Callback returns
undefined synchronously; exact first-four owner identities/order and timeout
raw/core/port/slot/delta are asserted before readiness. Actual returned/persisted
reports match;14 intents/12 healthy closed owners and all48 QA/all24 probes stay
retained. Later slots honestly not-run/cancelled. Metadata/literal refs, never
question/rubric/gold, drive fake outcomes. The existing C4 accounted87/78 and
original192/C1/C2/C3 fixtures, all67 anchors,47 first answers and judgment/harm/
unknown/arithmetic/lifecycle controls remain unchanged. Labels are synthetic
parser/arithmetic controls, not measured model quality.

### Final author commands and boundary

Final scorer SHA256c990e207170803b5324c62d18145e5ed64e62c37afa3cedd40021a59f0f6334a;
test SHA256d81c99df06f05a12a6ffbccc503f2cb15324103aa2a6a18adf7a5035cf910046.
Full suites sequentially used each absolute pinned Node22.16.0/24.15.0 binary:
node tools/testing/run.mjs evaluation/algorithm-development/test/source-bundle-scoring.test.mjs.
Environment: env-i, version PATH, owned TMPDIR, NODE_DISABLE_COMPILE_CACHE=1,
CAIRN_SOURCE_BUNDLE_OFFLINE=1, CAIRN_BUNDLE_TRANSPORT_OFFLINE=1. Source/test
bytes were held; no concurrent heavy suite or cap/tolerance change.

Both node --version, node --check scorer, node --check test and npm run validate
each exited0, with separate logs. npm uses /dev/null userconfig and a distinct
owned comment-only globalconfig; no ambient config/install/network. The ignored
tokenizer link remains unchanged locked1.0.22. Closing final-inventory.json
cross-checks Git against recursive filesystem/blob/mode, exactly four paths,
append-only docs, original21,844-byte/final C4/full C5 contract bytes and empty
owned TMPDIRs. All owned children close before STOP; git diff --check is required.

Primary owns frozen affected gates, scoped commit, both full-base nonauthor
reviews and exact-head CI. Old broad matrices are old-head evidence; combined
algorithm count206 (=BR183+SC23) is prospective, not an author broad pass.
Further failure of this same binding requirement triggers narrow primary
takeover. No semantic efficacy, authenticity, independent clock/firstness,
natural long-history/Mem0 parity, measured lightweight fit, D12/Stage2/3,
launch or spending claim follows.
