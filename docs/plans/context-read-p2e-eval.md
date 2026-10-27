# P2e retrieval evaluation: E.10, Revision 1

This packet implements the offline evaluation infrastructure for `P2e-product-retrieval-v1`, Revision 1. It follows E.9/E.10 and the P2e Revision 1 changelog in [the contract](context-read-product.md). Base engine commit: `8cd10f9c87b885ba88c16a153a403f641853173e`.

Status: **blocked_dependency**. The actual public product reader reports semantic unsupported, and the public semantic coordinator export is absent. No fixture retrieval, hosted adapter construction, network request, key use, model invocation, timing measurement or commit was performed. The supplied fake report records every registered stratum and safety cell as unrun. It is not retrieval quality evidence or enablement acceptance.

## Frozen fixtures and counts

`evaluation/context-read-p2e/fixtures.mjs` contains the authored text and deterministic recipe, seed `0x50e2026`. No conversations or model-generated fixture text are used. The 40 object terms and 20 locations define 800 distinct storage facts. Canonical text alternates English and Chinese, giving 400 facts in each direction. English aliases form the paraphrases; validation applies the engine's frozen T1 tokenizer to every gold query/document pair and requires an empty token intersection. This includes relevant Cards and their identifier lines.

The four namespaces are personal and projects 1–3, all belonging to one synthetic owner. Every world has a balanced distribution:

| World | Memories | Cards in v23/v33 | Memories per namespace | Cards per namespace |
| --- | ---: | ---: | ---: | ---: |
| Small | 1,112 | 128 | 278 | 32 |
| Large | 3,336 | 384 | 834 | 96 |

The large world contains the small world. There are 3,720 frozen document records in total. Cards duplicate the corresponding Memory text in a different namespace; they remain separate relevant typed identities. Confirmed Cards register canonical revision 2/body revision 1. Non-target Memories are unrelated seeded inventory records, including the separate `中` → `中文` known-miss control. There are 312/2,536 non-target Memories in the small/large worlds.

Queries are frozen once and reused across world/schema/intent configurations:

| Query language | Positive | Negative | Separate single-Han control |
| --- | ---: | ---: | ---: |
| zh | 2,450 | 80 | 1 |
| en | 1,650 | 80 | 0 |
| ja | 1,650 | 70 | 0 |
| mixed zh/en | 1,650 | 70 | 0 |
| Total | 7,400 | 300 | 1 |

There are **7,701 frozen queries**, **48 disjoint primary strata** (`2 worlds × 3 physical schemas × 2 intents × 4 languages`) and **92,412 scheduled pairs**: 88,800 positives, 3,600 negatives and 12 control observations. v18 uses Memory only; v23 and v33 use Memory+Card. All use the full four-namespace readSet and `current`/`history` separately. Negative queries have an absent semantic fact key; every positive has nonempty gold relevance.

| Challenge mask | Positive query IDs before configuration reuse | Negative IDs | Independent fact cases |
| --- | ---: | ---: | ---: |
| zh query → en canonical text | 400 | 10 | 400 |
| en query → zh canonical text | 400 | 10 | 400 |
| Equal-weight cross-language aggregate | 800 | 20 | 800 |
| Empty-T1-intersection paraphrase | 800 | 10 | 800 |
| Short CJK, zh/ja | 1,600 | 20 | 800 |
| Code-switching | 800 | 10 | 800 |
| Exact identifiers | 3,200 | 200 | 800 |
| Each path/SHA/error/flag category | 800 | 40 | 200 |
| Baseline exact terms | 600 | 40 | 425 |

Each identifier category has 200 positives per language. Short queries contain 2–4 Han Unicode scalars; Japanese baseline questions also contain Japanese grammar. Each code-switch query contains Chinese and English. Direction-specific cross-language positives label canonical text in the opposite language. Paraphrase can overlap the en→zh mask. The equal-weight aggregate has its own critical gate.

The inventory freezes each applicable challenge × world/schema/intent slice, each identifier category and the empty language intersections. There are **192 registered metric strata** altogether. Every primary cell and every registered challenge/slice has at least 50 positives and 10 negatives. Membership is frozen before observation; masks do not add weight to the primary macro score.

Gold labels are a relational join: match a query's authored fact key to documents, then filter by minimum world, type and eligible intent. `labels.json` freezes the resulting identity lists. Loading fixtures independently recomputes their recipe and labels, checks the T1 oracle, and checks membership constraints. The runner also checks the actual physical schema, canonical population, namespace, revision and text bytes through an independent read-only canonical inventory. Gold never comes from provider output or retrieved rankings.

### Count justification and power

For an illustrative paired binary recall outcome with true difference `d=.05` and discordance `q`, use `Var(B−A)=q−d²`, two-sided normal critical value 1.959964, and reject zero difference beyond `1.959964*sqrt(q/n)`. This estimates detection power, **not the probability of meeting an observed ≥5-pp gate exactly at a true 5-pp effect**.

| Independent cases | Power at q=.10 | Power at q=.20 |
| ---: | ---: | ---: |
| 200 | 61.0% | 35.2% |
| 400 | 88.8% | 60.9% |
| 800 | 99.4% | 88.7% |

Thus the two critical directions have 400 distinct cases each, exceeding the approximate 314 cases needed for 80% power at q=.10. The critical paraphrase mask has 800. Identifier categories have 200 distinct cases: enough for a paired percentile interval with a useful discrete resolution, while their point difference must be nonnegative regardless of that interval. They do not claim 80% power for +5 pp. Primary cells have 1,650–2,450 positive queries, exceeding the contract's 50-query floor; the baseline mask has 600 query IDs over 425 fact cases. The single-Han control intentionally has one authored case and is excluded from positive macro denominators.

These calculations condition on query-level independence and the assumed discordance. Shared vocabulary, multiple language views and a compositional corpus can reduce effective power. Configuration reuse is not new independent evidence: aggregate reports first average each reused query ID across configurations, then bootstrap those paired query means. The supplied E.10 procedure resamples queries, not independent arms. No real-corpus generalization is claimed.

