# Explicit rationale model controls

Base `cb6648989b72e6e0c802118895fd5e5cce47b72f` after synchronizing the
independently delivered claim-focus report (#81); no overlapping runtime edits.

## Why this precedes a representation rewrite

Both source-only and focused tuple inference failed semantic cases. Before
attributing every error to the memory architecture, a model-capacity control is
needed. This slice makes the existing relate port configurable independently of
extraction, without selecting a production winner or changing the engine.

Official documentation checked 2026-09-14: [Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
lists $0.20/$1.20 per million input/output tokens; [Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)
lists $4/$20, with promotional pricing at least through 2026-11-21. Both support
structured outputs and reasoning none. Their pages list undated model IDs, not a
dated immutable snapshot; pin request names and record response IDs without
claiming frozen weights or established account access. Cache-write input premiums
require conservative reservation estimates, not invoice claims.

## Acceptance

1. `createOpenAIModel` accepts optional rationaleModel equal to the existing
   baseline, gpt-5.6-luna or gpt-5.6-sol. Absent retains exact existing behavior.
   Null/unknown model names reject before HTTP. ExtractionModel stays independent;
   no other method inherits rationaleModel and Sol is not a new extraction choice.
2. New profiles explicitly use reasoning none; retain the existing strict relate
   schema, exact count/generate framing, no tools/store/stream, token/output caps,
   exact response-model validation and no fallback/retry. Reuse existing Luna
   profile; conservative Sol reservation is ceil(7024*5 + 1024*20)=55600 microUSD.
3. No core, MCP CLI/default, schema, source retention or semantic claim changes.
   Existing paid guards must still reject newly routed relation models: profile
   selection is not a live grant. A separately scoped future guard/experiment is
   required before any paid use under the phase ledger.
4. Fake-HTTP tests cover three relation profiles, independent extraction choices,
   invalid modes, unchanged other ports, wrong response model, and installed
   actual-core invocation. Both Node versions run adapter/full artifact/generic
   gates and independent review. No provider calls in this slice.
