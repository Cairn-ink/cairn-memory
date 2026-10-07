# Bounded rare-query navigation preview

Status: experimental implementation frozen; focused and offline gates verified.
Candidate commit, independent reviews, PR and final-head CI remain primary-owned.
Worktree `bounded-navigation-preview`, branch `feat/bounded-navigation-preview`,
fixed base `ae80642a7f191d60ffc8bb8d7248abfbdaa5fff0`. Author actual
GPT-6.1 Sol/high; primary owns authentic owned-copy acceptance, integration,
candidate commits, two independent reviews, PR and CI. No author commit/push.

## Contract

- G1: Opt-in `openMemoryCore({ navigationLabelPolicy: 'rare-query-window-v1',
  sourceCandidatePolicy: 'bounded-keyset-v1' })` changes only explicit
  source-mode query navigation. Real synthetic recall first demonstrates a
  common-query-word receipt hiding rare name/time anchors; opt-in exposes those
  anchors. Select scripts use label text, never an oracle target ID. Record the
  same candidate ID/order on the same synthetic store before/after; no semantic
  quality claim.
- G2: Keep original candidate score/ID order, top 1,024, scan 20,000 and the first
  four stable-ID validated receipts. Only top candidates passing namespace,
  currentness and published projection contribute document frequency: once per
  memory across body and those four receipts. Query terms retain existing
  maximal Unicode letter/number runs and lowercase semantics. Integer weight
  is `N + 1 - df`: N is that namespace's actual top candidate memory count;
  df counts those candidate memories containing the query token, not a merged
  readSet pool. Choose the highest weighted 120-codepoint contiguous original
  substring from body or those receipts; ties prefer body, receipt-ID order,
  then earliest start. Zero overlap returns the body prefix. No stopword list,
  benchmark names, normalization or length preference. Test multilingual,
  short A/B, Unicode, ties, short/no-overlap and over-120 separation. Independent
  exhaustive oracle checks the window; excluded rows never affect labels/df,
  malformed source still fails closed. Single windows cannot cover all passages.
- G3: Default option/bindings/output remain byte-identical; getter/unknown value
  and invalid combinations reject before opening a store. The new label version
  binds cursor and query digest only when opted in and in source mode. Do not
  change legacy excerpt/rank-window functions, MOC labels or source output.
  Label construction adds zero model calls and uses existing select/rank stages;
  restored selection may enable an otherwise skipped rank. No schema, prompt,
  adapter, paid-runner or raw-layer edits.
- G4: Keep the 120-codepoint label and existing measured token/page budgets.
  Actual packing respects the counter. Record synthetic 200/1,024 candidate CPU,
  memory and operation counts, not promises of unchanged performance. Text pools
  are bounded, transient and held only for the top candidates; no persistence.
  Epoch and receipt corruption remain final vetoes.
- G5: Fresh owned `createTestWorkspace` fixtures clean up on success and failure.
  Author and tests read no authentic corpus, question, database, ledger or key
  and make no paid calls; primary's separate owned-copy acceptance is below. N12 remains
  Cairn 3/6 versus Mem0 4/6; improved labels do not establish semantic repair.

## Surface and verification

One independent rare-preview helper, `core/moc-storage.mjs`,
`core/contract.mjs`, a pure core test and one LongMemEval integration test, this
plan, limitations, local-store, CHANGELOG and the approved small protocol update.
Primary additionally approved `packaging/artifact-files.json` and one installed
smoke test to preserve the unconditional import's artifact closure.
Existing runtime arrays/scoring and default public maps are preserved.

Before runtime edits, run the synthetic G1 red-capable diagnostic through the
canonical runner and record its actual coverage assertion, not setup failure.
Then verify focused tests and full core on exact Node 22.16/24.15. Contributor
gates include generic tests, validate/maintainer, workspace lifecycle,
`demo:store` and `demo:recall` on both versions. Primary installs checked isolated
locked dependencies; author does not concurrently install. Gate ownership and
actual exits will be appended. No passed gate is inferred from output tails.

## RED, candidate and correction evidence

Before runtime edits, exact Node24 keyless canonical command returned intentional
exit 1 (`cbe2f3`), one fail/no skips, 1,313.949 ms:

```sh
CAIRN_NAVIGATION_PREVIEW_ASSERT=baseline node tools/testing/run.mjs --test-name-pattern='G1 generic' core/test/rare-navigation.test.mjs
```

The assertion was `rare anchors must reach actual select input`, after proving
the target ID was actually delivered and its default label omitted the anchors.
Primary independently reproduced the same RED (`ced0ca`). The original small
fixture then passed the opt-in path (`9f14f8`), with a selector using label text,
not oracle target IDs. The final fixture also checks that the old unweighted
window on the necessary receipt hides the anchors: changing receipt choice alone
does not establish the whole improvement. The candidate changes both source
choice and weighted window. No actual model error is attributed to either alone.