## Sealed registration and analysis

`evaluation/context-read-p2e/registration.json` is sealed with SHA-256 over canonical sorted-key JSON excluding the seal itself. It hashes all five fixture JSON files and the evaluation/authoring/runner source files. This is an integrity seal for review, not a signature or permission to transmit.

Seal: `5fd4756ea6d295727b00301b8e9769f9c073df51bb05c73bd5b4f0ff11d26928`; **22 registered input files**. Engine commit, provider identity, host binding hash, hosted authorization and accepted fake-safety evidence hash are explicit unresolved placeholders. A blocked fake probe is permitted with these placeholders; a hosted execution refuses them. Changing a corpus, rule, identity or procedure requires a new reviewed registration and preservation of preceding reports.

The registration fixes:

- Binary typed-identity recall@5, recall@12 and nDCG@12; DCG discount `1/log2(rank+1)` and ideal eligible top-12 normalization.
- Equal query means within the 48 primary cells, followed by an equal mean of cells. Negatives and the separately reported known miss are excluded from those positive denominators.
- 10,000 paired resamples, seed `p2e-e10-sealed-2026-10-28`, versioned xorshift32 stream derived by SHA-256 from seed/stratum/metric, and linearly interpolated 2.5%/97.5% percentiles. Draws are retained in the machine report. The cross-language aggregate combines equally weighted direction-stratified draws.
- Unrounded recall gain ≥.02 macro; ≥.05 for each cross-language direction, their equal-weight aggregate and paraphrase; no registered stratum below `-max(max(abs(delta-L),abs(U-delta)),.01)`; exact identifier aggregate/categories/slices ≥0; macro nDCG difference ≥0. Equality passes the respective boundary.
- All 101 safety cells must pass with zero violations. A fake provider can only produce fake correctness evidence. Missing E.8/E.9 acceptance leaves enablement pending even if the retrieval component passes. The staging added-p95 ≤150-ms gate remains an external E.9 requirement; this packet runs no timing series.

The report retains both arms, order, exact refs/ranks and channel diagnostics; verified evidence text is represented by hashes. It includes per-query metric changes/misses, negative outputs, the known miss, per-stratum metrics/CIs/draws, every safety cell and a short summary. Missing/degraded/unknown/stale observations remain recorded and prevent a pass. Console output contains counts, cost and status; it never dumps the corpus.

## Public reader and dependency boundary

`tools/testing/p2e-product.mjs` creates a disposable canonical store through `openMemoryCore`, opens `openContextProductReader`, and probes `getContextReadCapabilities`. It closes and supervises disposal before removing scratch. It also checks the public coordinator export: omission of semanticConfig must retain the old capability envelope even after P2e lands. A selected handle is probed again before retrieval.

Once the semantic API exists, a **reviewed, hash-bound host binding is still required**. It supplies public canonical setup and maintenance, semantic coordinator/ledger/price authority wiring, credentials, fresh reader constructor options and fixture→canonical typed-ref mappings. It cannot supply rankings. The runner opens the public product reader itself and calls `findCandidates` for A (`semantic:false`) and B (`semantic:true`), followed by public exact-evidence refetch. It checks complete hybrid coverage, exactly one query attempt, provider identity, `rrf-k10`, and evidence bytes. Execution order counterbalances by global query ordinal. There is no legacy reader fallback, host ranking/fusion or stub engine path.

The binding module exports `providerIdentity` and `prepare({fixture,labels,provider,registration,cost})`. Preparation returns `prepareCell(cell)` and `close()`. Each cell supplies `canonicalPath`, `identities:[{fixtureId,ref}]`, `credential`, `readerOptions(cell,semantic)` and `close()`. Constructor options must be fresh per call. The independent canonical check enforces physical v18/v23/v33 and the actual world counts. Host/runtime factory wiring must keep provider credentials in the supervised service closure, following E.2; this packet supplies no real credential or ledger authority implementation.

Fake safety setup additionally exposes `prepareSafetyCell(id)`. Its methods are consumed by `tools/testing/p2e-safety.mjs`; public candidate/assembly/evidence envelopes are captured inside the runner, not accepted as a precomputed pass. Setup coordinates public canonical mutations, deterministic rendezvous, fresh/restarted readers, credentials, canary-ref mappings, semantic-call counters and independent offline inventories. An unavailable setup stays incomplete.

The 101 cells comprise 96 mutation cells (`forget/correct/supersede/item-purge × preparation/embedding/final-refetch × fresh/restarted × Memory/Card × current/history`), two scope-canary cells, candidate/assembly lexical-envelope equality, and an all-catalog owner-vector purge. Qualified history remains independently eligible. Scope comparisons include complete envelopes/counts/private metadata. Only frozen existing timing fields are normalized for lexical equality; semantic traces, refs, snapshots, accounting and bodies are compared. Purge uses the public coordinator off switch and bounded public purge quanta, checks all identities/intents/types/staging/obsolete generations independently, preserves another owner's canary vectors and checks canonical lexical preservation. A live process or an asserted purge status is insufficient.

Hosted quality does not repeat fake mutation transmissions. Before provider construction it requires a separately reviewed fake safety report pinned by hash, the same engine commit and frozen safety fixture hash. All 101 cells are rescored from that report's retained evidence. Missing or failing safety evidence refuses the hosted run.

## Commands and actual verification

Node executables were invoked by explicit version paths. Below, `NVM_DIR` denotes the existing installation root; no machine-specific path is committed.

```sh
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v22.16.0/bin/node" tools/testing/run.mjs tools/testing/p2e-eval.test.mjs
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs tools/testing/p2e-eval.test.mjs
```

Final Node 22.16.0: **11 tests passed, exit 0**. Node 24.15.0: **11 tests passed, exit 0**. The tests install network and hosted-module-import denial before execution. They cover independent arithmetic answers and cutoffs, seed reproducibility/paired draws, all exact decision boundaries, safety violations/missing cells, purge residuals and other-owner preservation, seal/input refusal, cost arithmetic/cap equality, provider flag/key/test guards, the actual public dependency probe, missing observations and unequal primary-stratum weighting.

