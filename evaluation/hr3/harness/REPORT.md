# HR-3 harness implementation report

All writes are inside `evaluation/hr3/harness/` or disposable `/tmp` outputs.
No credentials/environment files, network, API or model calls were used. No new
dependencies were installed. No sibling tests, broad suites, or commits were run.
Node was **22.16.0**; repository HEAD was **5cee8a8f2fb92a6d445969664bc148a5d9fbce25**.

The offline CLI exercises all four arms against the injected fake transport,
including the actual pinned product's public core/MCP operations. The real client
is intentionally absent; its contract is in `transport.d.ts`, and every proposed
provider body is validated before durable reservation and dispatch.

## Coverage

| Authority | Implementation |
| --- | --- |
| §§2–3 | Closed extraction/link schema; observed/effective ordering; finite scopes; complete predecessor-set validation; T field/cell versions and typed history; U exact-scope generic heads/history; destructive O heads; pending activation; no expiry fallback. |
| §§4–5, E-2 | Public P admission, inspected-revision MCP correction, explicit whole-withdrawal supersession, retained partial patches, unresolved mappings, receipt selection/omissions, scheduled expiry, named forget/replay/foreign controls, all eight Card branches and inspected dependency revisions. |
| §§6–7 | Scorer-owned Answer schema; actual delivered evidence/provenance maps; malformed/exhausted answers retained and scored; gold/support projected only for scoring. |
| §10 | Frozen prompts/strict bodies/models/caps; source-only cached extraction; literal queries; BM25-T1 1.2/.75; .5/.5 RRF k=10/depth 24; twelve candidates and 2,000 actual serialized tokens/intent; hosted 1,536-dimension small embeddings; P's actual representation-v2 blocks; one stateless reader call/arm/checkpoint. |
| §14, §15 stop rules | Durable atomic reservations, integer accounting, per-request settlements, retained unknown charges, nested embedding dispatches, byte/output caps, stage/global caps, one transport retry, cumulative failure/no-progress/model/usage/authorization stops. |
| §16 | Source, generated-input, pin and execution-artifact manifests cross-checked through independent enumeration/readback routes. |

This is execution-harness acceptance, **not** §8 adjudication/calibration, §12
inference, or §13 paid-stage/continuation approval. Maximal correct references
still require the separate real 768-token cap certification. Fake-reader accuracy
is not reported as research accuracy.

## Verification and commands

All exit codes below are actual process exit codes, not inferred from stdout or
from a trailing command in a pipe. Long runs were attended and their artifact
progress checked. No process is left running after delivery.

| Command/check | Exit | Result |
| --- | ---: | --- |
| `git diff --exit-code b2513501 -- core adapters/mcp` | 0 | Product source matches P's pin. |
| `node evaluation/hr3/generator/cli.mjs --split pilot --out /tmp/hr3-harness-pilot-inputs` | 0 | 60 families; seven generated payload hashes match both `freeze.json` and the generator manifest. Frozen generator source hashes also match. |
| `node /tmp/hr3-harness-challenge/challenge/generate.mjs` | 0 | Copied unchanged challenge sources into `/tmp` first; 1,984 bundles / 736 worlds regenerated. All five JSONL byte/hash entries match the authoritative challenge manifest; independently enumerated directory list matches. |
| `node --test --experimental-test-isolation=none evaluation/hr3/harness/test/ledger.test.mjs evaluation/hr3/harness/test/research.test.mjs evaluation/hr3/harness/test/extraction.test.mjs` | 0 | Focused accounting, reducer, serialization, request and cache tests. |
| `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs /tmp/hr3-harness-pilot-inputs --out /tmp/hr3-harness-final-pilot-v2 --mcp-dependencies <deps-worktree>/adapters/mcp/node_modules --tokenizer-dependencies <deps-worktree>/adapters/openai/node_modules` | 0 | Complete fake pilot: 240 cached extractions, 480 scored observations, 120 valid answers per arm. |
| `node evaluation/hr3/harness/test.mjs --mcp-dependencies <deps-worktree>/adapters/mcp/node_modules --tokenizer-dependencies <deps-worktree>/adapters/openai/node_modules --pilot-artifacts /tmp/hr3-harness-final-pilot-v2` | 0 | 35/35 tests; includes full-pilot artifact validation, two independently executed smoke stages, P public-import checks, eight Card branches, transport stops, partial-completion preservation and restart accounting. |
| Independent pilot manifest/recursive SHA-256 readback | 0 | 2,225 payload files plus manifest; all byte lengths and hashes match. |
| Git file-list / independent filesystem walk; whitespace/newline checks | 0 | 27 delivered files; lists match. Pin's git-derived inventory independently matches 195 filesystem paths. |

