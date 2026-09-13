# Experimental claim-focused rationale input

The [one-shot real-model comparison](claim-focus-ablation-results.md) did not pass
the semantic gate. This mode remains experimental and is not promoted to defaults.

The embedded core can explicitly include a memory's stored interpretation as an
unverified endpoint focus:

```js
await core.reviewRationale({
  namespace,
  refs: [{ memoryId, revision }],
  inputMode: 'claim-focus-v1',
});
```

Without `inputMode`, the existing source-only behavior is unchanged. Null,
undefined-as-an-explicit-field and other modes are rejected. This slice does not
enable focus in automatic capture or add a local MCP/HTTP option.

## Why add focus?

Different memories may cite the same complete multi-claim receipt. Previously,
their model inputs differed only by local index, hiding which person's claim
each endpoint represented. Opt-in adds `focus: { content,
interpretationStatus: 'unverified' }` next to the unchanged indexed receipts.
It adds no persistent IDs, qualification, kind/confidence or timestamps.

Focus is a possibly wrong interpretation, not a new source. The prompt requires
that the specific focused claim be supported by the selected receipt, preserves
subject/scope/uncertainty, and asks for omission if focus conflicts with evidence.
This guidance is **not mechanically verified entailment**. Offline tests show
that previously identical payloads are distinguishable, not that a real model
will choose correct edges or resist every malicious summary.

## Bounds and persistence

The exact focus joins the source snapshot for pre/post-model freshness and atomic
commit validation. The same six-memory, 24,000-unit snapshot, 6,000-input-token
and 1,024-output-token limits apply; oversized context fails rather than truncates.
Only the same single `relate` call is made. Opt-in review results identify
`inputMode`; existing edge rows remain model-proposed relationships in schema 12.
They do not store the input mode or become proven claims. Inspection continues
to expose sources, not focus. Existing links are not rewritten or revalidated;
use a fresh synthetic store for comparative experiments.

This expands the configured provider's personal-text exposure to stored memory
interpretations, within the caller's exact namespace. No telemetry, new provider
grant, background capture, authority or automatic state transition is introduced.
The existing file/journal/backup and forgetting limitations still apply.

The [earlier rationale semantic gate](rationale-pilot-results.md) remains failed.
A fresh pre-frozen real-provider comparison of source-only versus focused input
must test reversed challenges, false adoption, two-person shared receipts and
unsupported focus before any promotion to automatic capture defaults.
