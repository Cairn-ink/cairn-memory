# Installed capture-to-MCP: one real-provider lifecycle

The scoped experiment passed six mechanical stages and separate independent
agent source review. Primary independently inspected all stored claims, source
receipts and mutation results. This is one synthetic scenario, not a human trial
or general reliability claim. Runtime/model defaults did not change.

## Actual path and outcome

The offline-installed preview core captured `Harbor team review happens on Friday.`
using explicit GPT-5.4 mini reasoning-none. It stored one supported paraphrase,
`The Harbor team review happens on Friday.`, and the original user source receipt.
Classification filed it under `Team Reviews`, advancing the memory to revision2.
The producer core closed before any consumer started.

| Stage | Observed outcome |
| --- | --- |
| A, installed programmatic capture | One supported Friday fact, original provenance retained |
| B, fresh MCP | Friday recalled; foreign owner/project cannot read or overwrite it |
| C, fresh MCP | Consumer discovers revision2, corrects it to Monday revision3; stale write rejected |
| D, fresh MCP | Only current Monday assertion recalled, with the Monday correction receipt |
| E, fresh MCP | Stale delete rejected; current delete returns `forgotten:true`; target absent |
| F, fresh MCP | Successful complete empty recall, missing target, exhaustive empty listing |

Five new actual stdio client/server sessions ran B–F; isolation controls created
two additional foreign-bound sessions. All recall/classification model requests
remained the baseline GPT-4.1 mini. Tool sequencing is programmed by the harness,
not selected autonomously by Hermes or another host model. Capture is an installed
module API, not a newly available public capture tool or automatic transcript hook.

## Frozen provenance and retained evidence

- Harness source commit: `2e3546fdb5b6333d2c907a12df82ad09d9c6d4d0`.
- Installed archive SHA256:
  `8d4b0178381d88a34673b7435e15c3f10ea18aff97dec8040ff4b82e234b2ee9`.
- Installed runtime bytes were compared directly with the pinned archive before
  importing the installed core/adapter. No workspace runtime substitution.
- [Raw report](../../evaluations/results/installed-capture-v1.json) retains its
  original `mechanical_pass_pending_semantic_review` status. Only private
  `provenance.packageRoot` is removed; no observation or failure is rewritten.
- [Separate agent review](../../evaluations/results/installed-capture-v1-review.json)
  accepts A–F. Source support is a recorded judgment, not inferred from keywords.
- [Accounting](installed-capture-accounting.json) retains immutable intent,
  source/operator/binding hashes, every HTTP observation and final totals.

Both independent pre-paid Standards and Spec reviews had0 findings on the frozen
harness commit. The private operator's initial missing redirect field and source
binding omission were fixed and independently cleared before any live request.
One run was made; no retry or replacement. No key/full env/provider raw error or
user conversation is included in these public records.

## Verification and budget

Node22.16.0 and24.15.0 each pass9/9 installed offline tests, including scripted
empty-capture and wrong-source negative controls. The full ordinary offline
suite passes36 with11 explicit fixture skips; those skips are not live evidence.
Generic tests31/31 plus validation pass each runtime, as do pinned Claude2.1.260
marketplace and strict plugin validations. A preliminary test-fixture mismatch
failed before alignment; the final committed tests were rerun successfully.

The real-provider run used Node22.16.0 and22 guarded HTTP requests, all200.
It reserved USD0.115144 against the scoped USD0.50/100-request ceiling, within the
original USD20 campaign. Known conservative generation usage added USD0.003158;
11 count/unknown-cost requests remain reserved, not assumed free.
Final campaign totals:1673requests,USD14.326872reserved,USD0.939961known estimates,
773unknown-cost requests,0unsettled. Remaining reserved allowance:USD5.673128.
Reservations are nonrefundable guard bounds, not invoices or actual charges.

This closes the bounded installed capture→MCP gate. Long-history/conflicting
conversation quality, autonomous host integration and human usefulness remain
separate work. No default promotion, merge, registry publication or deployment.
