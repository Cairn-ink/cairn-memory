# Fresh thirty-case development pilot: retained results

Status, 2026-10-08: the frozen comparison reached durable generation and scoring
completion. The primary's read-only result/accounting audit exited 0, and two
independent result audits passed. Primary accepts the result arithmetic,
integrity and aggregate budget scope with the caveats below. Documentation
candidate review and delivery remain pending.
This is not a delivered release, full official benchmark, independent holdout
or proof that the competitive, reliable memory product goal has been met.

## Scope and acceptance

This N24 packet changes only this report, `docs/limitations.md` and `ROADMAP.md`.
Documentation base: `a4aaccac947419e9a47574b91dae201683341854`; branch
`docs/fresh-thirty-results`. Actual author: GPT-6.1 Sol/high. Primary owns final
acceptance, verification, candidate commit, independent review, CI and delivery.
The worker has no runtime, test, dependency, actual-run, provider or ledger scope.

| Acceptance | Observable boundary | Current evidence/owner |
| --- | --- | --- |
| N24A | Frozen development method; five types × six, no preference; unchanged runtime, no retries/replacements; prior six remains separate. | Sanitized primary audit and fixed packet; author documents, primary accepts. |
| N24B | Fixed-30 correct/incorrect/unresolved, per-type and per-ordinal outcomes; completion and secondary conditional accuracy use explicit denominators. | Primary and both independent result audits passed; documentation review pending. |
| N24C | Durable terminal records distinguished from missing OS exit; known cost portion, unknown prices and conservative reservation distinguished. | Primary read-only audit exited 0; both independent audits passed with stated limits. |
| N24D | No raw source, question, answer, evaluator or private ID; shared-host/model-judgment and count limitations explicit. | Scoped sanitized inputs only; final privacy/diff inspection pending. |
| N24E | Execution failures precede temporal evidence-chain diagnosis; reliability/host gates remain open; no parity target or future launch promise. | Roadmap proposal, not a new run authorization. |
| N24F | Three-file scope cross-checked by two routes; actual exits for required generic, JSON and maintainer checks on both runtimes. | Worker checks and required primary gates exited 0 on both runtimes; candidate review pending; no TypeScript gate. |
| N24G | One compact routing/evidence record; preserve failed probes and wait for independent data acceptance. | Both independent result audits passed; primary owns candidate review and delivery. |

## Frozen method and identity

The fresh development packet contains 30 cases: six each of single-session user,
multi-session, temporal reasoning, knowledge update and single-session assistant.
It contains zero preference cases. Prepared cases retain dataset order in type
blocks; first-arm order alternates, 15 Cairn first and 15 Mem0 first. No failed,
expensive or incomplete case was replaced or retried, and no runtime or case
policy changed between early failures and later successes.

The entire run used frozen public runtime
`142c7a242e345ae2cfe3920ae607828c742cf99a`. Exact private source/operator/settings
pins were authenticated by the primary. The frozen wiring contract preserves
the original models, prompts, source/ingestion budgets and timeouts, with
`indexed-evidence-v1` plus `rare-query-window-v1`, native `topK=6` and
`threshold=0`. These method settings are not the number of cohort cases.
Generation preceded deferred scoring.
The 245-record journal places generation completion at sequence 122, scoring
start at 123 and scoring completion at 244. All 60 generation-arm positions and
60 scoring observations are terminal, with no global generation/scoring halt.
The durable status has `processingCompleted`, `generationDurable`,
`scoringDurable` and `fullScoreAvailable` true, and `replayAuthorized` false.
Terminal observations include failures: this is not 60 successful answers or
60 paid judge requests. The original supervisor's OS exit code is UNKNOWN after
daemon recovery; durable completion does not establish process exit 0.

