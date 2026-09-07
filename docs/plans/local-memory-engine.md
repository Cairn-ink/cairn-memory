# 2B — shared extraction engine and local MCP

Base: `74f9d240192059b6c40046424b3fcc6bddba702c`.

## Scope and acceptance

1. A public-source engine composes the 2A store with an injectable structured
   model interface. No private application imports, usage billing, auth service,
   or copied private implementation. Hosted migration remains a separate PR.
2. Capture validates/redacts bounded user/assistant input before model calls;
   strict output validation requires real, in-range source references. Receipts
   are built from input, never model-written excerpts. At most five inferred
   memories commit with all receipts atomically. Invalid output writes nothing.
3. A persistent owner/project/client/event ledger prevents repeated extraction
   for completed events, reports concurrent processing, rejects changed payload
   reuse, and safely retries failed/expired work. A stale lease cannot commit.
   Model calls happen outside DB transactions. Forget/suppression remains intact.
4. Model-assisted recall ranks only bounded eligible personal/matching-project
   candidates, validates returned IDs and rereads revisions after model work so
   concurrent correction/forget cannot return stale snapshots. Empty/unrelated
   queries return nothing. No silent cloud or lexical fallback on model errors.
5. A local stdio MCP server uses the official SDK and this engine, exposing
   remember, capture, recall, correct, and forget. Owner and optional project
   are startup configuration, not model-controlled tool arguments. Protocol
   initialization, discovery, calls, errors and process restart are tested with
   the real SDK client. Existing hosted HTTP schemas/plugin stay unchanged.
6. Ollama is the first production model adapter, loopback-only by default.
   Remote processing requires explicit consent and HTTPS; redirects, arbitrary
   implicit destinations, unbounded responses and hangs are rejected. Model
   selection is explicit; no model auto-download, telemetry, or default cloud.
   Embedded callers can inject other providers through the same contract.
7. Publish deterministic mock model fixtures and local fake HTTP integration
   tests covering invalid JSON/source references, hallucinated IDs, timeout,
   retry, owner/project isolation, duplicate capture, rollback, stale leases and
   cancellation. Existing core/plugin tests and strict plugin validator pass.
8. Run and publish a synthetic real-local-model probe: extraction, source
   inspection, reopen, paraphrased recall, unrelated/isolated queries, correction
   and forget. Report model/version, timings and failures honestly. Mock success
   cannot substitute for this gate. No broad quality/superiority claims.

Moss/maintenance, host-specific lifecycle hooks, HTTP service, export/restore,
hosted migration, release/publishing and production deployment are out of scope.

## Delivery boundaries

Core stays Node-built-in-only; `runtime/` isolates the pinned MCP SDK (MIT) and
Zod (MIT), with its own lockfile. The already-public redactor remains reused.
Schema v2 adds only a capture ledger and migrates v1 transactionally; v1 clients
must not open v2 files. Test migration and recovery with synthetic files only.

The official MCP v1 SDK and Ollama chat/structured-output docs were checked
before implementation. No private prompts, credentials, runtime configuration,
or production data are published. Source Receipts establish traceability, not
proof that a model's interpretation is true.

## Verification record

Local Node 22.16: 33 core tests, 3 real-SDK MCP tests and 31 existing plugin
tests pass. JSON/version validation, strict Claude plugin validation, the store
demo and `git diff --check` pass. `npm ci --prefix runtime --ignore-scripts`
reproduces the lockfile; `npm audit --prefix runtime --omit=dev` reports zero
known vulnerabilities at verification time. No TypeScript gate applies.

The real local DeepSeek probe passed both directly and through actual stdio MCP
with process restart; timings and scope limits are in
`docs/evals/local-engine-2b.md`. No private conversation or model key was used.
Final SHA, CI, independent Standards/Spec review and any review correction rounds
are recorded in the delivery PR. Root owns implementation/integration; complex
state/data review requests Sol with high reasoning under the agreed routing
policy (actual selection/fallback recorded with the review).
