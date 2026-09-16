# Evaluation-only neighborhood sources to answer

[`prepareNeighborhoodSourceAnswer`](../evaluation/live/neighborhood-source-answer-delivery.mjs)
and `deliverNeighborhoodSourceAnswer` accept one actual successful local MCP
`recall_memory` result requested with
`contextMode: "rationale-neighborhood-evidence"`. The caller supplies both that
unmodified SDK tool result and `requestedContextMode`; the helper does not call
MCP, inspect the store, discover a provider or generate a relationship. An empty
result has no item-level mode marker, so the declaration cannot independently
attest how an empty tool result was requested. The installed test asserts the
actual request. This diagnostic supports ordinary MOC selection only; it
rejects optional `selection` metadata from bounded-source-scan.

The helper takes only the selected roots and source DTOs already inside their
returned bounded neighborhoods. It keeps the first occurrence of each memory
in root-then-neighborhood order, requiring every repeated copy to agree in
identity, current revision, complete receipt IDs/order/roles/excerpts and
currentness. A selected root must match its own neighborhood source. Inconsistent
epoch labels, partial traversal, malformed or over-limit sources fail before
answer completion. No extra fetch fills a gap, and nothing is truncated to fit.
The comparison this enables is ordinary source recall versus RN-expanded
returned sources: the source sets can differ, so it measures the whole read
path, not a same-input causal ablation. Neither arm establishes that MOC chose
the right root or that model-proposed links are correct.

After projection, the unchanged
[`installed-source-answer-delivery`](installed-source-answer-delivery.md)
consumer creates the answer request and checks the completion. Only original
source DTOs and the question enter that request. Relationship directions,
status, generated summaries, basis units, namespace and private receipt
metadata are discarded. The existing instruction treats source content and
submitted roles as untrusted, and the request grants no tools or execution
authority. Complete traversal is a bounded transport claim, not semantic
completeness or current truth.

The existing answer bounds still apply: at most six unique sources, up to 100
complete receipts per source, 800 UTF-16 units per excerpt, a 4,000-unit
question, 262,144 incoming tool-text bytes, a 24,000-byte serialized answer
request and 1,024 output tokens. One caller-injected completion is made at
most once; malformed source, failed completion and invalid output retain their
distinct existing statuses. Empty complete recall is valid ignorance. Partial
or oversized cases remain failures in any future comparison denominator.

This adapter does not attest freshness after an arbitrary external delay and
does not authorize paid dispatch. A later live operator would need its own
guarded transport, immutable inputs, budget, timing and retained raw evidence.
The installed synthetic test verifies cold stdio, source propagation and
keyless stored-state equality with a scripted answer; it does not measure answer
quality. Fresh longer histories, natural capture/selection and independent
semantic judgments remain separate gates. The earlier
[source-versus-basis answer comparison](source-answer-utility.md) found no
demonstrated gain from interpreted basis; this slice does not repeat it.
