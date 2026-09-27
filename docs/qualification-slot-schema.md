# Candidate qualification transport mapping

The longer-history diagnostic returned `[0, 1, 2, 2]` for four qualification
items. The original array schema allowed each entry to match any item variant;
the required array length could not ensure one entry for every distinct input.
The core correctly rejected this response before admitting the batch.

The OpenAI adapter's `qualifyCandidates` wire retains required named item
entries. Its current provider representation is the separately versioned
[`evidence-pool-v1` format](qualification-evidence-pool.md):

```json
{"wireVersion":"evidence-pool-v1","qualifications":{"item_0":{"itemIndex":0},"item_1":{"itemIndex":1}}}
```

This is a shape illustration, not a complete accepted response: each entry also
requires a one-to-four-candidate pool and all seven descriptive/evidence fields.
Each named field is required, permits only its matching item index, and
restricts the pool to that item's supplied candidates. Fields cite slots in
that pool. Additional fields are forbidden. The adapter validates and decodes
the bounded wire, checks the unchanged inline schema, then returns the existing
`qualifications` array in input order. It does not assign a missing entry,
deduplicate an invalid array, invent evidence, retry, or admit an unqualified
fallback.

The shared core prompt and programmatic model contract remain unchanged. A
provider-specific instruction clarifies that its wire object supersedes the
prompt's illustrative array; the added instruction is included in token checks.
Other adapter methods, including legacy `qualify`, keep their prior wire format.
No model, call count, deadline, token ceiling, dependency or database schema was
changed. Installed test-only HTTP responders use the new wire format; direct
scripted core models continue returning arrays.

Required object fields and `additionalProperties: false` follow
[OpenAI's Structured Outputs contract](https://developers.openai.com/api/docs/guides/structured-outputs).
The local validator is scoped to the subset emitted for this method, not a
general-purpose JSON Schema implementation. The core still checks source bounds,
unique evidence selections, aggregate anchor limits and canonical labels.

This reduces a representational failure mode; it does not establish that a
description follows from its source, correctly separates actors or conditions,
or represents current permission. One extracted item can still bundle several
claims. The failed real-model run remains failed; offline schema/installation
checks cannot supply its missing answers. Any new live evidence must use a
separately frozen protocol, not replace that result.

## Offline verification

The regression assertion first failed against the old schema, which accepted a
duplicate/missing item mapping. On Node22.16.0 and24.15.0 the final adapter suite
passed 175 tests, the installed-artifact suite passed 62 tests, and the live
evidence offline suite passed 189 with 30 explicitly skipped installed-only
checks. Both offline adapter demos passed; generic tests passed 38, with JSON
and strict plugin validation. No real provider was contacted.

The pinned Hermes canonical four-file matrix passed 16 tests on each runtime
against a separately inspected/installed archive with SHA256
`940bb0ee1b2f4094f8f18815d81ca4bf7f7699c97f1f89344a9d62be971077fe`.
This includes the merged source-context preference and scripted AIAgent recall.

Earlier full runs exposed two fixture-interface mismatches (an unchanged mock
array and a bare-prompt assertion); those were corrected without weakening
semantic assertions. An overlapping local branch update also triggered the
offline pilot's pin guard; that run was invalidated and the full Node24 suite
rerun on stable sources. The guard was not bypassed and no paid intent was reused.

CI additionally found two stale fake response serializers in MCP and request-
guard tests that the initial local matrix had omitted. After migrating those
serializers, both full `test:mcp` and `test:experiment-request-guard` suites passed
on both runtimes, as did the guard demo, budget suite and budget demo. No guard
or safety assertion was relaxed. These dependent suites are part of this
change's final local verification, not merely delegated to CI.
