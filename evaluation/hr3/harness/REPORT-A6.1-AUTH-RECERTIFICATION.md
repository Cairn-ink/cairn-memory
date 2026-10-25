# A-6.1 authenticated-trivia recertification — stopped at first failure

The requested full verifier was rebuilt and run **directly, unlocked**, without
`cairn-heavy`, network, keys, paid calls, new paid reservations, freeze or commit.
It stopped at the first failing command as instructed. Numerical ceilings,
output caps, margins, models, call plan, retries and price arithmetic were not
changed. All writes made by this task are in `harness/` and `integration/`.

## Actual command results

`node evaluation/hr3/harness/verify-a6.mjs` exited **1**.
The current record is `reports/a6-verification.json`, status
`FAIL_STOPPED_AT_FIRST_FAILURE`, with exact child exits, portable diagnostic
logs and their hashes under `artifacts/a61-auth-verification-K87qtx/`.

| Check | Observed result | Actual exit |
| --- | --- | ---: |
| Strict schema | PASS | 0 |
| Published extraction/reader schemas | PASS | 0 |
| Recursive private inventory | Emitted: 207 fields / 1,100 variants; subsequent injection check failed | 0 |
| Inspected-reference inventory | PASS | 0 |
| Dual-route runtime closure | Emitted: 202 modules / 1,493 bound files / 1,240 external files | 0 |
| Authenticated-consumer focused suite | **3 passed / 4 failed / 0 skipped** | **1** |
| Context/output/complete-request/embedding certificates | Not run after first failure | — |
| Accounting/budget/continuation regeneration in this verifier | Not run after first failure | — |
| Generator/scorer/integration/harness full suites | Not run after first failure | — |
| Full 480-answer fake pilot, complete leak scan and bound report | Not run after first failure | — |
| Conformance/allocation/accounting certificate bundle, reconciliation and freeze | Not run after first failure | — |

No earlier certificate or suite count is relabelled a result of this attempt.
The primary's earlier 62/91 counts were not independently reproduced here.
Current upstream documentation now describes a further 100-test scorer repair;
that suite was not executed by this task.

## Concurrent protected-source change

At task entry the inspected scorer interface was `SUPPORT_VERSION` and
`TRIVIA_VERSION` **v2**, scorer/key **v4**. During this task the protected scorer
changed to support/trivia **v3**, scorer/key **v5**, with a new trusted expected-
case binding. Entry byte hashes were captured before consumer edits. A readback
observed **11 externally changed/new protected files**, 138 files at entry and
139 at readback. Exact before/after digests are retained in
`reports/a61-auth-external-changes.json`. This task did not run any scorer or
generator writer or their test suites, and did not edit those protected files.

The new interface is documented in `scorer/REPORT.md` and implemented at:

- `scorer/support.mjs:40`: `createTriviaCase({family,authority,caseId,question})`;
- `scorer/support.mjs:67`: proof registration additionally needs caseId/question;
- `scorer/support.mjs:106`: compilation needs the separate expected case;
- `scorer/scorer.mjs`: `score(...,{triviaCase})` and version v5.

The in-progress migration supplies authority/family but not that new expected
case token. It therefore fails closed; it does not grant unauthenticated credit.
No attempt was made to weaken or bypass the new authentication requirement.

## Consumer audit and changes prepared before the stop

Two obsolete three-argument consumer calls were found at entry:
`harness/inputs.mjs` and `integration/adapters.mjs`. They were replaced by the
single four-argument call in `harness/trivia-authority-a6.mjs:13`, with an
independently configured producer-freeze digest rather than a candidate hash.
The helper strips turns to the exact ordered `{turn_id,text}` interface.
Challenge adaptation now retains the trusted world's opaque proof identity
instead of destroying it with structuredClone. There is no declared-offset
compiler or legacy three-argument licensing call in production harness/
integration consumers. Negative historical declarations remain protected.

That migration is **incomplete against the concurrently introduced v3 API**.
The helper, `inputs.mjs:27`, `integration/adapters.mjs:59`, runtime scoring at
`runner.mjs:94`, and integration scoring calls still need the new independently
created checkpoint/question case binding. The challenge engineering fixture
still declares v2; development/test paid-preflight analysis currently expects
scorer v4. Those are stale against the new v3/v5 interface and must migrate
before another full attempt. No such fix was made after the first failure.

Additional prepared changes are provisional and unverified beyond the prefix:

- Full verifier now requires zero exits and stops at the first nonzero exit;
  it no longer expects A-6.1 input failures or partial fake-pilot success.
- Existing gate/ledger tests were migrated to approved ceilings without
  weakening missing/stale accounting, contention, race or review requirements.
- Runtime/scientific-bound artifacts record the actual scorer version; old
  recorded runs retain their historical version interpretation.
- A-6.1 is required in the review amendment list; no review, supervision or
  fresh-run attestation is produced. The A-1.1 sequencing rules are unchanged.
- Exact embedding request bodies gain pre-dispatch privacy checks. The complete
  scan cross-checks their hashes against actual ledger reservations.
- Inventory derivation visits private authority handles and normalized proof
  fields; the failed focused test exposes missing `handle_sha256` coverage
  because attempted authentication now returns the protected/empty branch.
- A prospective certificate bundle and primary-only freeze updates cover the
  authenticated runtime/data graph, allocation/accounting and all four suite
  sources. They were not run and do not authorize paid execution.

## Focused failures

All names are in `test/trivia-consumers-a6.test.mjs`:

1. `A6 authenticated consumers: harness and integration retain opaque freeze-bound proofs in every language` — producer is null; missing new case binding prevents authentication.
2. `A6 authenticated consumers: JSON replay reauthenticates source data; cloned normalized proofs remain protected` — protected instead of authenticated.
3. `A6 authenticated challenge consumer: opaque identity survives; declared offsets cannot license punctuation omission` — stale v2 fixture fails the new support-version requirement.
4. `A6 private authentication and identity registries are rejected from model-visible inputs` — `handle_sha256` is not inventoried after the protected authentication branch.

The three passing checks cover rejection of forged offsets/source tapes,
the independently pinned adapter boundary, and private identity metadata
rejection before embedding dispatch. These positives do not certify the
incomplete migration or full privacy coverage.

## Accounting and remaining work

The primary-supplied preparation record remains present. No real ledger,
carry-forward manifest or receipt was altered by this task. Approved arithmetic
remains $38.342656 incremental and **$42.487733720 cumulative**, including the
verified **$4.145077720** carry and full conservative embedding allowance.
No new margin or cumulative embedding certificate was generated in this run.
The full fake pilot and complete privacy/arm-blinding/gold-leak scans remain
unperformed for the changed runtime. The primary still owns locked verification,
implementation review and final freeze.

The changed-file manifest is regenerated by Git inventory/Python hashes and an
independent Dirent/Node hash route, then their canonical inventories are diffed.
It is cumulative from original A-6 entry and includes all reports, schemas,
fixtures and ignored artifacts. External protected edits are separately listed;
they are not claimed as harness edits. Its own digest/size are null to avoid
self-reference. `git diff --check` must pass without changing failed evidence.
