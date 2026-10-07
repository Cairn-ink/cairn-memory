# Fresh thirty one-shot operator (N18)

Status: implementation and author synthetic verification complete; source
frozen. Primary acceptance and independent fixed-source reviews remain pending. No paid run is
performed or authorized by this worker's packet.

Owner: bounded implementation worker, actual GPT-6.1 Sol/high. Primary owns
authentic metadata, operational assembly/launcher/supervisor, keys, ledger,
paid dispatch, acceptance, commits and independent fixed-SHA reviews. Base:
`142c7a242e345ae2cfe3920ae607828c742cf99a`, branch
`test/fresh-thirty-operator`. Public changes are this plan and an evidence
append to `docs/limitations.md` only. No public runtime changes are authorized.

## Contract

| ID | Acceptance |
| --- | --- |
| O30-1 | Exactly 30 cases, six each of the five available original types, no preference case; original six type names, seed, ranking and dataset order, and 15/15 arm orders. Reuse frozen N17A source reader; no selector or preparation producer in the operator. Fresh-thirty-v1 identities cannot consume old six-case receipts/grants. Preparation, manifest, roster, resource projection and guard bind indexed-evidence-v1 plus rare-query-window-v1 explicitly. |
| O30-2 | Load N16 v4 with its immutable v3 parent and complete older ancestry. Baseline is open schema-v2, 400,000,000 microUSD, request cap 840,000 and no pending attempts. Full round ceiling is at most min(100,000,000, 400,000,000 minus baseline reserved minus 30,000,000), and projected requests fit the remaining finite cap. Preserve the complete baseline attempt prefix and unknown actual-cost reservations; no reset/refund/repricing or cap transition. |
| O30-3 | Preflight verifies pinned control/source/runtime/native inventory and resource fit. Invocation exclusively creates output and fsyncs its started marker and directory BEFORE reading a key, then repeats source/control/inventory/checkpoint verification before grant and dispatch. Persistent output consumption and in-process consumption prohibit retry, resume, reselection and old-grant replay, including failed attempts. |
| O30-4 | No evaluator or original raw-source read until all 60 generation arms are terminal, the complete report equals the durable journal completion, and neither report nor guard is globally halted. Callback validates the complete scorer-equivalent schema of every evaluator row, including reference_answer, answer_session_ids and turn_labels, with row 29 rejection before raw-source access or Python. Evaluator cap remains 8 MiB; callback raw source remains 300 MiB (distinct from the producer's 512 MiB bound); reference sidecar uses genuine pinned Python. |
| O30-5 | Full successful journal has 245 records and 60 terminal scoring observations; paid judgments are at most 60 because local U need not be judged. Models, prompts, ingestion, phase budgets, native topK 6 and timeouts remain unchanged. Only unchanged public authenticated settled-local-failure classification may continue the frozen roster, including its accepted parser/deadline categories. Unknown billing, unverified accounting, unsafe cleanup, and malformed control/evaluator/journal halt; no new blanket parser rule or widened isolation. |
| O30-6 | Exact Node 22.16/24.15 canonical synthetic suites prove full 30-case fake-HTTP flow, malformed last-row ordering, key/evaluator barriers, persistent consumption/replay denial, deadline/unknown safety and owned success/failure cleanup. No authentic data, ledger, key or provider calls. Derive runtime/import inventory twice mechanically, including external private imports; CODE array length is a file count, never cohort size. Freeze all private code hashes and both public paths after primary acceptance. |

## Exact proposed file map and callers

All private writes are under `/tmp/cairn-fresh-thirty-operator.qjyp46O7`:

| File | Role / dependent checks |
| --- | --- |
| `operator.mjs` | `preflightThirty` / `runThirty`; minimal adaptation of old source-only one-shot orchestration to the new identity, v4 parent and 30-case bounds. Primary thin launcher is a later separate task. |
| `trusted-callbacks.mjs` | `createThirtyCallbacks`; inert factory, durable generation/evaluator schema barriers, bounded genuine reference sidecar. |
| `private-io.mjs` | Bounded own-data descriptors, proxy/getter refusal, create-only private output and fsync. No operational defaults. |
| `parent-transport.mjs` | Old trusted-parent transport copied without functional edits; dummy-key exchange after guard reservation, finite boundary tail. |
| `runtime-inventory.mjs` | Old inventory verifier copied without functional edits; private imports are explicitly required by operator inventory membership. |
| `synthetic-fixture.mjs` | New owned synthetic 500-row metadata/source, 30-case preparation, genuine complete synthetic budget lineage through v4, fake HTTP; no operational paths or pins. |
| `operator.test.mjs` | Full 60-arm/journal/scoring/accounting integration plus preflight, consumption and generation safety boundaries. |
| `callbacks.test.mjs` | All-row schema and read-order traps, including malformed final row before raw source/Python. |
| `safety.test.mjs` | Transport deadlines/unknown outcomes, inventory and output persistence/cleanup boundaries. |
| `suite.mjs` | Canonical `--script` zero-execArgv synthetic test entrypoint. |

The source reader is an unchanged external import from frozen N17A
`/tmp/cairn-fresh-thirty-source.CXFeV4Z8/source-only.mjs`, with its
`private-io.mjs` dependency; both must appear in runtime inventory. Its source
manifest SHA is `2ec40e0cc5e935fac2e7b75aa54d3dee636dfbc79444f4041cee94bcc6a991c1`.
N17B candidate `7813db10a32dd5eee9505ee82c77afce8107ed40` has both independent
reviews PASS; its final source manifest SHA is
`21844371075e17903d98c8a4cbfb6acca4f8b9d059f70a7f15c5341a8d381479`.
Neither predecessor is
edited or executed. Only allowed old `.mjs` source is read; no adjacent JSON.

Public entrypoints reused without changes: mixed prepare/generation/scoring/
journal/resource, v4 budget loader and mixed guard, native artifact/configuration,
reference renderer and public preparation in synthetic fixtures. The callback
must duplicate only the private scorer's closed evaluator validation contract
because that validator is not exported; primary acceptance checks parity.

## Verification sequence and evidence

First establish an actual behavioral RED in the NEW owned operator against a
synthetic 30-case fixture, before completing the cohort/v4 adaptation. A missing
export import SyntaxError or fixture setup failure is not feature RED. No old
operator, launcher or old fixture is executed. Then run focused boundaries and
the full suite with `env -i`, no credential variables, `TMPDIR=/tmp`, exact Node
22.16/24.15 and `tools/testing/run.mjs --script`. Full flows use actual installed
native Mem0 behind fake HTTP, not substituted native children. Existing public
journal interruption coverage is reused; an unused copied interruption helper
was removed via patch rather than delivered. Primary independently reruns
the key full flow and barriers on frozen source hashes. Real exit codes,
retained setup failures, cleanup and file counts are recorded here.

Canonical full-suite command, from the clean `benchmark-budget-400` worktree:

```sh
env -i \
  PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin \
  TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 \
  CAIRN_THIRTY_PUBLIC_RUNTIME=/home/chichieh/Github/cairn-memory-worktrees/benchmark-budget-400 \
  CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv \
  CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu \
  /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs \
  --script /tmp/cairn-fresh-thirty-operator.qjyp46O7/suite.mjs
```

For Node22, replace both `v24.15.0` executable/PATH components with
`v22.16.0`. All three explicit fixture environment bindings are required;
they are paths, not credentials. The primary's first independent invocations
omitted them and exited 1 (`9ac3f2`, `e433db`, eleven setup failures each),
not feature RED. Their runner roots were checked absent (`91a245`, actual
exit 0, primary evidence). Corrected independent runs use the same frozen source bytes.

No authentic thirty-case roster is selected by this task, no paid authorization is minted
against an operational book, and no comparison score is produced. Prior N12
Cairn 3/6 versus Mem0 4/6 remains unchanged; experimental navigation presentation
does not repair missing-at-write evidence or prove semantic improvement.

### Development feedback loops

The NEW owned preflight test reached real v4 ancestry/source/native/mixed APIs
and rejected exact thirty preparation at the retained old `fixedN !== 6` check:
Node24 actual exit 1 `b968aa`, 1 failed/0 skipped, 7,054 ms. Changing that
single cohort condition yielded actual exit 0 `fda573`, 1/1, 2,467 ms.

The callback regression used actual installed Mem0 and real Cairn with fake
HTTP for all thirty generation cases. A coherently repinned malformed final
evaluator reference triggered one original-source open (Python zero) before
schema refusal. The first run's internal assertion was conservatively projected
as `fresh-thirty_execution_failed` (`77113a`, exit 1); the sharpened external
assertion exposed precisely `1 !== 0` raw-source reads (`e3cfb0`, exit 1,
96,577 ms). These are synthetic callback-order failures, not historical model
or provider failure evidence. The callback now reuses the scorer's pure bounded
`reportSnapshot` and mirrors its unexported closed complete row schema before
raw-source/Python access; it also binds types to the fixed control pins.

The first integrated GREEN mechanism (`41ab1b`) completed healthy 60-arm
generation, 60 judgments, genuine Python reference rendering and 245 journal
records, with 45 coherent row/schema faults refusing at raw-source/Python
counts zero. The developmental suite itself exited 1 (6/7 pass): its source-
drift assertion incorrectly expected private local I/O `file_invalid`, whereas
the unchanged external N17A reader correctly projects `source_invalid`.
Only the expected finite category was corrected. No public validation or
classification was relaxed. All runner-owned scratch was removed.

Final author tests completed on exact Node22.16.0/24.15.0 against clean runtime
`142c7a242e345ae2cfe3920ae607828c742cf99a` in `benchmark-budget-400`; the public
N18 documentation worktree is not falsely called the clean runtime inventory.
Its existing isolated dependencies are read only; no installation or shared
link change was needed. Transport/inventory copies were normalized only for
trailing newline parity and now compare byte-for-byte equal to their original
allowed source (`e5cfb0` and `06eea0`, exit 0); original source bytes remain
unmodified. Runtime hashes are checked before/after final tests and all
freeze records are rehashed at handoff.

The next developmental full runs encountered the second incorrect expected
category: checkpoint drift is rejected by the public checkpoint validator,
then deliberately projected to the private closed `execution_failed` fallback,
not `checkpoint_mismatch`. Source/control drift and all sensitive-read counters
remain independently asserted. No production error allowlist was expanded.

Those runs also exposed a deadline-fixture mistake: hanging every embedding
assumed a blanket global halt, but the unchanged public guard authenticates a
60-second transport deadline as a local U and continues the frozen schedule.
Only the two positively identified synthetic canonical runner parents were
sent SIGTERM (`c34dad`, exit 0); both supervised invocations closed with actual
exit 143 (`5b40a8`, `505a7f`). Both exact owned roots were absent afterward
(`87e2e2`, exit 0). This is an intentionally interrupted fixture, not a provider
or runtime failure, and supplies no settled-accounting claim for its killed
synthetic requests. No actual run, book or historical directory was touched.

The narrowed fixture hangs only the first embedding, observes the original
60,000-ms timeout/abort, and lets later fake HTTP respond normally. Its targeted
Node24 run passed (`791d76`, actual exit 0, 1/1, no skips, 161,924 ms): one new
unknown reserved attempt, local Mem0 U, subsequent frozen cases completed,
common-resolved N 29 and 59 judgments. Final assertions additionally require
exactly one hang/abort, host-embedding/full reservation retained, Cairn U 0,
60 terminal observations in each phase, 245 journal records, pending zero and
unchanged original prefix. Unclassified provider rejection remains global.

The runtime inventory is cross-checked by `git ls-files` versus `git ls-tree`
(1,413 tracked files), dependency recursion versus `find` (58 locked files),
and explicit CODE/dependency membership versus static import closure rooted at
BOTH operator and callback entrypoints (seven private runtime imports):
`805b97`, exit 0. The first import-check script (`08e3eb`, exit 1) mistakenly
started only at the operator, omitting the independently invoked callback
factory; the actual inventory already required that file. It was a verification
script setup failure, not a missing runtime dependency.

The final source manifest uses absolute `{path, sha256}` records: ten owned
private MJS, two public documentation inputs, and the two frozen N17A imported
dependencies, fourteen records excluding itself. The owned delivery has thirteen
files including the manifest; the full input set including external imports and
manifest has fifteen. This manifest is a source freeze, not a future launcher/
bootstrap inventory, host attestation or spending authority. Primary separately
binds assembly/launcher/supervisor and every actual imported runtime input.

### Final author verification

| Check | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| Full canonical suite | `3d1f43`, actual exit 0, 12/12, no skips, 544,735.849 ms | `d60b33`, actual exit 0, 12/12, no skips, 537,523.739 ms |
| Ten private MJS syntax checks | actual exit 0, ten checks | actual exit 0, ten checks |
| Original deadline observed | 59,999.902 ms, one hang/abort | 60,001.911 ms, one hang/abort |

Syntax evidence is `0796ca`, actual exit 0, with all ten source hashes matching
the pre-run freeze. Both complete suites exercise actual installed native Mem0
and genuine Python references with only synthetic data and fake HTTP. Healthy
flow has 60 judgments and 245 journal records; each isolated local-U control
has 59 judgments, common-resolved N 29, all 60 terminal observations in each
phase, pending zero and an unchanged baseline prefix. Deadline retains exactly
one unknown host-embedding reservation at full reserved cost, without refund.
Unclassified provider rejection globally halts before evaluator access.

Both author canonical runner roots were independently checked absent
(`b5ce97`, actual exit 0). Owned fixture cleanup assertions cover completed
flows, refused controls and injected fsync/key failures. Full-suite elapsed
times include synthetic preparation/projection and a genuine 60-second
deadline control; they are not product latency or benchmark performance.
The owned private file list is derived independently by directory enumeration
and `find`; the two public paths are checked by diff plus untracked listing
versus porcelain status. Counts are ten private MJS plus two public docs,
twelve owned source inputs, with two unchanged external imports: fourteen
manifest records, thirteen owned delivered files including the manifest and
fifteen total inputs including external imports and manifest.
Independent primary full reruns and fixed-source reviews remain separate
acceptance gates, not inferred from these author results.
