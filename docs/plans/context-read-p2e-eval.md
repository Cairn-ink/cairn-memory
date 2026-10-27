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

