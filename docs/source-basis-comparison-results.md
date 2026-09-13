# Source-basis comparison v1: useful representation, reliability not established

The new representation can isolate a changed reason inside one receipt. It
does not make source interpretation trustworthy by itself. In this fixed sample,
Sol produced the clearest source-bound decision/premise/update separation;
Luna and the baseline still produced accepted semantic errors. No default model,
automatic persistence or reliability claim is promoted.

## What ran

Eight fresh synthetic scenarios × three models × source-only whole-memory and
source-basis arms: 48 slots, one attempt each. All used the actual locally built
and offline-installed shared core/adapter, manually admitted canonical source
receipts and real provider calls. No extraction, retrieval, answer generation,
full MCP capture loop or real-user value was measured. Each arm received the same
receipts for its case; no generated focus or rubric was sent to the model.

The [frozen rubric](source-basis-rubric.md) and
[fixture](../evaluation/live/source-basis-fixture.json) predate calls. Cases adapt
known failure categories and judgments are nonblind agent review, not independent
human ground truth. Prompt, schema and representation changed together, so the
result cannot isolate which change caused an improvement. Three model choices
from one provider are not three independent model families.

The complete [public projection](../evaluations/results/source-basis-comparison-v1.json)
preserves 43 mechanically completed and five rejected arms. All five failures
are baseline-model `invalid_model_output`: four source-basis arms and one
whole-memory arm. No failed arm was retried. All 48 preserve original sources
and matching warm/cold views; all 24 basis arms preserve nonpersistence, including
rejected proposals. These storage checks are not semantic accuracy scores.

## Source-aware findings

| Case | Whole-memory arm | Source-basis arm |
| --- | --- | --- |
| Projector fan / unchanged HDMI | Mini omitted challenge; Luna reversed it; Sol proposed a coarse valid challenge. | Luna and Sol separated fan from HDMI and challenged fan only. Mini fabricated a noncontiguous HDMI quote and was rejected. |
| Insurance renewal / unchanged dental | Luna returned nothing; Sol retained initial support but missed renewal applicability; mini targeted the no-switch-decision receipt as a decision. | Sol separated price from dental and challenged price only. Luna still bundled both reasons into one premise, failing the isolation objective. Mini mislabelled non-adoption and used invalid role directions; rejected. |
| Two people in one receipt | Sol's coarse challenge cannot identify which person's reason. Luna additionally supported a receipt containing no adopted new decision. Mini duplicated the same edge; rejected. | Luna/Sol separated both people and challenged only the bus reason. Mini also called unchanged ferry bicycle access a challenge: mechanically accepted, semantically wrong. |
| Changing career feeling / no adoption | Mini/Luna proposed challenges across different days' feelings despite no adopted career decision. Sol abstained. | Sol abstained. Luna created a premise/update challenge without a decision and lost the temporal distinction; it did not invent a decision unit. Mini did invent decision roles and a nonexistent quote; rejected. |
| Assistant advice explicitly not adopted | Mini supported the user's explicit non-adoption as though it were a decision; Luna/Sol abstained. | Luna/Sol abstained. Mini labelled advice a decision and emitted invalid/duplicate/self links; rejected. The role error alone would not be proved wrong by quote matching. |
| One Tuesday at home / usual library plan | Mini challenged the unchanged normal plan; Luna omitted both supports; Sol retained only temporary home support. | Sol represented two separately scoped supports. Mini/Luna wrongly used usual quiet-library context to support the temporary home choice. Mini also treated explicit reaffirmation as a challenge. All three proposals passed structural checks. |
| Carrier load reaffirmed | All three retained a source-supported positive. | All three retained support without a challenge. Luna/Sol left a confirming unit unlinked; initial support still satisfies the positive, not complete relationship coverage. |
| Late historical printer review | All three retained support and avoided a stale-review challenge; Luna's support can use the receipt's final present-day confirmation. | Sol retained correct current support. Luna treated the August review as challenging September firmware despite explicit dating/current confirmation. Mini used the old negative report to support the duplex-based choice. Both errors passed quote/type validation. |

Some decision quotes still include their reasons. More or fewer units/links are
not accuracy scores, and a whole-receipt endpoint containing multiple people or
claims is ambiguous rather than automatically cross-person contamination.
Canonical source normalization includes punctuation changes before both arms;
the new compiler itself never repairs a model quote.

## Accounting and immutable evidence

- 96 HTTP requests; conservative reservations increased US$2.048, from US$4.898
  to US$6.946 inside the existing aggregate US$50 ledger.
- Known token-priced usage estimates increased US$0.082265, to US$0.313152.
  These configured conservative estimates are not a billing invoice.
- 48 additional requests have unknown actual cost (381 cumulative); unknown
  does not mean free. Zero unsettled requests. No ledger reset or refund.
- Source candidate: `aecc90eec9c8f4593bac2031683b1e5db6968ab8` (#87).
- Operator v2: `6d39895f4de5f62a3cf63f278f9d000e581a05bcf5fd900776bf8b0a74746b70`.
- Archive: `fe6756af7605c71b1b6610095a8f853d9b41dd8898d4e812aa46b83166879a73`.
- Raw private report: `d70b7403cf77fb2a86e735a1c348e3fbe6c8670004fa43e83cccbdae82630441`.
- Public projection: `5ac1be486898b2d3b57f600a1711fd03bff65397e2aece6f6b8a553668bfff75`.

The earlier offline operator draft incorrectly compared a tokenizer-enabled warm
map with a cold map lacking any tokenizer. Its failures remain private diagnostic
evidence, not paid/semantic outcomes. V2 supplies a pure local counter during a
read-only cold phase; success, malformed-response and transport-failure rehearsals
passed independent review before the one-shot paid run. No release or deployment.

## DRI decision

Keep the source-basis API experimental, opt-in, read-only and unassessed. Do not
weaken quote or role checks to improve apparent completion; rejected outputs
remain failures and the original source remains available.

Next, address two separate gaps: require a challenge to belong to an actual
decision–premise chain, and test attribution/time/scope plus reaffirmation against
source evidence rather than trusting a relation label. An orphan-chain check can
reject Luna's career proposal but cannot fix its historical-printer or temporary
scope errors. Broader fresh cases and explicit semantic judgments must precede
durable storage, automatic application or a claim of a reliable memory loop.