An earlier Node 22 run exited 1 because missing direction strata threw during analysis; the missing-stratum handling was corrected and the entire suite rerun. An initial offline tokenizer attempt also exited 1 because the Python cache lacked cl100k_base; the vocabulary was recovered from an already cached package and checked against its official SHA-256 `223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7`. No download occurred.

Authoring/check commands, all **exit 0** on the final inputs:

```sh
"$NVM_DIR/versions/node/v24.15.0/bin/node" evaluation/context-read-p2e/fixtures.mjs --write
# P2E_TOKEN_CACHE is an existing offline tiktoken cache, supplied by the operator.
TIKTOKEN_CACHE_DIR="$P2E_TOKEN_CACHE" python3 tools/testing/p2e-token-count.py --verify
"$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/p2e-seal.mjs --write
```

The tokenizer script denies network and fails on a missing cached vocabulary. It records `cl100k_base`, the installed tokenizer version, a vocabulary digest and per-input SHA-256/counts. Normal Node tests and estimates read the sealed token table without importing a tokenizer package. The authoring `--write` commands are not part of a run and must not be used to repair a mismatch after observing quality results.

Fake probe and machine report:

```sh
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" evaluation/context-read-p2e/runner.mjs \
  --provider fake --report evaluation/context-read-p2e/reports/fake-blocked.json
```

Expected and observed outcome: **blocked_dependency, exit 2**. No retrieval scores or safety passes are invented. Exit 1 denotes refusal/incomplete/failed acceptance; exit 0 denotes an offline estimate or successful hosted retrieval component, with enablement reported separately.

## Hosted cost and future invocation

`--price-usd-per-million` has no default. Let its supplied decimal value be R. All frozen inputs contain **3,727 document texts / 156,057 tokens** and **7,702 query texts / 112,340 tokens**. These totals include the separate fake-only safety inventory: **7 canary documents / 62 tokens**, plus the frozen `cedar key copper token` query (**5 tokens**). Public safety reads force this frozen query. The quality corpus alone contains **155,995 document tokens** and **112,335 query tokens**. Safety inputs are counted but are not scheduled for hosted transmission.

The full conservative hosted quality schedule repeats refresh per world/schema/intent (language cells share a projection) and includes one B embedding for every scheduled quality query, including negatives/control:

| Population | Embedding inputs | Exact cl100k_base tokens | Conservative UTF-8-byte+16 token bounds |
| --- | ---: | ---: | ---: |
| Refresh | 28,736 | 1,353,058 | 4,168,100 |
| Query | 92,412 | 1,348,020 | 4,690,908 |
| Total | 121,148 | 2,701,078 | 8,859,008 |

The expected embedding charge is approximately **2.701078 × R USD**. The pre-transmission admission cap uses the larger bound, approximately **8.859008 × R USD**, with each singleton reservation rounded upward to integer trillionths of USD. This is a deliberately conservative reservation, not an assertion that the provider bills UTF-8 bytes. No cache savings across intents/schemas, retries, answer model, timing workload or hosted safety work is assumed. The runtime guard checks every transmitted string against the sealed inputs, retains failed/unknown exposure and refuses further sends at the request/USD cap. Unregistered engine embedding representations must be registered and recounted before transmission.

The checked example uses **R=1 solely as an arithmetic example**, not a provider price:

```sh
"$NVM_DIR/versions/node/v24.15.0/bin/node" evaluation/context-read-p2e/runner.mjs \
  --estimate --price-usd-per-million 1 --max-usd 100 \
  --report evaluation/context-read-p2e/reports/cost-example.json
```

Result: expected **$2.701078**, reservation **$8.859008**, **exit 0**. The same command with `--max-usd 0` refuses before capability probing or provider construction, **exit 1**. Equality with the reservation passes. Actual provider rates, engine daily/lifetime/quantum limits and run authorization must all be supplied independently; this estimate does not authorize a run or relax an engine allowance.

