# V2 descriptive-label canonicalization (S6b)

Base `4e85b25d8f3a42c1c4a80dff11df57901a44a7d4`. Private dependent work;
security/public delivery hold unchanged. No paid calls in this slice.

The fixed v2 pilot's temporary-exception response failed on a fullwidth comma
in its descriptive value. Independent single-variable offline replay isolated
this cause; root ran the original pure compiler reproduction and observed failure.
This established feedback loop makes additional speculative cause searches
unnecessary. Original evidence, model responses and failure status stay immutable.

## Acceptance

- N1: In v2 candidate compilation only, always canonicalize non-null
  subject/property/scope/applies/value using NFKC. Before normalization require
  a well-formed string within the existing raw UTF-16 limit (160 for subject,
  property,value;120 for scope,applies). Null remains null. After normalization
  pass through unchanged S1 validation for canonical text, lengths, redaction,
  known-value source coverage and every other existing invariant.
- N2: No truncation, trim, whitespace collapsing, secret replacement, field
  synthesis, quote/offset adjustment, fallback after failure, enum coercion or
  silent unknown downgrade. A compatibility character that NFKC converts to
  ordinary space is still subject to S1's exact canonical-whitespace rule.
  Normalization expansion over the final limit rejects. Do not change caller
  output objects or immutable snapshots. This is declared label compilation,
  not semantic repair, entailment proof or a slot-identity mechanism.
- N3: Existing manual S1 and v1 qualification validation, source receipts,
  content, candidates, anchors, modes, schema, budget and model methods remain
  unchanged. Missing/foreign references, malformed enum, fifth anchor and later
  invalid batch member still reject atomically. Raw model traces stay raw.
- N4: Independent focused tests first demonstrate the defect before runtime
  fix, then pass after it. Cover punctuation and compatibility characters,
  null, astral/lone-surrogate, raw/final length boundaries, whitespace,
  secret-like descriptors, enum and source-reference rejection, batch atomicity,
  unchanged anchor bytes and no mutation. S1/v1 still reject noncanonical labels.
  Actual v2 capture/cold inspection/replay preserves canonical metadata with no
  extra calls and no identity/retirement writes.
- N5: Root reruns the unchanged private raw-response reproduction against this
  compiler, without provider calls or admitted repair. Root installed v2
  core+adapter+MCP probe with fake HTTP emits fullwidth descriptive punctuation,
  verifies canonical persisted/recall metadata and unchanged source anchors.
  Run dualNode22.16/24 generic/JSON/plugin/core/OpenAI/MCP/artifact/live-offline
  and store/capture/openai-offline demos; update changelog/capture documentation.
  Fixed-head independent Standards+Spec review before delivery.

## Limits

NFKC folds compatibility characters, including mathematical styles; it does not
prove semantic equivalence. No automatic identity/currentness follows. This does
not improve missing antecedent selection, all-null descriptive output or the
proposed/direct ambiguity. Those remain separately assessed work, not claimed
fixed by the mechanical normalization regression.