The original 254-file result manifest uses ordered relative-path, colon,
SHA-256 and newline entries, with digest
`7b4164dbe1b7a9ef0a8c40947d596e39601284de9d415aaaadf1b651349b69e3`.
Its scope is JSON reports and journal records, not the 30 `store.db` files;
the complete output contains 284 files. Do not treat this manifest as a hash
inventory of those databases or infer their contents from admission counts.
The sanitized primary audit has SHA-256
`d086818e27db83837fdbeac50e4878b36745f23880c6183229ea24a05389a9c1`.
Auditors retain the original results and complete historical ledger privately;
the author reads only that sanitized audit, result hash manifest and sanitized
follow-up findings. The public outcome rows below reproduce the aggregate
arithmetic, not an exact rerun: the roster, source content, model/configuration
manifest and once-only operator are private and cannot be reconstructed here.

[PR #360](https://github.com/Cairn-ink/cairn-memory/pull/360) records the actual
frozen wiring used by this run; its pending public delivery is distinct from
the already retained execution. The separate
[PR #361 diagnostic candidate](https://github.com/Cairn-ink/cairn-memory/pull/361)
and [PR #362 model-call timeout candidate](https://github.com/Cairn-ink/cairn-memory/pull/362)
are prospective runtime work, not activated in this run or demonstrated
historical fixes. The earlier N12 six-case development result, Cairn 3/6 versus
Mem0 4/6 correct, remains separate; it is not pooled into 36 cases.

## Fixed-denominator outcomes

`U` means unresolved, not a judged incorrect answer. All eight unresolved arm
slots below came from incomplete generation, not a completed answer scored
incorrect. The scored report preserves every original denominator slot.

| Arm, fixed N=30 | Correct | Incorrect | U | Correct / 30 | Generation completed / 30 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cairn | 13 | 10 | 7 | 43.3% | 23/30 (76.7%) |
| Mem0 | 21 | 8 | 1 | 70.0% | 29/30 (96.7%) |

Secondary accuracy conditional on completed, resolved answers is Cairn 13/23
(56.5%) and Mem0 21/29 (72.4%): different denominators and selected populations,
not the fixed-30 comparison. On the separate common-resolved subset of 23,
Cairn is correct on 13/23 and Mem0 on 17/23. Its paired matrix is 11 both correct,
six only Mem0 correct, two only Cairn correct and four both incorrect. The
remaining seven ordinal slots are not silently dropped from the primary result.

| Type | N | Cairn correct / incorrect / U | Mem0 correct / incorrect / U |
| --- | ---: | ---: | ---: |
| Single-session user | 6 | 1 / 1 / 4 | 5 / 0 / 1 |
| Multi-session | 6 | 2 / 2 / 2 | 3 / 3 / 0 |
| Temporal reasoning | 6 | 0 / 5 / 1 | 3 / 3 / 0 |
| Knowledge update | 6 | 5 / 1 / 0 | 5 / 1 / 0 |
| Single-session assistant | 6 | 5 / 1 / 0 | 5 / 1 / 0 |
| Preference, not sampled | 0 | 0 / 0 / 0 | 0 / 0 / 0 |

Temporal reasoning's observed fixed-six score is 0/6 versus 3/6. Six cases per
type, dataset/type order and changing shared-host load do not establish category
population performance or causal explanations. Equal 5/6 rows are not evidence
of category parity; later completion is not evidence that an in-run fix occurred.

### Per-ordinal record

`C` = correct, `I` = incorrect, `U` = unresolved. Ordinals are local table
positions, not private dataset IDs. Type blocks correspond to the table above.

| Ordinal | Cairn | Mem0 |
| ---: | :---: | :---: |
| 1 | I | C |
| 2 | U | C |
| 3 | U | C |
| 4 | U | C |
| 5 | C | C |
| 6 | U | U |
| 7 | U | I |
| 8 | I | I |
| 9 | C | C |
| 10 | I | C |
| 11 | U | I |
| 12 | C | C |
| 13 | U | C |
| 14 | I | I |
| 15 | I | I |
| 16 | I | C |
| 17 | I | C |
| 18 | I | I |
| 19 | C | C |
| 20 | C | C |
| 21 | C | C |
| 22 | I | C |
| 23 | C | C |
| 24 | C | I |
| 25 | C | I |
| 26 | C | C |
| 27 | C | C |
| 28 | I | C |
| 29 | C | C |
| 30 | C | C |

## Execution failures, separate from incorrect answers

Cairn's seven incomplete generation arms are ordinals 2, 3, 4, 6, 7, 11 and 13.
Mem0's one is ordinal 6. Four Cairn generation reasons are
`ingestion_incomplete`; three are `deadline`. Mem0 reports `invalid_payload`
at the native stage. Scoring's `case_sealed` reason records an already failed
generation boundary, not the cause of the failure.

| Arm / observed ingestion stage | Count | Finite retained boundary |
| --- | ---: | --- |
| Cairn extraction | 2 | Normalized text-bound refusal (ordinals 2, 13). |
| Cairn extraction | 1 | Duplicate source validation (ordinal 3). |
| Cairn extraction | 2 | Core model timeout plus adapter cancellation (ordinals 4, 7). |
| Cairn classification after admission | 1 | `invalid_model_output` / invalid classification (ordinal 6). |
| Cairn classification after admission | 1 | Core model timeout plus adapter cancellation (ordinal 11). |
| Mem0 native | 1 | Generic `invalid_payload` (ordinal 6). |

These locate refusal boundaries, not model/provider root causes. The length
enum does not distinguish original overrun from normalization/redaction
expansion. The duplicate enum conflates repeated indices with distinct indices
mapping to identical canonical receipts. The classification enum identifies no
invalid field. Mem0 retained only 64 of 130 attempt-stage entries, omitting the
terminating detail; the refusal cannot be conclusively assigned to native
Mem0 quality rather than evaluation containment/wire limits.

Classification partiality does not prove memory loss: admission can already be
committed with durable receipts and unfiled cards. A separate independent
read-only cold inspection of Cairn ordinal 6, rerun by primary with exit 0,
joined its failed classification at batch index 19 (the twentieth capture) to
the admission key: four active, unchanged-revision unfiled cards and eight
receipts remain, with the initial classification durably failed and no final
placement/token. The whole case namespace has 91 active cards (87 filed,
four unfiled) and 257 receipts. All 30 database hashes and the empty sidecar
inventory were unchanged before/after inspection. No recovery, replay or
provider write occurred. Correspondence uses the unique namespace/journal and
twentieth-claim join; the event-ID list was not independently matched. This is
retention evidence, not semantic quality or successful recovery evidence.
Existing explicit guarded
classification-only recovery is a separate product operation, not permitted
salvage of this frozen evaluator's incomplete batches. No recovery was applied
to these cases; a returned failure alone would not prove that a journal failure
marker persisted. Timeout phase measurements include the guarded adapter path,
not pure provider latency. Short synthetic falsification distinguishes later
settlement from delayed timer/observer execution, but does not establish this
run's timing cause or prove a larger timeout fixes it.

## Accounting, not a bill

All 10,251 new requests are terminal; the prior 42,847-row history is preserved,
giving 53,098 cumulative requests. Unknown actual prices are distinct from
unknown outcomes and from pending requests. No request remains pending.

| Scope | Requests | Conservative reserved USD | Known actual portion USD | Entries with unknown actual price |
| --- | ---: | ---: | ---: | ---: |
| This round | 10,251 | 55.877145 | 12.784226 | 2,831 |
| Entire retained campaign | 53,098 | 308.817185 | 63.559143 | 16,103 |

The round has 10,247 succeeded, three unknown and one failed request outcomes;
the campaign has 53,065 succeeded, 23 unknown and ten failed outcomes. The
US$308.817185 cumulative reservation stays below the US$400 authorized ceiling;
US$91.182815 remains, including the protected US$30. This round's reservation
also remains within its US$100 ceiling. Known actual portions are incomplete
usage-derived observations, not the total bill. Unknown entries retain their
full conservative reservation; no refund, reset or erased historical spending
is implied. The complete retained accounting history has SHA-256
`a58260aad65dc1d3d5a30d02203aa85e8c833fd30095b757e471fef74bcbd70e`.
No retrospective per-scope quota-usage witness is retained. The verified
aggregate totals do not establish a separately reconstructed per-arm/phase
quota-use audit.

## What remains open

This is one development pilot with one-pass model judgments on a shared host,
not the full 500-case official benchmark or independent held-out acceptance.
Preference behavior is unmeasured. Concurrent development work prevents a
dedicated-host latency or identical per-arm workload claim. Cold whole-history
ingestion cost is not ordinary incremental-use cost or recall latency. Returned
admission entries can include existing/deduplicated members and are not unique
stored-card counts; recalled or packed units do not prove semantic completeness
or correct answer use. No production-latency, default-MOC, MCP/Hermes end-to-end
quality, competitive parity or general reliability claim follows.

Next, keep the seven execution failures separate from ten completed incorrect
Cairn answers. Review a bounded ingestion/classification/timeout correction in
the existing engine, using retained finite evidence and deterministic synthetic
regressions without truncating meaningful source or relaxing validation. Then
diagnose temporal evidence retention, candidate reachability, selection and
answer use as an evidence chain. Independent review and offline gates precede
any newly frozen fresh comparison. No parity/100% target is retrofitted, and no
future paid experiment is granted or started by this report. Ordinary installed
MCP/Hermes, lightweight growth and onboarding remain separate product gates.

## Audit and documentation verification

The primary audit exited 0 after preserving two meaningful audit-tool failures:
an indexing probe requested a nonexistent 246th journal record (exit 1), and
strict prototype equality rejected null-prototype snapshots against plain JSON
(exit 1). Corrected inspection verified all 245 records, and complete JSON-value
comparison passed without changing original results or the frozen runtime.
Two nonauthor result audits passed on the frozen final evidence, and primary
accepted arithmetic, integrity and aggregate budget scope with the manifest,
quota-witness and OS-exit limits stated above. Those result audits do not
substitute for independent review of the final documentation candidate.

Author's read-only Node 22 check exited 0: all 30 public ordinal rows match the
sanitized audit, fixed and common-resolved counts recompute, the ordered
254-entry manifest digest matches, and journal/accounting arithmetic agrees.
No original result artifacts were opened. Changed-file discovery by
`git diff --name-only -z` plus `git ls-files --others --exclude-standard -z`
agrees with `git status --porcelain=v1 -z --untracked-files=all`: exactly three
allowed documentation files. `git diff --check` exited 0. Primary independently
repeated the file-list and ordinal checks with exit 0.

The primary owns required final root `npm test`, JSON validation and maintainer
plugin validations, keyless and serial through the repository's owned runners.
Each command uses `env -i`, `TMPDIR=/tmp`, `NODE_DISABLE_COMPILE_CACHE=1` and
`PATH=/home/chichieh/.nvm/versions/node/VERSION/bin:/usr/bin:/bin`, with exact
`VERSION=v22.16.0` or `v24.15.0` and no provider credentials.

| Command, from worktree root | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test -- --test-concurrency=1` | Exit 0; 622/622 passed, zero failed/skipped. | Exit 0; 622/622 passed, zero failed/skipped. |
| `npm run validate` | Separate run exit 0. | Exit 0 in the successful `&&` validation pair. |
| `npm run validate --prefix tools/plugin-validation` | Corrected run exit 0. | Exit 0 in the successful `&&` validation pair. |

The first Node 22 maintainer validation exited 1: an isolated install with
`--ignore-scripts` (exit 0) left the native binary placeholder. Primary inspected
the installer/nonsymlink dependencies, then keyless
`npm rebuild --prefix tools/plugin-validation` exited 0 and validation passed.
This was a preserved setup failure, not a repository regression; the author
installed or removed nothing. There is no TypeScript gate in this JavaScript
repository. Final candidate review and delivery remain pending; data audits do
not replace those gates.