For a future hosted run, copy the template to a new reviewed draft, bind the engine commit, exact provider identity, host binding SHA-256, accepted fake safety report SHA-256 and an authorization object. The authorization supplies `id`, `maxUsd`, `priceUsdPerMillion`, `maxRequests`, UTC `fromUtcMs`/`untilUtcMs`, `privacySurface`, and `syntheticInputsDigest` (the registration module's canonical digest of `files`). It must identify the permitted normal query/refresh schedule and provide separate owner approval. Preserve the previous registration/report.

```sh
"$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/p2e-seal.mjs \
  --seal-draft registration-draft.json --out registration-run.json

# Future command only. The key must already be injected by the authorized host.
"$NVM_DIR/versions/node/v24.15.0/bin/node" evaluation/context-read-p2e/runner.mjs \
  --provider hosted --registration registration-run.json --binding reviewed-binding.mjs \
  --safety-report accepted-fake-report.json --authorization-id APPROVED_RUN_ID \
  --price-usd-per-million "$P2E_PRICE" --max-usd "$P2E_MAX_USD" \
  --report hosted-report.json
```

The hosted constructor is dynamically imported only after the explicit flag, key, sealed inputs/identity/authorization, public capability, cost cap and safety-evidence checks. Environment presence alone selects nothing; tests reject hosted construction even with a synthetic credential marker. No hosted command above was executed. Engine/host binding integration remains a dependency to complete when the public P2e API lands; no unsupported internal seam is substituted. Any later expensive run also needs the authorized owner's active supervision and reporting arrangement; these files create no unattended monitor.

## Changed-file cross-check

Both independent inventories agree on **27 changed files**: Git `diff --name-only HEAD` plus untracked enumeration, versus a full HEAD tree and independent disk Git-blob/mode comparison (including docs/config/public paths). `python3 tools/testing/p2e-manifest.py` exits **0** and prints the count and complete sorted list. No `core/` file changed. No commit was created.

```sh
python3 tools/testing/p2e-manifest.py
git diff --check
```

Final inventory and whitespace checks: **exit 0**. The additional whitespace check reads every changed file, including untracked files, and requires a final newline and no trailing whitespace.

- `docs/plans/context-read-p2e-eval.md`
- `evaluation/context-read-p2e/analysis.mjs`
- `evaluation/context-read-p2e/cost.mjs`
- `evaluation/context-read-p2e/fixtures.mjs`
- `evaluation/context-read-p2e/fixtures/corpus-queries.json`
- `evaluation/context-read-p2e/fixtures/inventory.json`
- `evaluation/context-read-p2e/fixtures/labels.json`
- `evaluation/context-read-p2e/fixtures/safety.json`
- `evaluation/context-read-p2e/fixtures/tokens.json`
- `evaluation/context-read-p2e/inventory.mjs`
- `evaluation/context-read-p2e/providers.mjs`
- `evaluation/context-read-p2e/registration.json`
- `evaluation/context-read-p2e/registration.mjs`
- `evaluation/context-read-p2e/reports/cost-example.json`
- `evaluation/context-read-p2e/reports/fake-blocked.json`
- `evaluation/context-read-p2e/runner.mjs`
- `evaluation/context-read-p2e/safety.mjs`
- `evaluation/context-read-p2e/statistics.mjs`
- `tools/testing/p2e-canonical.mjs`
- `tools/testing/p2e-eval.test.mjs`
- `tools/testing/p2e-manifest.py`
- `tools/testing/p2e-offline.mjs`
- `tools/testing/p2e-probe-host.mjs`
- `tools/testing/p2e-product.mjs`
- `tools/testing/p2e-safety.mjs`
- `tools/testing/p2e-seal.mjs`
- `tools/testing/p2e-token-count.py`

## Fix round 1

This revision addresses all seven P1 and three P2 findings against `8f674480`. The counts, seal, cost example and admission/safety contracts below supersede the initial packet above. No provider network call, real credential, hosted adapter construction, core runtime edit or commit was made.

### Findings, fixes and regressions

The ten `fix1` tests in `tools/testing/p2e-fix1.test.mjs` each fail on the original revision. They cover both acceptance and refusal where applicable; the original offline suite remains in place.

| Finding | Fix | Regression |
| --- | --- | --- |
| Method P1: ambiguous gold | Review the entire authored noun/place vocabulary for compatible meanings, narrow 18 broad English aliases, and resolve every query surface independently of `query.fact`. Expand shared surface meanings to every compatible concept before joining eligible typed identities. Run this audit during fixture validation. | `fix1 gold`: all-query audit, original percussion and brewing aliases, and a negative query changed to a valid positive surface. |
| Method P1: scope surfaces | Capture with/without-canary complete envelopes separately for candidates, assembly, exact evidence and private metadata. Preserve `diagnostics.omitted` and normalize only the existing timing fields. Evidence requires an actual nonempty refetch input. | `fix1 scope`: independently change omitted counts on each surface; missing comparisons refuse; fake public handles verify two actual evidence reads and an assembly-only leak. |
| Method P1: mutation setup/boundary | Reset each surface; capture a semantic initial candidate hit and exact matching evidence bytes. Require configured capability, complete hybrid traces, one query embedding attempt and independently counted fake-provider calls before and at the boundary. Refetch the original target refs at the evidence boundary. Read and refetch the qualified history control separately. Missing observations are incomplete. | `fix1 mutation`: empty lexical-fallback receipts, missing target/bytes/calls/history all refuse. A fake public reader exercises collection, nested assembly trace and stale-ref evidence; incomplete setup remains incomplete. |
| Method P2: dependent power | Expand from 40 to 240 authored nouns while retaining 20 locations; report within-noun and repeated-view design effects and power at two discordances. | `fix1 power`: old effective power below 50%, new vocabulary count, all declared correlation/discordance combinations at least 80%, and the sensitivity failure beyond that range. |
| Standards P1: persistent run cap | Use one durable SQLite allowance keyed by authorization ID. `BEGIN IMMEDIATE` serializes reservations across processes; synchronous commit precedes dispatch. Bind the identity to its immutable policy and input counts. Unique reservation nonces reject replay; there is no refund for failed/unknown transmissions. | `fix1 cap`: two guards, restart, replay, policy rebinding and eight concurrent processes competing for exactly three admissions. |
| Standards P1: authorization window | Require finite safe integer start/end timestamps and an ordered interval. Check the inclusive start/exclusive end at construction and on every reservation, including after lock acquisition before commit. The guard runs in the adapter's actual pre-dispatch callback. | `fix1 window`: missing fields, NaN, reversed/future windows, expiry after construction exact endpoints, and caller mutation of the grant. |
| Standards P1: incomplete registration | Independently enumerate all evaluation/authoring modules and require all five fixture resources, including corpus, labels and inventory. Metrics, bootstrap and decision rules must exactly match the protocol. Recompute the inventory from the validated recipe and compare full membership before sealing and on every run. | `fix1 seal`: corpus-only registration, omission of every manifest entry, and a freshly hashed/resealed inventory with the losing short-CJK strata removed, at both seal and verification. |
| Standards P1: nested refs | Inspect each typed-reference object itself recursively; its property name does not determine whether it is checked. Unknown refs also refuse a safety pass. | `fix1 inspector`: diagnostics, arrays, `memoryRef`, nested `ref` and unknown references. |
| Standards P2: capability credential | Selected quality and safety handles call `getContextReadCapabilities({}, credential)`. The unconfigured public dependency probe retains its existing call contract. | `fix1 capability`: strict fake capability implementation checks the options and exact credential. |
| Standards P2: raw-fd coverage | Include every evaluation module and all `p2e-*.mjs` tools outside test files in the existing raw-fd tripwire, with exact justified filesystem sites. Canonical and admission database operations use SQLite. | `fix1 raw-fd`: execute the guard's actual path selection, assert evaluation/tool coverage, then inject a raw open into every selected source and require rejection. The complete existing guard suite also runs. |

The report's trailing blank line was removed. `git diff --check` now exits 0.

### Gold audit and revised population

The audit uses the complete finite authored vocabulary: full language-specific noun/location surfaces, English descriptions, the explicit compatibility lists for broad legacy descriptions, and exact identifiers. It constructs possible concept pairs without consulting the query's fact label, then compares all eligible Memory/Card identities against every frozen label row. Negative queries are resolved by the same text procedure. This is an exhaustive audit of this authored vocabulary, not a general natural-language entailment engine.

Applied to the original 7,701 queries and their original configurations, the audit found **100 query IDs / 1,200 label comparisons** needing broader gold or disambiguation. The broad descriptions were conservatively narrowed. During expansion it also caught a shared CJK bonnet/turban surface (**10 query IDs / 120 comparisons**); that surface was disambiguated before writing fixtures. The final audit checks **43,701 queries / 524,412 comparisons**, with **zero mismatches**. No semantic query or stratum was removed to resolve an ambiguity; identifier category membership was revised before observation as described below. Both the existing drum and bell IDs remain stable.

| Population | Revised count |
| --- | ---: |
| Authored nouns × locations | 240 × 20 |
| Distinct positive facts | 4,800 |
| Small/large Memory worlds | 6,672 / 20,016 |
| Small/large Cards | 128 / 384 |
| Frozen document records | 20,400 |
| zh / en / ja / mixed positive queries | 14,450 / 9,650 / 9,650 / 9,650 |
| Positive / negative / control query IDs | 43,400 / 300 / 1 |
| Primary / metric strata | 48 / 192 |
| Scheduled positive / negative / control pairs | 520,800 / 3,600 / 12 |
| Each cross-language direction | 2,400 facts |
| Paraphrase | 4,800 facts |
| Short CJK | 9,600 query IDs over 4,800 facts |
| Code-switch | 4,800 query IDs |
| Exact identifiers | 19,200 query IDs; 4,800 per category over 1,200 facts |
| Baseline | 2,600 query IDs over 2,425 facts |
| Safety cells | 101 |

Each world remains evenly distributed over four namespaces (1,668/5,004 Memories and 32/96 Cards per namespace). The original 800 facts retain their noun/location identities; identifier categories are repartitioned before observation. Every registered stratum retains its positive/negative minima. The frozen token table now has **63,480 unique inputs**.

### Dependence sensitivity and sample-size conclusion

Use the same paired binary normal approximation with true gain `.05`, discordance `q`, variance `(q-.05²)/n_eff`, and a two-sided critical value `1.959963984540054*sqrt(q/n_eff)`. Use the conservative additive design effect

`D = 1 + (m_noun-1)*rho_noun + (m_view-1)*rho_view`, and `n_eff = n/D`.

A direction has ten locations per noun and one query view (`m_noun=10`, `m_view=1`). For the 4,800-fact semantic set, use twenty locations per noun and additionally allow four repeated language views (`m_noun=20`, `m_view=4`), without counting those extra views as new independent cases. This intentionally charges overlapping noun/view dependence twice. Configuration reuse contributes no independent n. The table varies both correlations together; unequal combinations within the stated range have no larger design effect.

| Correlation rho | Direction n_eff | Direction power q=.10 / .20 | Semantic set n_eff | Semantic set power q=.10 / .20 |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 2,400.0 | 100.0% / 100.0% | 4,800.0 | 100.0% / 100.0% |
| .10 | 1,263.2 | 100.0% / 97.9% | 1,500.0 | 100.0% / 99.1% |
| .20 | 857.1 | 99.7% / 90.7% | 888.9 | 99.7% / 91.7% |
| .30 | 648.6 | 98.2% / 81.4% | 631.6 | 97.9% / 80.4% |
| .40 | 521.7 | 95.3% / 72.5% | 489.8 | 94.0% / 69.8% |

The original direction count, 400 with ten locations per noun and rho=.20, gives **n_eff=142.9 and power=47.2%** at q=.10. It did not support the original independent-case conclusion. Adding locations alone cannot solve that problem: with 40 nouns, the effective count approaches only `40/rho` per direction. Increasing independent noun concepts is necessary.

The new counts meet 80% illustrative detection power for +5 pp throughout the declared plausible sensitivity range `rho_noun,rho_view ∈ [0,.30]` and `q ∈ [.10,.20]`. The .30 endpoint deliberately exceeds the review's .20 example. This remains a conditional design calculation, not an estimated correlation or a guarantee: .40 with q=.20 falls below 80%; stronger cross-noun or domain dependence can also reduce power. It does not claim an 80% probability of meeting the observed ≥5-pp gate at an exactly 5-pp true effect, nor real-corpus generalization. Query-paired bootstrap intervals retain their preregistered interpretation; this sensitivity analysis does not silently turn them into cluster-robust intervals. Independent Python `erf` calculations agree with the implementation's power values to better than `1e-7`.

### Seal, cost and binding contract

The revised seal is `89e384bcee492e4108f0906a7346e3ad8897c2ee7a5b388a21f6252e40ef119b`, covering **22 input files**, including the scorer, inventory, metrics, bootstrap implementation, decision protocol, authoring tools and five frozen resources. Old quality registrations and fake safety evidence require new review; missing setup remains incomplete.

The expanded quality schedule has **162,176 refresh inputs / 7,395,568 tokens** and **524,412 query inputs / 7,948,452 tokens**: **686,588 inputs / 15,344,020 tokens** altogether. Its conservative reservation is **50,355,332 byte+16 token bounds**. At the arithmetic example R=1, expected cost is **$15.344020**, reservation **$50.355332**. Quality document/query tables contain **787,562 / 662,371 tokens**; the separate fake-only safety inventory remains 62 document tokens and 5 query tokens. No extra hosted safety schedule is authorized.

All launches under an authorization identity use the same operator state directory outside the checkout. The durable admission database is shared across restarts and concurrent launches on that host. A test-only state-directory/clock injection isolates fake guard tests; the hosted runner exposes no reset or alternate-state-directory flag. Reservation IDs are unique per embedding invocation. Unknown outcomes retain their entire committed count and amount. The authorization window is checked immediately before reservation commit in the actual pre-dispatch path.

A reviewed fake safety binding must now implement `prepareSurface(surface)` to reset each race, `historyReaderOptions(surface)` for a history-qualified reader, and nonempty authorized `evidenceInput.refs` for scope controls. The runner constructs mutation evidence inputs from its observed initial target refs. Actual fake-provider invocation counts come from the runner's provider object; receipt strings alone cannot supply them. The binding still coordinates acknowledged canonical mutation/rendezvous and drain, while all candidate/assembly/evidence/history calls are made and retained by the runner. Missing semantic capability, target, exact bytes, invocation count, original-ref fetch or history read prevents a pass.

### Commands and actual exit codes

The following command runs all 26 tests: the original 11, ten finding-specific regressions and five existing raw-fd guard tests. For each explicit Node executable, its child exit status is captured before printing any log tail.

```sh
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v22.16.0/bin/node" tools/testing/run.mjs \
  tools/testing/p2e-eval.test.mjs tools/testing/p2e-fix1.test.mjs core/test/no-raw-db-fd.test.mjs
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs \
  tools/testing/p2e-eval.test.mjs tools/testing/p2e-fix1.test.mjs core/test/no-raw-db-fd.test.mjs
```

- Node 22.16.0: **26 passed, exit 0**.
- Node 24.15.0: **26 passed, exit 0**.

A separate pristine `git archive 8f674480` extraction received only the new regression test file. Running `tools/testing/run.mjs tools/testing/p2e-fix1.test.mjs` there on each Node version produced **0 passed / 10 failed, exit 1 on each**, as required. The old private inspector is exported by a test loader without changing its body; the capability regression checks the old call expression before exercising the strict fake implementation on the fixed revision. The raw-fd regression executes the existing test's actual path selection. Tests install network and hosted-adapter import denial; their public handles and providers are fake.

```sh
"$NVM_DIR/versions/node/v24.15.0/bin/node" evaluation/context-read-p2e/fixtures.mjs --write
TIKTOKEN_CACHE_DIR="$P2E_TOKEN_CACHE" python3 tools/testing/p2e-token-count.py --write
TIKTOKEN_CACHE_DIR="$P2E_TOKEN_CACHE" python3 tools/testing/p2e-token-count.py --verify
"$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/p2e-seal.mjs --write
```

Final authoring/seal/token verification: **exit 0 each**. The offline token vocabulary was recovered from an existing cached package and checked against the same official vocabulary SHA-256 documented above; no download occurred. The initial missing-cache attempt exited 1. An initial new-noun placement changed existing IDs and a full-suite run exited 1; the original noun order was restored. The exhaustive gold audit refused the shared CJK surface (authoring exit 1) before it was disambiguated. Additional collector tests exposed an incomplete-observation exception (both suites exit 1); incomplete cells now remain incomplete, and the complete suites were rerun successfully.

```sh
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs --script \
  evaluation/context-read-p2e/runner.mjs --estimate --price-usd-per-million 1 --max-usd 100 \
  --report evaluation/context-read-p2e/reports/cost-example.json
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs --script \
  evaluation/context-read-p2e/runner.mjs --provider fake \
  --report evaluation/context-read-p2e/reports/fake-blocked.json
python3 tools/testing/p2e-manifest.py
git diff --check
```

Estimate **exit 0**; actual public dependency probe **blocked_dependency, exit 2**; file cross-check **exit 0**; whitespace check **exit 0**. The dependency block remains expected: no quality score or fake mutation pass was invented. No task is left running.

### Round 1 changed-file cross-check

Against `8f674480`, Git diff plus untracked enumeration and an independent HEAD-tree versus disk blob/mode walk agree on **20 changed files**. The script compares the complete sets, including tests, tools, docs and configuration directories. Only `core/test/` changed under `core/`; no runtime file changed. The mechanically derived list is:

- `core/test/fixtures/no-raw-db-fd-allowlist.json`
- `core/test/no-raw-db-fd.test.mjs`
- `docs/plans/context-read-p2e-eval.md`
- `evaluation/context-read-p2e/cost.mjs`
- `evaluation/context-read-p2e/fixtures.mjs`
- `evaluation/context-read-p2e/fixtures/corpus-queries.json`
- `evaluation/context-read-p2e/fixtures/inventory.json`
- `evaluation/context-read-p2e/fixtures/labels.json`
- `evaluation/context-read-p2e/fixtures/tokens.json`
- `evaluation/context-read-p2e/providers.mjs`
- `evaluation/context-read-p2e/registration.json`
- `evaluation/context-read-p2e/registration.mjs`
- `evaluation/context-read-p2e/reports/cost-example.json`
- `evaluation/context-read-p2e/reports/fake-blocked.json`
- `evaluation/context-read-p2e/runner.mjs`
- `evaluation/context-read-p2e/safety.mjs`
- `evaluation/context-read-p2e/statistics.mjs`
- `tools/testing/p2e-eval.test.mjs`
- `tools/testing/p2e-fix1.test.mjs`
- `tools/testing/p2e-safety.mjs`

## Fix round 2

This revision addresses the two distinct P1 findings and the P2 capacity finding in both re-reviews of `e18e1d84`. The round-2 sizes, audit counts, seal and cost below supersede round 1. All implementation and verification used offline fixtures and fake public readers/providers. No core runtime file changed, no real provider was constructed, and no commit was made.

### Findings, fixes and regressions

| Finding | Fix | Regression against `e18e1d84` |
| --- | --- | --- |
| P1: expanded-vocabulary gold ambiguity | Replace the generator's description-to-noun lookup and hand-selected compatibility lists with an independently authored attribute table and description predicates. Evaluate each predicate against every noun, resolve canonical document prose to noun/location concepts, and compare all eligible typed identities with gold. Narrow glove, canoe, sausage and noodle descriptions. | `fix2 gold` restores each broad description at all 20 locations. Each of the four cases must expose 20 query IDs / 240 incorrect label comparisons; adding every compatible identity to gold must pass. It also destroys document/query fact assignments and replaces numeric query IDs while retaining canonical bytes; the independent audit must still pass. |
| P1: unscored post-mutation responses | Route all post-mutation public calls through one collector. Retain and score history candidates, history evidence, the evidence-boundary semantic candidate read, and every capability response as well as the four main surfaces. Require the complete read ledger and compare its result envelopes with the retained observations. Inspect both sides of scope controls and the post-purge lexical response against the frozen scope inventory. | Three separate tests inject the forgotten target through the actual collector in history candidates, history evidence and the auxiliary semantic candidate response; each must fail with positive violations. Further tests cover capability responses; forbidden bytes, foreign refs, private scope text and unknown refs in every auxiliary role; missing ledger entries; and a post-purge scope leak identical before and after purge. Owned canonical lexical targets remain allowed after vector purge. |
| P2: large-world semantic capacity | Remove 1,400 unrelated distractor Memories from the large world. Count Memories and Cards together during fixture validation and enforce a 1,000-vector margin. Use the engine's E.4 `semanticCapacity` check at the declared 1,536 dimensions. Retain every query-bearing fact. | `fix2 capacity` checks every one of the 48 registered cells with the actual E.4 capacity function, including Cards, vector margin and at least 12 MiB cache headroom. It also checks that every queried fact remains present and that actual query counts retain the declared dependence-aware power. |

The eight tests in `tools/testing/p2e-fix2.test.mjs` all pass on the revised sources and all fail on the unchanged reviewed sources. The baseline failures are assertions exposing missing gold, accepted forbidden returns or exceeded capacity; they do not depend on importing a newly added API. Existing round-1 tests retain their behavioral checks; their expected population/audit counts and direct synthetic observation ledger were updated.

### Independent gold audit

`semantic-vocabulary.mjs` is a separate semantic model with no imports from the generator. Every noun has explicit category, function, material/composition or biological source, and form/features. Shared properties are intentional: canoe and kayak both have paddle propulsion and narrow hulls; glove and mitten both cover fingers; sausage and salami both have seasoned ground meat in casings; noodle and pasta both include flour-paste strands. Description predicates contain attribute constraints, without noun IDs, fact indices, document IDs or assigned matching-noun lists. Each predicate is tested against all 240 noun records.

The audit reads noun/location concepts and exact identifiers from canonical document bytes. It does not use generator noun order, `document.fact`, `query.fact`, or the numeric portion of query IDs to infer meaning. Other language surfaces use the independent multilingual lexemes and location vocabulary. Unmodelled descriptive queries refuse the audit. Each independently resolved concept joins every eligible Memory/Card at that location; omitted compatible targets and extraneous gold both fail. This is an exhaustive finite model of the authored inventory exemplars, not general natural-language entailment.

| Audit measure | Count |
| --- | ---: |
| Nouns / locations | 240 / 20 |
| Description predicates, including retained broad descriptions | 262 |
| Description × noun compatibility checks | 62,880 |
| All query IDs checked | 43,701 |
| Query × applicable-cell label comparisons | 524,412 |
| Ambiguous query IDs on `e18e1d84` under this model | 80 |
| Incorrect baseline label comparisons | 960 |
| Revised ambiguous query IDs / label mismatches | 0 / 0 |

The baseline comparison used its original 48 cell definitions and frozen labels, so changed world IDs do not inflate the failure count. The four narrowed descriptions are:

- Glove: `finger covering` → `separate finger compartment handwear`.
- Canoe: `narrow paddled watercraft` → `open hull single blade paddled watercraft`.
- Sausage: `seasoned ground meat casing` → `fresh uncured ground meat casing`.
- Noodle: `long thin flour paste strands` → `alkaline wheat kansui strands`.

The full attribute audit exposed the noodle/pasta case in addition to the three reviewer examples. All 80 affected English descriptions remain scheduled with disambiguated wording. The T1 no-overlap and all existing stratum-membership checks pass. No query or noun was removed.

### Complete safety accounting

Each of the 96 mutation cells now retains 13 public result envelopes: four boundary results, eight history-control results, and the extra semantic candidate result at the evidence boundary. Their 13 capability envelopes are retained too: **26 inspected/scored envelopes per mutation cell**. The scorer requires each frozen surface/role/kind exactly once. Missing/duplicate records, failed required responses or mismatched retained result envelopes prevent a pass. Every record is inspected with that scenario's frozen forbidden identities and the frozen selected namespaces; nested typed refs, complete forbidden body text, known foreign identities, private scope markers and unknown refs are checked.

Each scope cell also inspects all 16 envelopes from its four paired reads and their capability responses, including the without-canary side. Owner vector purge separately inspects its post-mutation lexical result for scope violations while preserving the intended readability of owned canonical records. Existing semantic-false complete-envelope comparisons and independent purge catalog/vector inventories remain required. The fake dependency report still has all 101 safety cells pending; regression observations do not supply a product safety qualification.

### Revised projection sizes and retained power

| World / schema | Memories | Cards | Total vectors | Free vector slots |
| --- | ---: | ---: | ---: | ---: |
| Small / v18 | 6,672 | 0 | 6,672 | 13,328 |
| Small / v23 or v33 | 6,672 | 128 | 6,800 | 13,200 |
| Large / v18 | 18,616 | 0 | 18,616 | 1,384 |
| Large / v23 or v33 | 18,616 | 384 | 19,000 | 1,000 |

Each row applies to both intents and all four languages; **48/48 registered cells fit E.4**. The largest projection uses **116,736,000 bytes** at 1,536 float32 dimensions, leaving **17,481,728 bytes** below the 128 MiB limit. The small/large namespace counts are 1,668/4,654 Memories and 32/96 Cards. There are 19,000 frozen document records and 62,080 unique token-count inputs. Labels, inventory, token counts and both reports were regenerated offline.

Only unqueried distractors were removed. All 240 nouns × 20 locations, 4,800 positive facts, 2,400 facts in each cross-language direction, 43,701 query IDs, 48 primary cells and 192 metric strata remain. Reducing distractors revises the large-world workload before observation; it does not claim unchanged retrieval difficulty. Additional independent queries are unnecessary because the power-bearing population is unchanged.

Retain round 1's additive dependence effect `D = 1 + (m_noun-1)*rho_noun + (m_view-1)*rho_view`, with `n_eff = n/D`, +5 pp true gain, and discordance `.10` or `.20`. Configuration reuse contributes no independent observations. At the conservative declared endpoint `rho_noun=rho_view=.30` and discordance `.20`:

| Set | n | Noun size / view size | D | Effective n | Detection power |
| --- | ---: | ---: | ---: | ---: | ---: |
| Each cross-language direction | 2,400 | 10 / 1 | 3.7 | 648.649 | 81.410% |
| Semantic fact set, charging four repeated views | 4,800 | 20 / 4 | 7.6 | 631.579 | 80.377% |

Every tested combination in the original declared range `rho_noun,rho_view ∈ [0,.30]`, discordance `.10`–`.20`, remains above 80%. The `.40` / `.20` sensitivity still falls below 80% (72.493% direction; 69.765% semantic set). The conditional detection-power interpretation and bootstrap limitations from round 1 remain unchanged. Twenty independent Python `erf` calculations agreed with the implementation within `6.904e-8`; that comparison exited 0.

The new seal is `6f4da1cfc830ba2acbed123dfbfd5c167f07f4766ecae323d8999aed95e5ae99`, covering **23 input files**, including the independent semantic model. The revised quality schedule has **153,776 refresh inputs / 7,202,104 tokens** and **524,412 query inputs / 7,950,612 tokens**: **678,188 inputs / 15,152,716 tokens** total. At the arithmetic example rate R=1, expected cost is **$15.152716**, with a **49,517,012 token-bound / $49.517012** conservative reservation. Hosted safety remains outside this fake-only task.

### Commands and actual exit codes

The final complete check includes the original 11 tests, ten round-1 tests, eight round-2 tests and five existing raw-fd guard tests:

```sh
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v22.16.0/bin/node" tools/testing/run.mjs \
  tools/testing/p2e-eval.test.mjs tools/testing/p2e-fix1.test.mjs \
  tools/testing/p2e-fix2.test.mjs core/test/no-raw-db-fd.test.mjs
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs \
  tools/testing/p2e-eval.test.mjs tools/testing/p2e-fix1.test.mjs \
  tools/testing/p2e-fix2.test.mjs core/test/no-raw-db-fd.test.mjs
```

- Node **22.16.0: 34 passed / 0 failed, exit 0**.
- Node **24.15.0: 34 passed / 0 failed, exit 0**.

The command's actual status was captured immediately after execution and before displaying any log tail. The same eight round-2 tests were copied, unmodified, into a pristine temporary `git archive e18e1d84` extraction and run using `tools/testing/run.mjs tools/testing/p2e-fix2.test.mjs`:

- Node **22.16.0 baseline: 0 passed / 8 failed, exit 1**.
- Node **24.15.0 baseline: 0 passed / 8 failed, exit 1**.

The differential verification script checked both expected failure counts and exited **0**. Round-2 tests install the existing network and real-provider-import denial before importing the evaluated modules. The full wrapper's process concurrency and disk checks also completed on both versions; no scratch restriction prevented them.

```sh
"$NVM_DIR/versions/node/v24.15.0/bin/node" evaluation/context-read-p2e/fixtures.mjs --write
python3 tools/testing/p2e-token-count.py --write
python3 tools/testing/p2e-token-count.py --verify
"$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/p2e-seal.mjs --write
```

Fixture authoring, offline cached-token writing, token verification and sealing each exited **0**. The direct baseline/current gold audit and projection-count report exited **0** and produced the counts above.

```sh
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs --script \
  evaluation/context-read-p2e/runner.mjs --estimate --price-usd-per-million 1 --max-usd 100 \
  --report evaluation/context-read-p2e/reports/cost-example.json
env -u OPENAI_API_KEY "$NVM_DIR/versions/node/v24.15.0/bin/node" tools/testing/run.mjs --script \
  evaluation/context-read-p2e/runner.mjs --provider fake \
  --report evaluation/context-read-p2e/reports/fake-blocked.json
python3 tools/testing/p2e-manifest.py
git diff --check
```

Estimate: **exit 0**. Fake public dependency probe: **expected `blocked_dependency`, exit 2**, with no provider construction, quality result or fabricated safety pass. Changed-file cross-check: **exit 0**. Whitespace check: **exit 0**. All verification processes completed; no unattended task remains.

### Round 2 changed-file cross-check

Against `e18e1d84` (unchanged HEAD), Git diff plus untracked enumeration and an independent HEAD-tree versus disk blob/mode walk agree on **15 changed files**. The two complete sets were compared, including tools, fixtures, reports and documentation. The documentation list below was generated from that checked set and compared back to it. No file under `core/` changed.

- `docs/plans/context-read-p2e-eval.md`
- `evaluation/context-read-p2e/fixtures.mjs`
- `evaluation/context-read-p2e/fixtures/corpus-queries.json`
- `evaluation/context-read-p2e/fixtures/inventory.json`
- `evaluation/context-read-p2e/fixtures/labels.json`
- `evaluation/context-read-p2e/fixtures/tokens.json`
- `evaluation/context-read-p2e/registration.json`
- `evaluation/context-read-p2e/reports/cost-example.json`
- `evaluation/context-read-p2e/reports/fake-blocked.json`
- `evaluation/context-read-p2e/safety.mjs`
- `evaluation/context-read-p2e/semantic-vocabulary.mjs`
- `tools/testing/p2e-eval.test.mjs`
- `tools/testing/p2e-fix1.test.mjs`
- `tools/testing/p2e-fix2.test.mjs`
- `tools/testing/p2e-safety.mjs`
