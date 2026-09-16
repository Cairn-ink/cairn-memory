# Natural rationale trace: bounded development pilot

Base: `a8f686c`. This is a pre-live operator and offline verification packet,
not a paid result or an installed-MCP claim. The primary alone may later run it
with an explicitly injected provider key and fetch. No ledger creation, refill,
capability provisioning, credential discovery, production data, or retry occurs.

## Frozen contract (NP1–NP4)

1. Select exactly the four `dev` cases from
   `evaluation/decision-evolution/fixture.json`, in source order: 10 events and
   four questions. Freeze the source-only projection and its SHA-256 before any
   I/O. Never load the separate rubric into the generation path. The actual
   `runDecisionEvolutionCore` path must receive `naturalRationaleTrace: true`,
   `includeRationale: true`, `coldReopen: true` and an adapter model using the
   guarded transport. Its output is diagnostic evidence, not semantic success.
2. Reopen the existing at-most-USD50 phase ledger with an exact caller-supplied
   configuration and expected settled checkpoint. Reuse its immutable rationale
   extension and `createRationaleLiveSession`, baseline model/policy and
   `createRationaleAttempt` (384 HTTP/1,920,000 microUSD maximum). The one-shot
   `natural-rationale-dev-v1-intent.json` is exclusively, durably written in the
   ledger directory; its existence forbids a replay, even after a failed run.
   Verify exact source, runner, prompt, schema, adapter, guard and operator pins,
   capability bytes and checkpoint before dispatch and after caller-controlled
   boundaries. No unsupported host route or alternate model is allowed.
3. Write private append-only evidence: frozen inputs, intent, every reserved
   request, guarded response or unknown failure, all four case slots including
   not-run/failed, budget before/after, known-versus-unknown actual cost and
   cleanup status. Preserve source/model output as data, scrub the injected key
   recursively (including malicious echoes), never emit raw errors or key in
   logs/return values. A failed HTTP, pin, persistence or accounting check halts
   permanently; drain queued calls and close session/ledger in all cases.
4. Fake-HTTP tests cover a normal actual-core run, malformed output,
   transport failure/permanent halt, existing intent, changed pin, mismatched
   checkpoint, and provider key echoed in response. Tests use fresh synthetic
   ledgers and no real credential, real phase ledger or paid request. Run focused
   tests, generic validation and both Node 22.16/24 offline live-evidence gates.

The old rationale pilot and its one-shot intent remain immutable. This source-
built embedded-core diagnostic measures exposed proposals and trace provenance;
it does not establish installed-MCP behavior or answer correctness. Primary
will integrate the trace-runner dependency, inspect the complete diff and run
the required final checks before any paid use or delivery.

Primary checked the [official baseline model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
on 2026-09-16: `gpt-4.1-mini-2025-04-14` standard text pricing remains
USD0.40 input/1M tokens and USD1.60 output/1M tokens, matching the frozen
policy. Conservative reservations ignore cache discounts and are not invoices.
