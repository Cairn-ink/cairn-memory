# Rationale model control v1

Outcome: all 48 arms completed mechanically, but the reliable-memory semantic
goal is not achieved. Sol produced more complete supported graphs on selected
cases; model choice alone did not resolve current price applicability or
whole-memory premise ambiguity. No default model or automatic focus is promoted.

## Observed results

`S10` means supports-decision 1→0; `C10` means challenges-premise 1→0.
All receipt indices were zero. Each cell is **source-only / focus**.

| Case | 4.1 mini | Luna | Sol |
| --- | --- | --- | --- |
| Camera rainproof premise | C10 / S00 | C10 / C10 | S00+C10 / S00+C10 |
| Chinese microwave compatibility | C10 / C01 | C10 / C10 | C10 / S00+C10 |
| Separate people | S00+S11+C21 / S00+S11 | ∅ / C21 | S00+S11+C20+C21 / S00+S11+C21 |
| Career consideration | ∅ / ∅ | ∅ / ∅ | ∅ / ∅ |
| Two-reason storage | S00 / C01 | C10 / C01 | S00 / S00 |
| Assistant recommendation | S00 / ∅ | ∅ / ∅ | ∅ / ∅ |
| Compatible helmet | S10 / S10 | S10 / ∅ | S10 / S10 |
| Temporary lunch | S01 / ∅ | ∅ / ∅ | S00+S11 / S00+S11 |

- Camera and microwave: Sol focus supplies both original support and a correctly
  directed later challenge. Mini focus misses the camera update and reverses the
  microwave challenge. Luna gets these challenges but omits initial support, so
  incident visibility alone does not establish a complete default context chain.
- Separate people: Sol focus preserves both reasons and targets the correct
  person's update. Mini focus omits the update; Luna focus omits supports. In
  source-only mode, both first receipts contain both people's decisions, so Sol's
  C20 is receipt-defensible ambiguity, not proof of a crossperson error. Luna
  source-only misses the positive relationships entirely.
- Career contemplation correctly produces no decision links in all six arms.
  Mini source-only falsely makes the explicitly nonadopted assistant suggestion
  support a decision; all other recommendation arms abstain appropriately.
- Storage: Mini/Luna focus reverse the update. Luna source-only captures the
  current price-applicability challenge. Mini source-only and both Sol arms retain
  historical support but omit the frozen rubric's update link. This omission is
  not a claim that the historical $6 price was false. A whole-memory edge cannot
  distinguish the changed price premise from the unchanged Canadian location.
- Helmet links are supported wherever emitted; Luna focus misses available
  support. A redundant missing S00 is not automatically an error when S10 already
  supports the decision. Temporary-lunch Sol preserves both scoped reasons.
  Mini source-only S01 can refer to the usual preference reaffirmed in receipt1;
  do not label it cross-scope error automatically. Empty arms omit positive links.

There are 9/6 source-only/focus tuples for mini, 4/4 for Luna, and 11/11 for Sol.
Those are output counts, not precision scores. All warm/cold incident views match.
Two independent same-family agent reviews agreed on the main errors and caveats.

## Engineering decision

Continue improving both model inference and representation. The same schema can
produce better supported outputs, so architecture does not force every observed
mistake; this control cannot isolate capacity from other model differences.
Conversely, shared receipts, compound premises and multi-claim focus remain real
ambiguities. Next work should bind individual decision/reason/update units to
source evidence and distinguish current applicability from historical truth,
while retaining model interpretation as unverified. Do not manufacture a new
decision or erase history when a premise changes. This is a next direction, not
a shipped feature or a demonstrated solution.

## What this experiment measures

Eight fresh synthetic cases × baseline/Luna/Sol × source-only/claim-focus inputs
produce 48 fixed arms. Every arm manually admits source-bound records through
the installed public core, invokes the actual adapter once, and compares warm
incident-proposal inspection with a keyless cold reopen. This is not automatic
capture, answer generation or a complete MCP-host session.

The baseline is `gpt-4.1-mini-2025-04-14`; alternatives request `gpt-5.6-luna`
and `gpt-5.6-sol` with reasoning none. Count/generation input, strict schema and
6,000-local/7,024-provider-input/1,024-output limits remain fixed. Undated aliases
are request-name controls, not frozen model weights. All are from one provider;
this is not a comparison of independent model families or optimized reasoning.

Case order rotates models and alternates input modes. A fixed durable one-shot
intent and 96-HTTP / US$2.048 additional reservation cap sit inside the existing
US$50 ledger. No failed case is retried, replaced or dropped. Input-count costs
without usage remain unknown; conservative reservations are not invoices.

## Interpretation rules

The [pre-outcome rubric](rationale-model-rubric.md) distinguishes source binding
from semantic support, changed premises from changed decisions, and reasonable
abstention from missing positive links. Identical-receipt and residual multi-claim
ambiguity are preserved. Compare models within each mode, not a focus endpoint
score against source-only inputs that cannot identify the same target claim.

The storage-price update need not falsify its historically valid original price.
A fact confirming a decision's reason is not itself the decision. A temporary
choice need not replace the usual preference. No single aggregate score can
faithfully hide those distinctions in this small diagnostic sample.

Independent, non-blind agent reviewers inspect the frozen material and raw outcomes; they
are not external human validation. Prior failed rationale/claim-focus experiments
remain evidence and are not erased by this control.

## Cost and provenance

This run used 96 HTTP attempts and reserved US$2.048. Available generation usage
priced at the configured conservative rates totals US$0.075438; 48 count attempts
have unknown cost. Afterward the shared campaign has 666 requests, US$4.898
reserved, US$0.230887 usage-priced estimates, 333 unknown-cost attempts and zero
unsettled requests. No refunds, replacement runs or new campaign allowance.

Source: `87120ac17742c92c452a7e1fe866f10c4b7c4512` (PR #84 candidate).
Archive: `f075cead1bf3dcb93283adf444446748df61a6724d2ffead07126ea68abec43b`.
Operator: `abb32594212bed2a1eabb7ca120cb58e1800e355c8934857c839834625d98bb9`.
Fixture: `fdfe9258e4bb53496f39a9492d0071f290e038ea3e6c175f932862fec5da18b5`.
Rubric: `f017d1ca6c2906453e8ffe91644d48c6ed99ceed03f069eebb5a41189d8d5da6`.
Private raw report: `939e3affea11636e0c148cf3d749535780cc6bd2543fd024807785c80fdbb532`.
Public projection: `5c69612ab789f55c21f4cc42d8521557c6b268f0aa789d23e81267bf8e9c9668`.
The [full synthetic projection](../evaluations/results/rationale-model-control-v1.json)
retains all 48 arms and returned model IDs without private operator paths or keys.