Expanded checks initially exited 1 (`d9992c`) on fixture setup/expectations:
no cursor when the small map was exhausted, too many scripted selected refs,
and no local counter for a setup map. The fixture now has enough actual pages,
bounded selection and the real counter; it does not weaken runtime guards.
Final pre-move focused tests passed 11/11/no skips on both versions
(`98debd` / `a990cc`). Exact delivered select maps are matched to their measured
envelopes (not filtered oversized trials), and complete prompt plus input is
counted against the existing 6,000-token limit. Legacy window generation was
skipped only on the rare path after detecting its result would be overwritten;
the final measurement asserts zero discarded legacy-label calls.

Primary caught the core CI dependency boundary: its core job does not install
the OpenAI tokenizer. The integration test moved without fixture duplication to
`evaluation/longmemeval/test/rare-navigation.test.mjs`; pure exhaustive tests stay
in `core/test/rare-query-preview.test.mjs`. No CI/package.json/lock/adapter runtime changes were
made. The pre-move core invocations were explicitly stopped via their validated
owned runner PIDs with SIGTERM, actual exit 143 (`f19a4e` / `58390b`), not passes.
Final core and LongMemEval gates restarted on frozen post-move code. Primary
post-move focused tests passed 11/11/no skips, actual exit 0 on exact Node22
(`bbe55b`) and Node24 (`9ece3e`). Current focused command:

```sh
node tools/testing/run.mjs core/test/rare-query-preview.test.mjs evaluation/longmemeval/test/rare-navigation.test.mjs
```

All commands use `env -i`, exact Node 22.16/24.15 bins plus `/usr/bin:/bin` in
PATH, `TMPDIR=/tmp` and `NODE_DISABLE_COMPILE_CACHE=1`; no key or authentic input.
Only primary supplied finite authentic-copy observations; author did not access
the original store, corpus, probe, ledger or key. Local dependencies were checked
absent (`b43727`) and installed by primary from existing locks (OpenAI `73fd23`,
maintainer `ef4da5`, actual exit 0), never a shared symlink.

## Presentation-only and default parity acceptance

Primary's first owned-copy observation (`c65ca3`, exit 0) and final runtime
rerun (`a77785`, exit 0) reproduced the aggregate label change recorded in
limitations: 32/32 → 33/33 delivered candidates; tokens 3,819/3,824 → 3,701/3,734;
name/time anchors absent → present. Those token counts measure serialized
select-request JSON only, not map envelopes or full prompt+input; canonical
full-request primary observations are reported below. Same underlying scoring/order and common
delivered-ID relative order do not imply identical physical packed pages.
Both coverage values were `budget_exhausted`. Original store hashes and runtime
pins were unchanged, copies cleaned up; scripts selected nothing and never
ranked, answered or called a provider. Single elapsed samples (675.718 versus
719.074 ms) are not rigorous performance evidence.

Primary's canonical counter correction (`56542a`, actual exit 0) subsequently
measured complete `modelRequestText` select input: default 3,815/3,820 versus
opt-in 3,697/3,730, all at or below the unchanged 6,000-token limit. These are
system prompt plus input, not map envelopes. The earlier 3,819/3,824 versus
3,701/3,734 remain serialization-only diagnostics, not canonical counts.
Presentation, 32/32 versus 33/33 candidate membership, hash/cleanup/zero-provider
and `budget_exhausted` observations remained the same.

Primary independently compared 80 synthetic memories on the same store against
the frozen N13 baseline for default and source-evidence modes: full result,
request, measured-envelope and cursor JSON bytes matched. Exact Node24
(`a77785`) compared 494,448/501,611 bytes; Node22 (`aff9b1`) compared
494,403/515,904 bytes, both actual exit 0/cleanup/no provider. The opt-in source
cursor separately includes `labelPolicy` and a changed query digest; non-source
option-on versus option-off bytes remain identical in the integration test.

## Bounded synthetic resource observations

The direct synthetic query tests preserve identical full candidate ID/order,
exclude a fifth receipt and the pruned 1,025th candidate from DF, and count
sources once per memory. Top pools have 200/1,024 memories, 1,000/5,120 sources
and 51,490/264,106 UTF-16 units. These short fixtures do not measure worst-case
text. Reachable retained source text is bounded by 1,024 × (4,000 + 4 × 800)
UTF-16 units plus one transient candidate; this is not a total resident/peak
heap guarantee (SQLite, GC, label/offset buffers and runtime objects also exist).
The following are raw one-run samples, baseline first, not benchmark conclusions:

| Node / top | Baseline / opt-in ms | CPU user/system microseconds | Heap before/after bytes | RSS before/after bytes |
| --- | --- | --- | --- | --- |
| 22 / 200 | 49.413 / 54.180 | 65,578 / 0 | 13,305,616 / 11,078,088 | 166,150,144 / 175,341,568 |
| 22 / 1,024 | 174.167 / 188.446 | 198,542 / 0 | 13,082,336 / 20,360,512 | 195,678,208 / 209,682,432 |
| 24 / 200 | 37.657 / 51.272 | 51,951 / 10,240 | 13,769,936 / 19,228,192 | 154,968,064 / 163,618,816 |
| 24 / 1,024 | 179.177 / 171.927 | 184,636 / 0 | 15,268,072 / 19,276,808 | 191,733,760 / 197,967,872 |

