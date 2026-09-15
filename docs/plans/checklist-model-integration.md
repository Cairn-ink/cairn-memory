# Bounded checklist model integration

Dependent base: `edc0451a626beebaf77384d414553daaab70900e`.

The preceding compiler is offline-only. Connect it to the existing adapter's
bounded transport without changing the production core selector or creating a
second provider implementation. No paid execution or new guard authorization
is part of this package.

## Acceptance

1. Add the narrowly named adapter method `selectChecklist` through the existing
   `invoke` implementation, using the configured `select` model profile. Existing
   methods, default model choices and production core behavior remain unchanged.
   Do not add the method to the exported baseline `schemas` allowlist: old
   experiment guards must still reject it. No arbitrary schema or method hook.
2. `schemasFor('selectChecklist', input)` produces a strict request-scoped schema
   for at most four `{start,end,refs}` requests. Bound offsets by query length,
   refs by actual visible namespace/memory/revision values and at most24; final
   correlated tuples, valid Unicode spans, duplicates and union counts remain
   compiler responsibilities. Reject malformed input before network; do not
   import evaluation modules into production core/adapter code.
3. Add an evaluation-only wrapper under `evaluation/architecture/` which replaces
   only `select`. It prepares the exact detached request, invokes the new adapter
   method with the incoming signal and1,024 output-token ceiling, validates raw
   proposal serialization and token count before compiling to `{refs}`. Count
   the actual replacement request, including its instructions, against the
   existing6,000-token input ceiling. Do not rely on the outer core counting
   only the smaller compiled output. Counter failures and invalid model results
   fail closed; no repair, retry, implicit fallback or second selection call.
4. Preserve all other adapter methods, context window, counter and diagnostics.
   Core still owns navigation, rank, authoritative final reads and freshness.
   The wrapper must snapshot/prepare before asynchronous calls, retain compiler
   authority despite attempted input mutation, and never persist checklist state
   or claim semantic completeness. No transport method accepts caller-chosen
   credentials, model, schema or namespace expansion through the wrapper.
5. Fake-HTTP adapter tests prove count+generate framing, model/profile mapping,
   strict schema, invalid-input rejection, cancellation and unchanged baseline
   select. Wrapper tests cover one candidate call, unchanged rank, raw output
   overflow before compilation, changed instruction token accounting, bad counter,
   malformed proposal, abort propagation and real core correction/forget fencing.
   Pure tests stay Node20-compatible; SQLite-only cases explicitly require22.16.
6. Verify generic tests, JSON, strict plugin and full OpenAI/offline demo suites
   on Node22.16/24; check Node20 generic compatibility. Verify old experiment
   guard denial with fake HTTP only. Independent Standards/Spec review and all
   required CI precede merge. Document additive adapter API, unfinished immutable
   guard/installed-MCP/fresh comparison gates and absence of paid quality evidence.
   Update CHANGELOG for the additive capability, without a release/version bump.
