# Fresh same-source answer accounting comparison

Dependent base `a1ac43e80de7376babff985a5f803df9ff779924`.
This isolates host interpretation, not capture, MOC relevance or installed MCP
product quality. Retain all previous failed experiments unchanged.

## Fixed design

Six fresh authored histories, three matched pairs with one provisional/confirmed
sentence varied per pair. Each has eight source statements (seven user, one
explicitly unadopted assistant suggestion), each<=800 UTF-16 units with unique
IDs. Question is identical within a pair, with no convenient final recap.
Use new domains, not earlier bookbinding/plant-marker/sketch-supply fixtures.
Cover independently challenged and reaffirmed reasons, separate actor, temporary
planned return, enclosing negation and missing approval across the three pairs.
One pair is Traditional Chinese. No case establishes that prior consent is an
execution grant. All facts are synthetic; no real conversations.

Each history has two fixed input views: complete eight sources, and a separately
named diagnostic subset omitting one reason-changing source while preserving
the decisive commitment. The omitted source ID is fixed before execution; never
selected from model outcomes. This is **constructed omission**, not observed
retrieval or a calibrated absence signal. Ordinary and structured answers see
identical question/source values within each view. Four slots/history =24 total:
complete ordinary, complete accounting, omitted ordinary, omitted accounting.
Alternate arm order by history and view; retain actual order in reports.

The ordinary arm uses existing SOURCE_ANSWER_INSTRUCTION. Accounting uses the
reviewed prepareSourceAnswerAccounting system/compile contract; no request body
extras or second prose generation. Both use gpt-4.1-mini-2025-04-14, max1024
completion tokens, storefalse, streamfalse,n1. Input<=6000 local tokens per arm,
serialized request<=24000 bytes, output<=1024 local tokens and16000 bytes.
Every request and raw response is retained. A structural failure is not repaired,
retried or replaced with another answer. The compiled record's prose is the
candidate answer; review both record and prose for internal disagreement.

## Acceptance for this protocol package

1. Add closed `evaluation/live/answer-accounting-fixture.json` with top-level
   `{id,histories}` id `source-answer-accounting-comparison-v1`. History shape:
   `{id,pairId,question,sources,omittedSourceId}`; source `{id,role,content}`.
   Six histories, three pairs, eight sources each, exactly one changed user
   sentence per pair. No interpretation/rubric labels in source-facing fields.
2. Separate `answer-accounting-rubric.json`, sameid, six ordered history labels:
   `{id,requiredSourceIds,qualifierSourceId,expectedCommitment,reason,scope,actor,unknown}`.
   expectedCommitment provisional/committed; descriptive strings for semantic
   review, not model inputs. All required/qualifier IDs exist, omittedSourceId
   is required but not qualifier. Review source/rubric consistency independently.
3. Document24 denominators, same-input fairness, record overhead, exact input
   omissions, source-only host scope, nonblind/same-family limits and no automatic
   correctness/promotion claim. No new persistent representation or publicdefault.
4. Fixture tests validate closedshapes/roles/uniqueIDs/fulltext/priorrole/onepaired
   change, critical qualifier retained in bothviews, source/rubric separation,
   pairquestionidentity, boundedserialization and unchangedcompiler acceptsall
   prepared inputs. Counter is scripted offline; actualtokenizer check separate.
5. Rootgeneric/JSON/strictplugin plus full live-evidence-offline bothNode22.16/24,
   independentexactcommit Spec/Standards and allrequiredCI beforemerge. Existing
   tests/mocks do not establish real-model answer quality.

## Later execution gate

Existing cumulativeUS$50 campaign, fresh run ceilingUS$2 and24HTTP attempts /
24generations; no count endpoints, source-model requests, judges or retries.
Each host reservation remainsUS$0.05, with source/dependency/operator/fixture/
rubric/compiler/guard pins checked before every dispatch. Budget checkpoint and
one-shot durable intent prevent replay. Insufficient headroom stops before send.
Transport/pin/accounting failures halt later dispatch and retain not-run slots.
Malformed answers fail only their slot; no regeneration. Cleanup outcomes remain
separate. Realkeyparentonly, no providerkey in outputs/children/publicrepo.

Independently review a bounded operator and rehearse success, invalid structured
JSON, unknown source reference, transport interruption, budget/pin mismatch and
cleanup failure with fakeHTTP/syntheticledgers before real execution. Recheck all
pins, CI and conservativebudget headroom. This document does not itself execute
or authorize a provider request; standing owner scope/budget remains controlling.

Root plus two separately working reviewers inspect every answer/rawsource and
record using frozenrubric. Missing input cannot justify invented certainty;
complete-source errors are host interpretation errors. Report omission honesty,
lost supported content, changedvscontinuingreasons, commitments/actors/time,
absentapproval, and needlessabstention. A record may be more inspectable but
equallywrong. Do not promote if fidelity regresses or structure merely shifts
errors into unreviewed fields. Even success needs larger unseen histories and
actual end-to-end installed-host integration before a productclaim.
