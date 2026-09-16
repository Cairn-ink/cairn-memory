# Bounded decision-basis coverage pilot

This is a nonblind synthetic diagnostic comparison, not a held-out benchmark or
evidence of general reliability. It tests whether reviewing each source first
helps a final review cover distinct decision reasons. It does not change the
core, adapter, quote schema, production default, or persistent graph. The
source texts are fresh but their failure categories were known beforehand.

The eight frozen fixture cases contain exactly two source memories each. The
separate frozen rubric lists sixteen required conceptual relationships plus
forbidden interpretations. Reviewers should inspect every raw proposal,
including rejected ones, against the complete original sources. Mechanical
compilation validates anchors and graph shape, not actor identity, adoption,
historical truth or current applicability. An empty local proposal is a
recorded observation, not proof of completeness. A rejected arm is not a
correct abstention.

For each case, the baseline makes one `reviewBasis` generation over both
original memories. The coverage arm makes one local review per original
memory, compiles each proposal with the unchanged `compileDecisionBasis`, and
then reviews both original memories together. Its global prompt includes a
bounded inventory of only the compiled local roles, exact source quotes and
request-local source positions. It explicitly calls those hints untrusted and
asks the model to reassess the originals. Local source index zero is rebased
to the corresponding original index in the retained proposal. Neither hints
nor compiled units are persisted or unioned into accepted edges. Malformed
local output fails the arm with its remaining stages unrun.

The arms use the same supported `gpt-5.6-luna` setting with reasoning none and
the existing 6,000 local, 7,024 provider-input and 1,024 output-token ceilings
per call. The candidate can cost three generations and six HTTP requests per
case versus one generation and two HTTP requests for baseline. This is a
workflow cost/quality comparison, not an equal-compute causal ablation and not
numerically comparable with PR137's different model, cases or schema. The
explicit replacement case needs up to eight units, the entire unchanged unit
cap; output truncation or omission remains a limitation.

`runBasisCoveragePilot` is an explicit parent-only entrypoint. It requires an
injected key and fetch, the existing immutable basis-model capability, an
exact settled checkpoint, transitive source pins, a private empty evidence
directory and the existing shared USD50 ledger. It writes one exclusive
intent in the ledger directory and append-only sanitized local evidence. It
does not create a capability, discover credentials, reset a ledger, retry a
request, or authorize a paid call on import. The one-shot cap is 80 HTTP and
USD0.24 conservative reservations at 3,000 microUSD each; the expected full
schedule is 64 HTTP. The reused comparison attempt helper also requires its
larger pre-existing headroom, so this operator may conservatively refuse a
ledger that has only the new cap's headroom. No cap can be raised through
options. Any transport, pin, persistence, or accounting failure halts later
calls globally.

The private final report retains all sixteen slots, all planned stages,
raw provider response text, parsed raw proposals when available, compiled
results, errors, request usage, call counts and stage/arm latency. Its private
paths and provider key are never published. A later closed synthetic evidence
projection and regression test must be reviewed and frozen before publication.
Actual token-priced estimates and latency should be reported separately;
count-only requests have unknown usage cost, and reservations are not invoices.

The relevant local test is `node --test
evaluation/live/test/basis-coverage-pilot.test.mjs`; the complete offline gate
is `npm run test:live-evidence-offline` on Node 22.16 and 24. These use fake
HTTP and temporary synthetic ledgers only. They do not authorize paid calls.
