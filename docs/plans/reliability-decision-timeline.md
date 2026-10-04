# Composed decision timeline acceptance

Implementation base: `be7bc1397029b05677534e5a46aa66e0b853d524` (dependent on NR PR #333; not a merge of that PR).

This tests-only slice composes existing public core APIs. It does not change defaults, introduce an automatic decision engine, or certify semantic quality. The model is a fixed synthetic script, not a provider. Requested/actual worker: GPT-6.1 Sol, high reasoning; paid/provider calls: zero; scripted model-port calls are asserted.

## Frozen synthetic roster and stages

These sources and expectations are fixed before the first test run. Each capture has a distinct message/event ID. Choice A and its supporting premise are separate memories; the first choice receipt also states the reason.

| Source | Role | Exact receipt | Expected qualification/use |
| --- | --- | --- | --- |
| A | user | For my work notes this year, I choose A because A supports offline work. | Direct, adopted A; extracted choice: `For my work notes this year, I choose A.` |
| premise | user | A supports offline work. | Direct factual premise, commitment unknown |
| backup | user | Keep a paper backup even if the tool changes. | Direct adopted, unrelated backup rule |
| proposed | assistant | You could use B for your work notes this year. | Proposed B, commitment unknown |
| considered | user | I am considering B for my work notes this year, not choosing it. | Direct considered B |
| challenge | user | I checked: A cannot work offline. | Direct factual challenge, commitment unknown |
| B | user | For my work notes this year, I now choose B. | Direct adopted B; no reason supplied |
| quote | user | For history only: last spring I said "I choose A"; this is not a new choice. | Quoted A, commitment unknown; imported last, not a current adoption |

1. **DT1 — fixture discipline.** Use `createTestWorkspace`, deferred core closures, public capture/read/write APIs only, and the above script. No SQL seeding, provider, corpus, credentials, or operational ledger.
2. **DT2 — uncertainty and refusal.** Capture A/premise/backup, then proposed/considered B. A remains current; B qualifications remain proposed/unknown and considered. Invalid single-claim attestation and an unbound transition refuse without changing public memory/receipt/qualification state or the navigation epoch. Tentative memories are never bound or removed in the positive fixture.
3. **DT3 — challenge without invented choice.** Relate premise→A (`supports-decision`) and challenge→premise (`challenges-premise`) using actual receipts. Inspect and cold recall report `reconfirmation-suggested`; A remains current, not B.
4. **DT4 — explicit trusted adoption.** Capture adopted B, then explicitly attest single-claim identity through trusted embedded `bindQualifiedClaim` and `transitionQualified`. Bind only adopted A and B, never delete tentative memories to make transition coverage pass. B is current; A is historical with original receipts and supersession; backup is unaffected. This is not automatic MCP/Hermes retirement.
5. **DT5 — late quotation.** Import quote after B adoption; preserve quoted qualification/source text. Import order does not itself retire B. An unbound quote cannot replace B. This is not general event-time inference.
6. **DT6 — cold supported views.** Close and reopen fresh sessions. Check current B, historical A, exact receipts and qualification, supersession, source-evidence fetch and cold recall. B's absent reason is unassessed, not inherited from A. Historical rationale reconstruction is unsupported; historical source fetch is the acceptance boundary.
7. **DT7 — invalidated derived context.** In separate A-current branches, correct or forget the challenge, reopen, and assert stale challenge links/text are absent from returned rationale/recall. Removal is not confirmation or authorization. Backup remains current. Cold reads must not invoke extract/qualify/classify/relate.
8. **DT8 — scope.** Qualification/rationale are explicit opt-ins; trusted transitions are embedded/manual. Default capture and host automation are unchanged. This is deterministic integration evidence, not lightweight readiness, a new score, or complete M2 acceptance.
9. **DT9 — verification and delivery.** Run this suite through the canonical runner on Node 22.16.0 and 24.15.0. Preserve failures; runtime defects are reported, not patched in this slice. Applicable contributor/core/store/MOC/demo checks, independent fixed-candidate Standards/Spec and latest dependent-PR CI remain delivery checkpoints owned by the primary.

## Verification record

The three composed cases were first prepared from this roster, then exercised through the owned runner. Initial Node 22.16.0 (`~/.local/bin/node`, cleared environment) passed 3/3 in 2,009.640591 ms. Exact nvm Node 22.16.0 and 24.15.0 runs subsequently passed 3/3 in 2,390.450519 ms and 2,831.32568 ms respectively. After strengthening invalid-attestation/epoch, exact qualification-anchor, retained-backup-source and correction/forget assertions, the final suite passed:

| Runtime | Result | Duration | Runner outcome |
| --- | --- | --- | --- |
| Node 22.16.0 | 3/3; fail/skip/cancel/todo 0 | 4,284.522803 ms | Natural exit 0; deferred resources and owned scratch cleanup completed |
| Node 24.15.0 | 3/3; fail/skip/cancel/todo 0 | 4,344.239309 ms | Natural exit 0; deferred resources and owned scratch cleanup completed |

No failed focused timeline attempt or runtime defect was observed in the three composed cases. The primary independently verified the final focused test bytes, SHA-256 `6b463f01fd4143ae959e9b42293175d3d058cefcf06e0f5ec0c4e47dd71f6a3d`, and reported the following integration checkpoint on 2026-10-05:

| Primary check | Actual result and scope |
| --- | --- |
| Frozen-final focused, Node 22.16.0 | 3/3; zero fail/skip/cancel/todo; natural exit 0; 4,976.021736 ms |
| Frozen-final focused, Node 24.15.0 | 3/3; zero fail/skip/cancel/todo; natural exit 0; 4,967.411445 ms |
| Complete core regression, Node 22.16.0 | 1,163/1,163; zero failures/skips; natural exit 0; 455,022.937499 ms. Launched before final assertion strengthening: broad regression evidence plus the separate frozen-final focused verification above, not a fully frozen final core22 run |
| Complete core, Node 24.15.0 | Launched after the final test-file modification at 21:02:35 UTC; natural exit 1; 1,161 passed / 2 failed of 1,163; zero skip/cancel/todo; 439,764.244427 ms. New timeline cases passed; existing deadline-test failures remain unresolved |
| Generic `npm test`, Node 24.15.0 | 591/591; zero failures/skips; natural exit 0; 340,297.017425 ms |
| JSON validation, both runtimes | Ten files and consistent version 0.3.0; natural exit 0 |
| Locked Claude maintainer 2.1.260 | Marketplace and strict plugin validation each exit 0; installed tooling and owned cache cleanup reported by the primary |
| Five synthetic demos, both runtimes | Store, history, MOC, recall and capture each exit 0; fresh demo databases retained under their existing contracts |

Current CONTRIBUTING, package scripts and CI configuration are unchanged. Independent fixed-candidate Standards/Spec and latest dependent-PR CI remain pending at this dated checkpoint; no semantic, cost, automatic-adoption or full-M2 acceptance is inferred.

The failed core24 attempt is retained, not regraded: `capture-invocation-deadline.test.mjs` failed at the rationale-commit expiry assertion (line 370) and staged-final-admission assertion (line 387). Each observed `delayed.reached()` as 0 rather than the expected 1; durations were approximately 1,087.28 ms and 1,045.15 ms. The primary is diagnosing these existing failures before any further acceptance. Their cause is not established, and this record does not declare full verification complete or authorize assertion/runtime changes.

Reproducible focused command (select `v22.16.0` or `v24.15.0`):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin LC_ALL=C TZ=UTC NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs core/test/reliability-decision-timeline.test.mjs
```

Ordinary contributor commands use the selected supported Node runtime. Maintainer validation requires the existing locked tooling under `tools/plugin-validation`:

```sh
npm run test:core
npm test
npm run validate
npm run validate --prefix tools/plugin-validation
npm run demo:store
npm run demo:history
npm run demo:moc
npm run demo:recall
npm run demo:capture
```

No runtime, prompt, policy, schema, version, or dependency changes are allowed in this slice.

Known-ID cold `get`/historical `fetch` proves retained storage and receipts, not automatic history discovery or reverse-predecessor traversal. The `binding_missing` negative proves an identity gate, not semantic judgment that a considered choice cannot be adopted. Cold recall independently selects visible catalog references and checks the ranked and returned evidence. Historical rationale reconstruction remains unsupported.

## 2026-10-05 clock dependency integration checkpoint

The original implementation base and local checkpoint `8485f04566a7ac43d23912981e1f33e24f2833f3` remain historical. The separately reviewed test-only clock dependency is `c115cc0e6979dc6d13858e9b04c6d9c1d1b68807` ([PR #334](https://github.com/Cairn-ink/cairn-memory/pull/334)); this is the final timeline review/delivery base. Feature-branch integration commit `95550c5fff2b500adffae55524637e5fae13c035` combines the existing timeline checkpoint with that dependency, not public main. Against the clock base the timeline scope remains the same four files, and the final test SHA-256 above is unchanged.

Primary performs only this bounded integration correction and its evidence documentation while the implementation worker owns the independent MCP packet. No test logic, runtime, prompt, qualification, rationale, defaults or package/CI configuration changed during integration. Independent nonauthor Standards/Spec still must review the final committed timeline diff.

Controlled diagnostics reproduced reach-zero by expiring before the target SQL; after real same-connection SQL the original transaction checks rolled back correctly on both runtimes. Removing exactly one post-work check in memory left durable writes and failed the rollback assertions. This supports a scheduling-sensitive test precondition, not proof of the historical scheduler event or a Node24 commit defect. The original failed full24 attempt and diagnostic observer-only error remain retained; the narrow correction does not regrade them.

On the integrated candidate, primary focused timeline runs passed 3/3 on Node 22.16.0 and 24.15.0 in 5,290.395584 / 5,238.890067 ms. Complete deadline runs passed 19/19 in 21,601.032720 / 21,547.498025 ms. All four naturally exited 0 with zero fail/skip/cancel/todo. JSON validation again passed ten files/version 0.3.0 on both; locked 2.1.260 marketplace and strict plugin validation passed against this worktree with owned configuration/temp cleanup. Store/history/MOC/recall/capture demos each passed on both, retaining fresh databases under their existing contracts.

Full integrated core and generic regressions are in progress at this checkpoint. Final fixed-candidate reviews and latest dependent-PR CI remain pending. These observations do not establish semantic quality, automatic adoption, a new score, lightweight readiness or complete M2 acceptance.

### Final combined primary gate

The final test hashes remained unchanged throughout the integrated runs. Full core passed 1,163/1,163 on Node 22.16.0 and 24.15.0, with natural exit 0, zero fail/skip/cancel/todo and durations 587,455.453964 / 587,090.231288 ms. These runs include the three final timeline cases and the independently repaired deadline tests. Generic suites passed 591/591 with natural exit 0 and zero fail/skip/cancel/todo in 442,577.567127 / 445,818.631284 ms. The focused, deadline, JSON, strict plugin and demo outcomes above are from the same integrated source bytes.

Clock dependency PR #334 was subsequently verified OPEN/non-draft/MERGEABLE/CLEAN on its reviewed head, with 21/21 applicable latest-head CI checks passing (run 37237281891). Its optional Standards duplication suggestion is nonblocking and does not change timeline code. The original failed full24 attempt is still retained. This checkpoint permits freezing the local timeline candidate for separate Standards/Spec review; it does not claim those reviews or the timeline's remote CI have passed.
