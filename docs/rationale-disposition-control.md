# Old-graph-visible full-set control

`createRationaleDispositionControl(model, oldEdges)` is an evaluation-only,
one-shot facade for the embedded core's source-only `proposeRationale` helper.
The caller supplies a complete frozen set of zero to ten old relationship
proposals using request-local indices. The facade appends those proposals,
marked `unverified`, to the ordinary retained source-receipt input and sends
exactly the same input fields as the separate disposition review port. It
does not send namespace, persistent IDs, receipt metadata, generated summaries,
focus text, expected labels or evaluator answers.

The control appends a frozen evaluation instruction to the unchanged ordinary
relation prompt. It asks for a complete `{edges}` set: the model can include
old proposals or omit them and can add new proposals, all under the existing
ten-edge relation tuple contract. This is not a disposition protocol and an
omission is only absent from the ephemeral returned set. There is no write,
replacement call, automatic use, MCP tool, exported adapter schema or paid
authorization. Malformed and empty raw outputs pass through the facade without
repair; the core proposal helper performs its usual compilation.

The facade rejects custom/getter/sparse source and old-edge input, other
tasks and focus before provider access. It snapshots and freezes the expanded
provider request, counts that actual request under the unchanged 6,000-input
and 1,024-output core limits, and requires the later send to match the counted
bytes. It captures the provider and counter callbacks before either can mutate
the caller setup, forwards one core AbortSignal and checks it before and after
the provider call. The installed-artifact regression observes the two fake
HTTP phases through the real installed adapter and installed core proposal
helper; the facade itself is not packaged.

This control is a whole prompt/output-protocol comparison, not an isolated
causal test of graph awareness. The ordinary relation prompt already includes
detailed relation definitions and a trust warning; the initial disposition
prompt v1 did not inline those definitions. A separate v2 prompt-alignment
correction is planned and must be pinned explicitly by any later comparison;
no such alignment or semantic result is claimed here. Later operator gates
must establish equal provider-visible source/old-edge inputs and unchanged
cold stored graphs, then score fresh frozen cases independently. No fixture,
rubric, paid call or quality claim is included in this slice.