Label construction itself makes zero model calls. In the G1 loss control,
restored selection legitimately enables the existing rank stage (0 → 1),
while select-call counts remain equal. No claim of equal total calls applies
to that changed selection outcome. The default/non-source parity control has
equal total calls and requests. Existing receipt validation, projection and epoch
fences remain authoritative; corrupt eligible source rejects before the label
callback, and a counter-time forgetting mutation rejects before selection.

## Gate ownership

Author owns final core/LongMemEval suites and ingestion demos. Primary owns the
unchanged generic, validate/maintainer, workspace and core demos. Primary reports
actual exit 0 on both versions: validation `a5a5f0`/`b6cb50`, maintainer
`b22b00`/`8682c0`, store `72566e`/`9fa31e`, MOC `e89c45`/`6a2a80`, recall
`0c5fd0`/`61c5e5`, continuation `1564b0`/`013384`, history `5eb20d`/`a3573f`,
workspace 25/25/no skips `ef674e`/`86ad2d`, generic 581/581/no skips
`41d90b`/`4cb935`. Generic ran across the guarded opt-in-only legacy-window skip;
default affected logic stayed unchanged, with fresh final-head CI still required.
Author's ingestion demos exited 0 (`d94071`/`49a44c`). Existing demos explicitly
retain newly created synthetic databases; no historical cleanup was done.
Offline gates below are complete; candidate commit, independent review and PR/CI
are not yet reported complete. N12 scores/accounting and frozen runtime remain unchanged;
this experiment authorizes no paid run or retention-default change.

Final post-move LongMemEval gates passed 293/293 with no skips and actual exit 0:
Node22 `6c2775` (100,239.281 ms), Node24 `b824d5` (98,189.822 ms).
Full core initially returned actual exit 1 on both versions (`0f007c` / `affa58`),
1,187 pass / 1 fail / zero skips. The only failure was the existing clean-copy
I7 test: its `git ls-files` source inventory omitted the newly untracked helper,
so the copied core could not resolve it. This is a tracked-inventory setup
failure, not optional-tokenizer acquisition or runtime behavior. The author
requested primary staging; primary staged only the helper (`8252fe`, exit 0).
The same I7 isolated-copy seam then passed 1/1 with zero skips and actual exit 0
on Node22 (`04f710`) and Node24 (`cc7f9a`). The safe tracked-only copy contract
is not modified. Both full suites were rerun rather than combining the initial
1,187 passes with the isolated I7 pass. Final core gates passed 1,188/1,188,
zero skips and actual exit 0: Node22 `af3c6d` (392,040.069 ms), Node24 `edfae3`
(392,115.285 ms). Runtime/test bytes were unchanged throughout these reruns.

## Installed caller and dependency boundary

The artifact builder's explicit allowlist must include the new helper because
`core/contract.mjs` imports it unconditionally, even when opt-in is off. The
approved one-file manifest addition and installed default/opt-in smoke exercise
that cross-feature closure without changing build logic, dependencies or CLI
defaults. A missing artifact entry would break default installed imports; source
checkout tests alone would not detect that. The smoke uses a newly owned offline
install, installed core and installed tokenizer, scripted label-based selection,
no model transport, and immediate fixture cleanup. Existing builder scratch is
owned by the canonical outer runner.

Primary's first installed smoke runs exited 1 (`2476e2` / `2f4d6d`) because the
scripted model omitted its context window and the normal model guard rejected
`context_budget_exceeded`. The fixture now declares the same 8,192-token window
as the source integration model; no runtime budget was widened.

Author's corrected installed smoke passed 1/1 with no skips and actual exit 0
on Node22 (`3797db`, 2,332.525 ms) and Node24 (`342bbd`, 2,387.723 ms).
The final installed fixture SHA256 is
`f03a542a4629c552f3381dbe658be91611da2d9092cc8191c40f6dc0390d252a`.
Primary independently reran the installed smoke on Node24 (`66e781`), 1/1,
actual exit 0. Full artifact gates passed 90/90 with zero skips and actual exit 0
on Node22 (`9c5c06`, 104,626.268 ms) and Node24 (`36e977`, 99,445.360 ms).

Primary's locked MCP installation and cache preparation exited 0 (`3290b9` /
`6cef17`), without lock changes. Its additional npm audit exited 1 (`b86ac0`)
for the existing dev-only `@modelcontextprotocol/client` 2.0.0 OAuth credential
routing advisory [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h).
Primary's official-advisory inspection reports stdio clients/server are not
affected; repository uses here are stdio tests/demos and the installed production
allowlist excludes the client. This is a retained audit warning, not an audit
pass. Maintainer dependency upgrade is separate work; this experiment adds no
OAuth path and changes no dependency versions.