The dependency paths above are existing installations, read through the explicit
module-resolution option. They are not copied into the repository. Test output is
retained at `/tmp/hr3-harness-tests.tap`; the final CLI log is
`/tmp/hr3-harness-final-pilot-v2.log`. The CLI's `summary.json`, `manifest.json`,
`ledger.jsonl`, and `scored.jsonl` are in `/tmp/hr3-harness-final-pilot-v2/`.

Earlier diagnostic attempts exited 1: reader requests that exceeded the byte
bound were denied before dispatch; an incorrect control-tool name, empty Card
edit bindings, and an overly early named-forget exposure check were corrected.
The initial complete-test attempt stopped at the byte guard after 252 scored
observations. The final reader framing avoids nested JSON-string escaping while
preserving the exact labeled evidence blocks. A redundant older prototype pilot
was intentionally interrupted (exit 130) during the accounting performance fix;
its completed artifacts were retained in `/tmp`. These attempts are not counted
as completed pilots. The successful final runs above supersede them.

The final fake journal contains **2,798 settled reservations**, no unsettled
requests, zero transport failures and no stop flag. Its simulated settled amount
is $0.705535740; actual paid spend is $0. Research/P embedding reservations used
578,224 / 178,137 conservative units. Syntax checks of all 21 ESM modules exited 0.

## Clarifications and limits

1. **Extraction encoding.** Claims are explicit field/value assignments; anchors
   contain source turn, natural record name, subject and predicate. Reason edges
   carry verbatim source quotes with UTF-16 source offsets. The protocol does not
   prescribe their executable JSON encoding, so it is frozen here. Initial records
   have no predecessor requirement; incomplete/nonunique/historical links cannot
   enact updates. Ten hand-written cases freeze outputs and serializer hashes.
2. **Provider schemas.** The scorer's closed Answer schema is reused. Disjoint
   `oneOf` Value variants become equivalent provider `anyOf` variants, and unused
   definitions are removed from the provider body. This avoids paying/framing
   unreachable definitions without changing the accepted Answer shape.
3. **Reader framing.** Metadata is one canonical JSON line; `CURRENT` and `HISTORY`
   labels precede the actual serialized blocks. Blocks are not nested JSON-string
   values. No diagnostics, snapshot metadata, raw turns or gold enter the reader.
4. **E-1.** Deadlines are expiry triggers. The extraction/reader prompts explicitly
   distinguish them from the rationale behind a time limit. No hidden reason is
   inferred for an unstated-rationale family.
5. **E-2.** A script with a standalone declaration confirms without dependencies,
   then declares with null dependency expectation. A confirmation-with-dependencies
   path has no redundant null declaration. Later mutations inspect positive
   dependency and Card revisions.
6. **Additional fixture discrepancy.** Generator Card edits supply `bindings:[]`,
   which the pinned product rejects. The harness retains the publicly inspected
   bindings for the authored edit, matching §5's complete reviewed edit payload.
   This uses no old-body archive and leaves actual product body-loss behavior
   intact. **Proposed sibling change:** clarify the generator's Card edit bindings
   and stale `blocked_protocol_clarification` metadata under E-2; no generator
   file was changed by this worker. This choice still needs non-author review
   before paid work.
   **Packaging follow-up:** per TRAPS item 4, the primary should review whether
   these evaluation runtime/docs paths belong in `packaging/artifact-files.json`.
   The product import graph does not import this harness; that outside-scope
   manifest was not changed.
7. **Determinism.** Research materializations/serializer bytes, fake replies and
   all-arm scored outputs are deterministic. P's public UUIDs, clocks, fences,
   snapshots and timings naturally vary across fresh product stores. Actual P
   outputs are retained; the harness does not patch the pinned product's clock or
   random generator to make audit bytes identical.
8. **Accounting/restarts.** One shared immutable plan/journal must span paid stages.
   Unknown charges survive restart; stale locks, partial journals and duplicate
   reservations fail closed. Settlement remains possible for reconciliation.
   Extraction caches replay without dispatch. The CLI uses fresh output directories
   and does not silently resume partially executed P stores. Smoke consumes the
   pilot allowance when a journal is shared.
9. **Supervision.** Dispatch timeout and no-progress/failure stops are implemented;
   the CLI is attended. There is no separate unattended agent monitoring or
   notification service, and none is promised.

## Delivered files

The following **27** paths are relative to `evaluation/hr3/harness/`. They were
cross-checked using Git's scoped tracked/untracked enumeration and an independent
recursive filesystem walk. `freeze.json` records hashes excluding itself.

```text
README.md
REPORT.md
artifacts.mjs
cli.mjs
common.mjs
dependencies.mjs
extraction.mjs
freeze.json
inputs.mjs
ledger.mjs
pin.mjs
product-pin.json
product.mjs
requests.mjs
research.mjs
runner.mjs
schema.mjs
test.mjs
test/extraction.test.mjs
test/fixtures.mjs
test/ledger.test.mjs
test/product.test.mjs
test/references.json
test/research.test.mjs
test/runner.test.mjs
transport.d.ts
transport.mjs
```
