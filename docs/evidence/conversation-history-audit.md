# Four-history diagnostic: execution is not currentness

One frozen real-provider attempt completed all four histories, six capture
windows and seven final queries. The important observed gap is not an HTTP
failure: after a cross-window Monday update, the original unqualified Friday
assertion remains active. The final query happened to return the correct Monday
memory. Successful retrieval does not repair the stored stale assertion.

Independent manual agent review and primary source inspection agree on the
failure. The unchanged scorer reports `failed` solely for
`stale_current_assertion`:12/12 assertions source-supported,9/9 required facts
retained,8/8 returned memories relevant and7/7 questions answered, but1 stale
assertion remains among12 final active records. No missing/malformed review
errors. These are separate dimensions, not an overall100% reliability score.
The [separate labels](../../evaluations/results/conversation-history-v1-review.json)
are agent judgments, not human review. Historical labels for rejected proposals
and transient source context are review interpretations, not persisted historical
states or evidence that the engine automatically retired those records.

## Observed behavior

- Within one window, capture retained `Harbor team review now happens on Monday,
  replacing Friday.` and correctly preserved that Tuesday was not adopted.
  It also retained `The speaker is checking the calendar.` This is supported
  transient chatter, a durability/noise concern, not an invented fact.
- Across three windows, the rejected Tuesday proposal stayed rejected, and the
  confirmed Monday update was stored. But `The Harbor team review happens on
  Friday.` remains an active, unqualified assertion with its original receipt.
  It is historically supported and now stale; it was not returned by this one
  final query. No currentness repair is inferred from that successful ranking.
- The entity/negation window preserved Harbor/Go and Juniper/Python, SQLite
  adoption, Redis rejection and unknown deployment completion. Suggestions did
  not become adopted languages or completed deployment.
- The24-message window retained the preferred VS Code editor, Go and Friday
  review facts at positions1,12 and24. This is not a large-history benchmark.

## Provenance and verification

Source/corpus/rubric/scorer were frozen at
`3217c341cdb770ea4849f3f4efd42e233a471984` after independent Standards and Spec
reviews,0 findings each. Extraction used explicit GPT-5.4 mini reasoning-none;
other methods stayed GPT-4.1 mini. No runtime/default/prompt changes or evaluator
repair mutations occurred. Each window's records survived a cold SQLite reopen.

The [raw report](../../evaluations/results/conversation-history-v1.json) retains
all windows, sources, snapshots, queries and diagnostics. Its `completed` status
describes execution only. The public JSON is structurally identical to the
private raw report, with no field redactions; it contains synthetic text only.
Primary reproduced the failed score on Node22.16 and24.15 and verified every
frozen source hash plus raw/public structural equality without changing either.
[Accounting](conversation-history-accounting.json) records the immutable intent,
source/operator hashes and all guarded HTTP observations. No key/full environment,
provider raw errors or private database path is included.

Primary ran the OpenAI offline suite108/108 on Node22.16.0 and24.15.0, then the
final12-test history regression on both, including async observer failures.
Generic31/31 tests and validation pass both runtimes; pinned Claude2.1.260
marketplace and strict plugin validation pass. Earlier test-fixture/configuration
and evaluator-hardening failures were corrected before live execution, not by
changing live results. Failed/unrun reports retain the fixed9-fact/7-query
denominators. Scripted tests are orchestration/scoring evidence, not model quality.

The one real run made52 requests, all HTTP200, reservingUSD0.290864 within its
USD0.75/150-request cap. Known conservative usage estimates addedUSD0.013237;
26 count/unknown-cost requests remain reserved. The original USD20 campaign now
has1725requests,USD14.617736reserved,USD0.953198known estimates,799unknown-cost,
0unsettled;USD5.382264remaining. No retries/refill; reservations are not invoices.

## Next engineering work, not implemented here

The next priority is cross-window update handling in the shared public engine:

1. Define explicit supersession versus disagreement, with revision-bound source
   evidence and no authority derived from untrusted conversation instructions.
2. Preserve inspectable history while preventing superseded assertions from
   being presented as current. A new timestamp alone must not win; rejected
   proposals, uncertain statements and other entities must not overwrite facts.
3. Verify replay/idempotency, namespace isolation, stale/concurrent revision
   rejection, correction/forgetting and bounded work before a fresh versioned
   rerun of this exact diagnostic. Keep this original failure visible.

Transient-memory admission is a separate quality concern. It must not be hidden
by relabeling all source-supported chatter as durable. No temporal engine change,
default promotion, host auto-capture integration, merge, release or deployment
is claimed by this diagnostic delivery.
