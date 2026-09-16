# Explicit disposition task semantics, before scored comparison

Fixed base: `e68d79f747e895a0dcffedcee3eda13d9793ba32`.
Read-only audit found an instruction-contract gap: the initial disposition
prompt named the two relation labels without defining their direction/adoption
requirements and omitted the ordinary relation prompt's receipt trust warning.
No disposition real-model score has been run. This is a pre-score correction,
not evidence that the correction improves model accuracy.

- DS1: Preserve the original review-rationale-dispositions.md bytes as the
  initial development protocol. Add an explicitly versioned v2 prompt and
  switch only the explicit disposition core port to it. No automatic caller,
  defaults, model/profile, capture, MCP, graph-write or schema change.
- DS2: V2 must include the existing relate-rationale.md relation definitions
  verbatim (both relation paragraphs, including same-memory support and
  non-adoption) and its untrusted-receipt/ignore-instructions/missing-antecedent
  warning. Preserve the disposition-specific exact output, every-old-edge
  coverage, explicit cited withdrawal, unknown retention and historical/current
  distinction. State kept plus unknown plus additions cannot exceed ten edges.
  Do not include any new scored scenario or expected answer. Do not import the
  conflicting ordinary relate output contract into the disposition prompt.
- DS3: Add an observable test that the actual explicit core port delivers V2
  and its defined relation/trust/cap instructions to an injected model while
  preserving the existing output validation, read-only behavior and ordinary
  relate request bytes. Pin original/v2 and baseline prompt hashes; ensure
  the existing prompt manifest is updated following its exact schema.
- DS4: Document that matching definitions removes a known instruction gap but
  the forthcoming comparison still evaluates entire output protocols, not a
  guaranteed causal improvement. Preserve prior scores and frozen prompts.
  No provider call, key, live grant, actual ledger mutation or scored fixtures.
- DS5: Core tests/store demo, adapter fake tests/offline demo, generic and JSON
  validation, relevant installed adapter test on Node22.16 and24.15, primary
  independent key paths, separate fixed-diff Standards/Spec reviews and final
  latest-head CI. Coordinate heavy suites with the other workers. No merge,
  publication or deployment.

One Sol/high worker owns this bounded correction. Allowed files: new versioned
core prompt, core/rationale-dispositions.mjs prompt path, core prompt manifest,
core/test/rationale-dispositions.test.mjs or one new focused test, this plan,
docs/rationale-disposition-review.md and CHANGELOG.md. Do not change the frozen
control prompt or other workers' trees. Report prompt hashes before any fresh
semantic fixtures are authored. Primary owns final comparison design.

## Implementation checkpoint

The explicit core port now reads `review-rationale-dispositions-v2.md`; the
original disposition prompt and ordinary relation prompt remain byte-identical
to base. SHA-256 pins, reported to primary before fixture authorship: original
`f413ad401dccc7a7e109d0fedd8df74cfcaa6cb5887821adaae204dfe7ef8c7e`,
v2 `676b4a2181c32b6fdff0cc528f6720349afc34cd8198f759201ce7f72d674241`,
ordinary relation `b00cc2511e7e01d6507f9d13abf6115b315cca8208866a5e15721b6bee212615`.
The v2 prompt copies the baseline trust warning and both relation-definition
paragraphs verbatim, retains explicit dispositions and states the combined
projected-edge cap. The manifest includes the new prompt; no schema or adapter
transport changed. A new test observes the actual explicit and ordinary core
port requests and pins all three prompt hashes.

Worker verification before candidate freeze: focused core disposition tests
11/11 and focused OpenAI adapter fake-HTTP tests 8/8 passed on Node 22.16 and
24.15. Generic `npm test` passed 121/121 on both. `npm run demo:store`,
`npm run demo:openai-offline`, and `npm run validate` passed on both. Full core
suite passed 698/698 on Node 22.16 and 698/698 on Node 24.15. Coordinated
serial full adapter suites passed 198/198 on both runtimes. After offline
isolated adapter/MCP installs and explicit public-registry metadata cache
preparation, full installed-artifact suites passed 69/69 on both runtimes.
The first focused adapter attempt in this isolated tree
stopped at import because `tiktoken` was not installed; after offline
`npm ci --prefix adapters/openai --offline`, both focused runs passed. No
provider request, credential, paid guard or real ledger was used. These tests
establish prompt delivery and compatibility, not semantic improvement.
