# Ordered conversation-history diagnostic — offline preparation

This is a new, explicitly ordered run of the original four-history synthetic
diagnostic. It does not overwrite the original failure or establish a new quality
score. The original source cases, rubric, scorer, unordered runner, review and
accounting are pinned byte-for-byte in the [acceptance plan](plans/ordered-history-evidence.md).

`runOrderedHistoryAudit({model,directory,onProgress?,readDiagnostics?})` from
`evaluations/ordered-history-runner.mjs` uses the actual shared core. Supply an
injected model and a fresh empty private temporary directory. No provider, key,
network transport or live command is discovered; injecting a real provider would
still require its explicit credential and spending authorization.

The fixture's known window sequence supplies causal order. That is appropriate
for a frozen synthetic experiment, not evidence that an arbitrary host can infer
chronology from received messages. Four histories, six windows, nine required
facts and seven queries remain the same diagnostic, not a large-history benchmark.

## Two retained views, two review responsibilities

`evidence` retains complete active AND historical memories, their original
receipts and directional replacement evidence after every capture and cold
reopen. Capture/recall envelopes, diagnostics, failures and not-run work remain.
No explicit supersede, correction or deletion is used to repair model output.

`v1Projection` is a separately named, detached compatibility view for the original
scorer. It includes every active row and removes only physical historical rows
and new ordering/history-only metadata. It is not the raw report or a replacement
for the original failed result. A projection that drops an inconvenient active
claim, changes a status or alters a recalled answer must be rejected.

`scoreOrderedHistoryAudit(report,{v1Review,historyReview})` first verifies raw
structure, source bindings, history relationships and the exact projection, then
uses the unchanged v1 scorer. The H2 cross-window update must actually produce a
historical transition; returning Monday in a final ranked answer is insufficient.

The fresh `v1Review` covers the original source-support/currentness/retention/
relevance/answer obligations. A separate `historyReview` labels every distinct
physical historical memory revision for both source support and justified
retirement. The engine's historical bit cannot certify its own decision. Missing,
false, duplicate or unbound review labels cannot pass. These are independent agent
judgments, not a keyword score or another model silently used as a judge.

## Verify without provider requests

```sh
npm ci --prefix adapters/openai
npm run test:openai
npm test
npm run validate
```

Run on Node22.16 and24. The new tests use the actual core with scripted model
decisions and handcrafted review labels. They verify the harness and rejection
paths, not semantic quality. No original failure is converted into a pass by
these fixtures; live acceptance remains unrun.

Next steps are a separate frozen negative/positive currentness corpus and the
installed-artifact lifecycle. Only after those offline gates and reviews, and
explicit missing reconciliation authorization under the original cumulative
budget, may a fresh real-provider attempt be considered. No publication, default
promotion, release, deployment or autonomous host-capture claim follows here.
