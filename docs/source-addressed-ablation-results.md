# Source-addressed development ablation: provenance improved, semantics not established

Do not promote this mode to a default. Exact addressing removed occurrence/copy
ambiguity in this run, but accepted outputs still contained false challenges,
misleading supports, lost negation and non-adoption labelled as a decision.
The optional representation can express a dual-role update; that is not a
reliable decision-memory solution by itself.

## Protocol and accounting

Once-only run of eight new texts adapted from known failure categories, three
models, original versus `source-addressed-v1`: 48 slots and 96 HTTP requests,
including input counts. See [fixture](../evaluation/live/source-addressed-fixture.json),
[frozen rubric](source-addressed-rubric.md), and [all outcomes](../evaluations/results/source-addressed-ablation-v1.json).
Sources were manually admitted to the installed shared core. There was no
extraction, MOC retrieval, final answer, real user task or blind holdout. Model
order rotates and arm order alternates; no retries, fallbacks or case replacement.
Prompt, schema, source addressing and dual role change together: this does not
isolate their individual effects. Input/output limits remain 6000/1024 tokens.

| Model | Original structural completion | Addressed structural completion |
| --- | ---: | ---: |
| gpt-4.1-mini-2025-04-14 | 1/8 | 5/8 |
| gpt-5.6-luna | 7/8 | 5/8 |
| gpt-5.6-sol | 8/8 | 8/8 |
| Total | 16/24 | 18/24 |

These are **not accuracy scores**. All 14 rejections are `invalid_model_output`.
Every addressed range, including rejected proposals, resolves to a valid exact
source span. All 48 source-preservation, nonpersistence and cold-reopen checks
passed. That does not make the interpretations true or useful.

The shared US$50 ledger moved from 858 to 954 requests and from US$8.994 to
US$11.042 conservative reservations (+US$2.048). Known token-priced estimates
moved from US$0.467512 to US$0.663400 (+US$0.195888). Unknown-cost requests moved
from 429 to 477; none are unsettled. Unknown is not free, reservations are not
actual bills, and known estimates are not an invoice.

An earlier offline setup failure made zero requests because the operator used
unsupported memory kind `addressed` rather than `context`. It was corrected
before live calls; product validation was not relaxed and the failure was kept.
Fresh offline rehearsals passed: success 96 requests/48 completed; malformed
96/47 plus one failure; transport one failed request/47 unrun with permanent halt.
Two independent pre-live reviewers checked the exact operator and installed pins.

## All-case semantic review

The implementing agent and an independent review agent inspected all 48 raw
outputs, including rejected proposals. This is nonblind agent review, not
independent-human validation or a held-out accuracy score. O = original, A = addressed.

| Case | Mini: O → A | Luna: O → A | Sol: O → A |
| --- | --- | --- | --- |
| Watch battery | O separates reasons but labels non-replacement a decision and infers an extra swimming motive; A bundles battery and water resistance into one challenged premise. | O separates reasons correctly; A bundles them, losing battery-only isolation. | Both correctly separate reasons and challenge battery only. |
| Museum opening | O rejected wrong/duplicate links; A accepted negation clipping and old-time support for the new choice, missing new-time support. | O misses new-choice support; A rejected wrong-role challenge and still omits support. | O misses new support; A adds the desired dual-role chain **and an unjustified historical-reaffirmation challenge**. |
| Planner owners | Both rejected, with non-adoption promoted and invalid links; A also confuses context/actors and unchanged weekly access. | O rejected and omits supports/Jo; A has some correct links but also invalid and false reaffirmation/non-adoption challenges. | O principal chains correct but extra non-adoption decision; A separates owners, challenges Hazel only and supports Jo's explicit continuation. |
| Temporary office | O rejected self-supports; A accepted wrong future-return reason for this week's office choice and omits quiet/noise supports. | O retains choices without required links; A adds wrong home-to-office support and a reaffirmation challenge. | O has both correct supports; A adds a valid week-scoped noise challenge. Extra return/non-adoption unit is ambiguous, not proof of permanent adoption. |
| Old encryption report | O rejected invalid support with stale challenge; A accepts historical negative as support/challenge alongside valid supports. | Both accept an unjustified historical challenge; A's current-confirmation support is valid. | O correct; A regresses to challenges from both old report and successful current export. |
| Unadopted VPN | Both rejected and invent decision role for assistant advice. | O unlinked non-decision units are reasonable abstention; A rejected orphan challenge, not appropriate basis output. | Both appropriately empty. |
| Charger reaffirmed | O rejected invalid directions; A accepts a false confirmation challenge. | O valid; A adds valid confirmation support **and false reaffirmation challenge**. | O valid; A adds a false confirmation challenge. |
| Corrected belief | Both rejected and promote non-adoption. | O preserves belief and correction; A main chain correct but adds false non-adoption decision and confused context. | Both preserve belief-qualified reason and correction without inventing replacement. |

Before outcomes, Spec review clarified the temporary-office rubric: a challenge
limited to renovation week's quiet applicability is valid; permanent invalidation
of the usual routine is not. Sol's addressed context explicitly preserves that
scope. Likewise a confirmation-premise support can be valid; it is the additional
challenge, not the support itself, that is wrong in charger reaffirmation.

## Architectural conclusion and next gate

Mini's accepted museum unit selects “the old opening time was wrong when I
booked” while dropping its enclosing “I am not saying”. Exact provenance proves
the substring exists, not that it preserves the speaker's assertion. Sol retains
correct dates on the historical encryption report yet still falsely challenges
the newer capability. More context fields alone are not a semantic check.

Keep these views explicitly model-proposed/unassessed and nonpersistent. Do not
add case-name, date-string or negation-keyword exceptions to make this set pass.
Do not infer quality from more structurally accepted outputs or buy larger
output limits as the first response. Source addressing is a useful mechanical
tool; selective assertions, semantic entailment and calibrated abstention remain
separate work.

Next: evaluate full source-window capture → restart → MOC recall → source-backed
interpretation, with source-oracle and simple lexical controls that expose where
information is lost. Separately compare independent semantic checking versus
source-only evidence/abstention, measuring false relationships and lost valid
ones as well as cost. These are pending gates, not implemented quality claims.

## Provenance

- Source: `30ea0c35bf700c5aa4d2609ada0fd33248cd3c00`.
- Operator SHA256: `be8ad081a7358adbce98b6c0a84a719b14a416af510d19f438c6dacd4c50c6d7`.
- Fixture SHA256: `973e76796a3aca102572e1681552540b734c34fcd650b12957b102c1e64856a4`.
- Rubric SHA256: `c6350860b4856bcd27dcfbce46e05a8cd9e3d0372b0408d718140546961cae67`.
- Artifact SHA256: `9b7c3b2ef0745b7878a0e7037201cc6e864ce275ed821251fcb0a570b9967b4a`.
- Private raw SHA256: `59889b1db98ba47c584c1fb26543fba079a18f52640d6845d74eb151869db29d`.
- Public projection SHA256: `f95269e137ef6c67e974aa9ff5ab34717960abb80952259a1aae57f749692351`.

The projection retains numbered receipt parts, raw proposed ranges/context,
compiled anchors, failed outcomes and accounting; it excludes credentials,
provider headers, local paths and private client/session metadata. Earlier
source-context evidence remains byte-identical under the shared projection code.
