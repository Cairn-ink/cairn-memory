# Bounded source-aware recall candidates

Fixed base: `bebc6f600748f9414fb5bad3ddb7fe2ee0dceb8a` (reviewed PR #191).
Branch: `fix/source-aware-candidates`.

This is an offline implementation slice. It authorizes no production data,
provider call, network fallback, paid experiment, merge, release or deployment.
It improves bounded literal reachability for explicit source contexts; it does
not demonstrate semantic quality, answer accuracy or complete source coverage.

## Acceptance contract

- **SC1 — Synthetic reachability RED/GREEN.** Before runtime changes, a fresh
  synthetic 224-memory test must fail because a target whose generated body has
  no query token is absent from two actual private candidate pages despite an
  exact token in its retained receipt. Higher-scoring body decoys establish the
  miss. The body-only control remains unchanged. After implementation, explicit
  `source-evidence` and `rationale-evidence` recalls expose the target to select
  with the exact receipt-derived 120-code-point query preview and permit the
  scripted selector/ranker to return its exact retained source. Public fixtures
  contain no benchmark corpus, target label or real identifier.
- **SC2 — Explicit modes only.** Source-aware private navigation applies only
  when `contextMode` is explicitly `source-evidence` or `rationale-evidence`.
  Ordinary/default recall, public map and classification, body-only direct
  runtime calls, and automatic rationale discovery keep their frozen behavior
  and scores. Preserve two select calls, 100 items and 4,000 tokens per page,
  12 refs per namespace, 24/36 selection limits, existing fetch/rank caps, and
  existing small-complete-store behavior. Any tokenizer integration belongs in
  the existing evaluation/live diagnostic path, not direct dependency-free core
  tests.
- **SC3 — Authority and freshness.** Check exact namespace, current lifecycle
  state and published projection membership before reading candidate receipts.
  Never read foreign, historical, forgotten, staged or raw transcript content.
  Correction, forgetting, receipt attachment, filing and rebuild races must fail
  closed through the existing epoch/revision/final-snapshot fences, including
  unselected candidates and empty selection. A mutation after a model request
  begins cannot retract text already sent, but it must prevent later model use or
  finalization. Document that explicit source-mode navigation can expose bounded
  retained source previews to the supplied model.
- **SC4 — Hard bounds and deterministic labels.** Scan at most 1,024 current
  memory rows. For each eligible projected memory, retrieve at most four
  receipt rows internally, in stable receipt-ID order, using the existing
  `(memory_id,id)` index. The current-memory scan still returns at most 1,024
  rows plus one memory sentinel, and projection-rejected rows consume that
  allowance. SQLite returns and core scores at most 4,096 receipt excerpts,
  each already bounded to 800 UTF-16 units; this is not provider output. Before
  scoring or preview, validate each row's ID, memory binding, source identifiers,
  role, canonical excerpt and receipt key through the authoritative per-receipt
  validator shared with complete source output. Corrupted, malformed or
  over-limit persisted rows fail closed before selection rather than being
  truncated. Candidate score is the maximum of body and receipt literal-overlap
  scores. Use the strictly highest-scoring receipt's existing 120-code-point
  query excerpt only
  when it exceeds the body score; receipt ties choose the first stable ID.
  Otherwise preserve the body label. A match beyond receipt four remains a
  documented retained heuristic miss. Preserve existing map/reference and fetch
  exhaustion: bounded score inputs neither claim complete sources nor make a
  complete small map incomplete, and `bounded-source-scan` retains its complete-
  map fast path. SQL `EXPLAIN` must show the existing indexed lookup. These are
  returned-row and scored-byte bounds, not total SQLite I/O or latency claims.
- **SC5 — Policy separation and callback safety.** Source-aware cursor/cache
  bindings include the source policy version and receipt score/read limits,
  separately from body-only bindings, along with query, namespace and epoch.
  Reject stale, cross-mode, public and forged cursors; do not emit repeated empty
  continuations. No injected model, token counter or user callback executes in a
  database transaction. Internal pure score/label helpers may execute there. No
  schema, public/core response shape, prompt, dependency, provider method or
  provider guard changes are allowed.
- **SC6 — Frozen evidence.** Preserve historical tests, public artifacts and
  exact body-only scores. The preprojection ordinal counterfactual is post-hoc
  development diagnosis, not page-visibility proof. After synthetic gates, an
  actual-core probe over an already exposed copied store may establish bounded
  page visibility only; it remains development evidence, not a new scored
  holdout or proof of semantic selection/answer quality.
- **SC7 — Verification and delivery.** Primary owns the full Node 22.16/24.15
  generic, JSON/plugin, core/store/MOC/recall/continuation/source/history/capture,
  live-offline/OpenAI/MCP/artifact-install gates, independent Standards and Spec
  reviews on one final commit, exact-head remote CI, commit/push/PR and delivery.
  This worker stops at a code freeze with focused synthetic RED/GREEN evidence
  and no commit or push.

## Ownership and caller audit

| Area / caller | Owner | Required evidence |
| --- | --- | --- |
| `core/query-candidates.mjs`, `core/moc-storage.mjs`, `core/contract.mjs`, focused tests and scoped docs | Implementation worker, Sol high | Actual synthetic RED before runtime diff; focused GREEN; final diff/status checkpoint |
| Explicit `recall` source contexts | Implementation worker; primary accepts | Both source modes bind and use source policy; body-only/default control is byte-for-byte behavior-compatible in focused assertions |
| Public `map`, classification catalog, automatic rationale `discoverRationale`, direct `runtime.queryCandidateRows` | Implementation worker audits; primary accepts | Existing tests plus focused controls prove no source policy reaches these callers |
| Fetch/rank/final snapshot and lifecycle races | Existing owners unchanged; implementation worker integrates | No new calls or shapes; existing epoch/revision fences plus focused correction/forget/attachment/filing/rebuild cases |
| Existing evaluation/live tokenizer diagnostic | Implementation worker integrates; primary accepts | Reuse the existing harness only; no second harness or dependency in core tests |
| Full gates, candidate commit, independent review, push and PR | Primary agent | Exact commands/results and final SHA in PR evidence |

Implementation assignment: bounded shared-core source-aware candidate packet,
requested/actual worker model `gpt-5.6-sol`, reasoning effort `high`. Base and
candidate token/cost measurements are unavailable and are not inferred. The
primary agent retains design acceptance, integration inspection and verification
ownership. No ownership fallback or correction round has occurred at plan time.

## Planned implementation boundary

Allowed files are `core/query-candidates.mjs`, `core/moc-storage.mjs`,
`core/contract.mjs`, focused query/source-candidate tests, an existing
evaluation/live MOC-retrieval diagnostic test or harness only if required for a
real local tokenizer probe, this plan, `docs/protocol.md`,
`docs/limitations.md`, and `CHANGELOG.md`. No storage migration, second engine,
new dependency, prompt/schema/guard change, public fixture corpus or product
identifier is in scope. A missing freshness or projection guarantee is a design
blocker to report before widening this boundary.

The primary accepted the first independent Spec finding and authorized the
bounded correction to `core/source-evidence.mjs` and `core/runtime.mjs`: extract
the existing pure authoritative per-receipt validator, inject the runtime's
existing receipt-key function into candidate storage, and apply that validator
before scoring. No fake partial source count/projection or new injected model,
token-counter or user callback is permitted.

## Implementation evidence before primary gates

The implementation worker first ran the named SC1 224-memory test against the
unchanged runtime. Body-only recall made two select calls and did not expose the
receipt-only target; source mode failed at the expected missing-preview
assertion. After the scoped runtime change, that same test passed.

Focused core evidence passed 61 tests covering query candidates, internal
source cursor bindings, bounded complete-map source selection, automatic
rationale discovery and source-context finalization. It includes both explicit
source modes; filed, misfiled and unfiled targets; multiple targets; positive
body/receipt and receipt/receipt ties; 120-code-point Unicode labels; the
1,024-memory plus sentinel scan; 4,096 returned/scored receipt rows; malformed
source rejection; the existing receipt-index query plan; first-four/fifth-source
behavior; and attach, rebuild, correction, filing and forgetting races across
counter/select/rank boundaries. Poisoned foreign, historical, forgotten and
projection-ineligible receipts remain unread in both source modes, and legacy
correction/forgetting paths retain the same epoch fence. No model/provider
request occurred.

The existing MOC retrieval diagnostic passed its three tests with 11 synthetic
cases using the installed adapter's pinned local `o200k_base` counter. Its new
receipt-only late target was visible and recalled while body-only FTS did not
match it. The diagnostic made zero provider requests and is repeatable offline;
it is page-reachability and envelope evidence, not provider accounting or
semantic quality.

The primary's actual-core development replay over unchanged already exposed
copied stores found one prior two-page miss on the first candidate page and
preserved two targets that were already visible. A target-visibility oracle
could fetch, rank and finalize those visible records; an empty selector still
returned none. This is post-hoc page-reachability evidence only, not model
selection, answer quality or a new scored holdout. Primary full gates, final
candidate SHA and independent reviews remain primary-owned.

Primary supervision tightened five acceptance preconditions during the worker
slice: the internal receipt-limit argument now accepts exactly zero or four;
the tie test includes a positive nonzero body/receipt tie; privacy docs separate
the internal four-excerpt read bound from the one winning preview sent per packed
candidate; the fifth-receipt complete-map test rewrites synthetic receipt IDs and
asserts their exact stable order; and source-mode exclusion plus legacy-mutation
controls explicitly cover the new read path. Each correction passed on its first
focused rerun. There was no repeated-defect escalation, ownership fallback or
primary code takeover. Worker token and cost telemetry were unavailable and are
not inferred.

The first independent Spec review then found that source candidate scoring had
validated excerpt shape but not the authoritative receipt identity/key before a
preview could reach selection. A synthetic RED altered well-formed receipt
fields without updating the key and observed a successful empty selection. The
shared per-receipt validation correction now rejects altered excerpt, valid role,
valid source identifier and receipt-key cases in both explicit source modes
before any model callback. This is correction round one for that distinct
finding; it does not change the score, caps, coverage or final source projection.
