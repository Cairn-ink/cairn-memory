# A-4 fourth-recheck writer-owner repair

Writer intents now carry an atomically published, verifiable owner identity. A crashed owner can be reclaimed without manual marker deletion. Live and unverifiable owners keep priority. Reclamation changes only dead intent files under the existing accounting lock; it never changes the journal, checkpoint, reservation or response record. There is no time-only lease.

## Implementation and locations

| Requirement | File:line |
|---|---|
| Parse Linux starttime after comm, including spaces/parentheses | `writer-owner.mjs:16` |
| Register pid, boot/PID namespace, starttime and crypto nonce; conservative fallback | `writer-owner.mjs:24` |
| Atomic, canonical owner-name format | `writer-owner.mjs:33` |
| Prove missing process or PID reuse; otherwise retain/report unknown | `writer-owner.mjs:43` |
| Publish complete identity in one exclusive empty file | `ledger.mjs:104` |
| Reclassify under lock; check unchanged inode/file metadata and liveness before removal | `ledger.mjs:114` |
| Attach live/unknown intent diagnostics to observer errors | `ledger.mjs:135` |
| Preserve priority checks before and after lock acquisition | `ledger.mjs:136` |
| Include intent diagnostics in minute monitoring reports | `transport.mjs:84` |

The v2 marker filename contains pid, canonical Linux starttime, boot ID, PID-namespace inode and a random UUID. Publishing the identity in the filename avoids an anonymous/partial JSON-payload window if a process dies just after creation. The file is mode 0600 in the existing mode-0700 intent directory. Starttime stays a decimal string to avoid precision loss; malformed/noncanonical numbers and unrecognized marker formats are never used as death proofs.

Reclamation requires the same boot and PID-namespace scope, then either a different current starttime or missing proc data corroborated by ESRCH. Permission errors, inaccessible/malformed proc data, foreign/unverifiable scope, unknown start identity and legacy anonymous markers stay blocking and appear in diagnostics. A live but slow writer is never expired by age. Linux /proc paths are operating-system interfaces; no workspace path is embedded. Non-Linux/restricted-proc fallback is explicitly unknown. Existing stale accounting locks still require reconciliation; this repair removes provably abandoned writer intents only.

The journal/checkpoint/configuration formats, paid-preflight gate, provider retry allowance, 15-second accounting bound, five-minute stop, retained response/reservation semantics, all numerical caps and actual model/P payloads are unchanged. The new marker protocol is v2; old anonymous markers cannot be migrated by guessing their owners.

## Independent-process regressions

Each process test uses separate Node processes, regular-file stdio and atomic test-only command/reply mailboxes. A command/startup allows 60 seconds; each process test allows 180 seconds. Every poll checks for a completed reply before its deadline. The test fixture owns and kills only its own child processes. Earlier transient accounting tests now allow 20 seconds, with a 30-second elapsed-test ceiling; production limits remain unchanged.

- `recheck4 owner: crashed independent writer is reclaimed under lock and observers recover`: a real SIGKILL leaves the intent. A separate observer must keep the file while the accounting lock is occupied, then reclaim under the lock. A fresh independent writer reserves and observers read the advanced journal.
- `recheck4 owner: live independent writer retains priority regardless of marker age`: an independent live owner keeps the same marker inode despite an ancient mtime, repeated observations and another writer's successful operation. Explicit owner release restores observations.
- `recheck4 owner: reused pid with a different process start is reclaimed without harming its live replacement`: a recorded different start identity is supplied for a real live replacement process. The observer reclaims the stale identity under lock; the replacement remains alive and can reserve. The test does not force kernel PID reuse.
- `recheck4 owner: unknown start identity is retained and reported across independent processes`: unverifiable start identity blocks observers, emits an unknown-owner reason and remains present while an authoritative writer proceeds.

Additional tests retain/report legacy anonymous markers; cover matching/reused identities, missing-process corroboration, permission uncertainty, foreign boot scope and non-Linux fallback; and verify canonical complete marker names plus comm parsing. Actual unlink instrumentation checks the lock directory at the removal syscall. Every earlier ledger, contention and checkpoint-race regression remains in the suite.

## Baseline evidence

The exact committed d5ab6bd3 ledger fixture has SHA-256 **496e0afbb82f3c53ba691fe0e590c44d3d9bccc9549ac243a6f6b28b2fa7c818**, copied from Git and checked against the clean task-entry workspace. The worker checks that digest before executing the actual old class source. Writer and observer are separate processes in both baseline and repaired probes.

`HR3_OWNER_BASELINE=1 node --test --experimental-test-isolation=none --test-name-pattern='crashed independent writer' evaluation/hr3/harness/test/writer-owner-a4.test.mjs` — **0 pass / 1 fail, exit 1**, with actual ledger_locked after the owner is reaped. [Red TAP](reports/recheck4-red.tap); [old-source process evidence](reports/recheck4-crashed-baseline.json). This is not an import failure or a missing-helper assertion.

The five-file focused run passes **74/74, exit 0**, including all earlier 60 focused regressions and 14 new tests. Current process evidence is retained in reports/recheck4-{crashed,live,reused,unknown}-current.json. Two initial test-launcher trials exited 1 before reaching the ledger because Node-child pipe output was unavailable in this sandbox; they are retained as *-setup.* diagnostics and are not used as baseline evidence. File stdio/mailboxes resolved that test-only launch issue before the baseline and passing runs.

The additional four-case old-source run (`--test-name-pattern='recheck4 owner: (crashed|live|reused|unknown)'`) produced **0 pass / 4 fail, exit 1**; see reports/recheck4-red-four.tap. The exact failure surfaces differ:

| Required case | d5ab6bd3 failure | Repaired result |
|---|---|---|
| Crashed owner | Observations remain ledger_locked after SIGKILL/reap; a fresh writer can reserve but observation stays blocked | Reclaimed under lock; fresh writer and ordinary read/snapshot proceed |
| Live owner | Marker has no parseable/verifiable pid/start/scope/nonce; the identity assertion fails | Same live marker inode survives old mtime, repeated observers and another writer; explicit release restores reads |
| PID reuse | Different-start marker remains blocking with ledger_locked | Stale identity reclaimed; real live replacement remains alive and reserves |
| Unknown identity | No owner diagnostic entry is returned; reading the required state entry fails | Marker retained; unknown state and reason are returned and forwarded to monitoring |

The old live-marker behavior already retained priority; its failure here is the missing verifiable identity, not wrongful reclamation. The unknown-case failure is missing diagnostic data, not a worker launch/import failure. The dedicated crashed-owner probe remains the direct behavioral proof of the audited P2.

## Final verification

`node evaluation/hr3/harness/verify-a4.mjs` — **exit 0; all 21 ordered commands exited 0**, PASS_OFFLINE_PENDING_PRIMARY_FREEZE. Artifacts: `evaluation/hr3/harness/artifacts/a4-verification-e17L84`. [Ordered result](reports/a4-verification.json); [independent postflight](reports/recheck4-postflight.json).

| Suite | Pass | Fail | Exit |
|---|---:|---:|---:|
| Generator | 43 | 0 | 0 |
| Scorer | 52 | 0 | 0 |
| Integration | 20 | 0 | 0 |
| Harness | 329 | 0 | 0 |

All 14 new tests and every earlier ledger/contention/race regression pass. Focused tests: **74/74, exit 0**. Pinned crashed-owner baseline: **0/1, exit 1**; the four requested old-source cases: **0/4, exit 1**, with distinct failure reasons recorded above. All **eight changed JavaScript files** pass `node --check`, each exit 0. Diagnostic portability, certificate rebinding, independent source/log/checkpoint readback and `git diff --check` each exit 0. Only new diagnostics are normalized; scientific artifacts and actual exit codes are unchanged.

The full fake pilot completed **240 extractions / 480 answers**, 120 valid per arm, with no stop. The complete leak scan passed: **240 extraction requests / 480 reader requests / 1747 P payloads**, zero missing/hits and unchanged P blocks. Bound report exited 0 and remains descriptive, without confidence intervals/bootstrap estimates or uncertainty contrasts. All **eight certificates** bind current runtime/source/log bytes. All **2,227 pilot manifest entries** and the **5,325-record** journal/checkpoint count/head/bytes were read back. No response or writer intent is pending in the completed pilot.

Runtime closure includes writer-owner.mjs and agrees independently by loader/parser plus both external-file inventories: **196 modules / 1481 files**, including 1240 installed dependency files. Complete requests and maximal outputs retain ≥5% and ≥10% headroom. Embeddings retain **138 context requests / nine cases**, measured before maxima/projections: research **62,757,367 units**, P **23,605,774**, each below 64M.

The complete cumulative pilot bound stays **US$30.232574300 ≤ US$50**, with complete accounting. Carry/accounting inputs, historical fixtures and the real freeze remain unchanged. No paid-preflight or primary review/supervision attestation was authored. No network, key access, paid calls or commit. Primary freeze and non-author review remain external gates.

| Ordered gate | Exit | Command |
|---|---:|---|
| strict-schema | 0 | `node evaluation/hr3/harness/strict-schema.mjs` |
| published-schemas | 0 | `node evaluation/hr3/harness/schemas-a4.mjs` |
| private-field-inventory | 0 | `node evaluation/hr3/harness/private-field-inventory.mjs` |
| inspected-references | 0 | `node evaluation/hr3/harness/inspected-references.mjs` |
| runtime-closure | 0 | `node evaluation/hr3/harness/runtime-closure.mjs` |
| context-certificate | 0 | `node evaluation/hr3/harness/context-certification.mjs` |
| cap-certificate | 0 | `node evaluation/hr3/harness/cap-certification.mjs` |
| request-certificate | 0 | `node evaluation/hr3/harness/request-certification.mjs` |
| accounting | 0 | `node evaluation/hr3/harness/accounting-a4.mjs` |
| projection-schema | 0 | `node evaluation/hr3/harness/projection-schema.mjs` |
| budget | 0 | `node evaluation/hr3/harness/budget-a4.mjs` |
| continuation-projection | 0 | `node evaluation/hr3/harness/continuation-a4.mjs` |
| generator-tests | 0 | `node --import ./evaluation/hr3/harness/test/redirect-generator-temp.mjs --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs` |
| scorer-tests | 0 | `node --import ./evaluation/hr3/harness/test/redirect-generator-temp.mjs --test --experimental-test-isolation=none evaluation/hr3/scorer/test/canonical.test.mjs evaluation/hr3/scorer/test/citations.test.mjs evaluation/hr3/scorer/test/contract.test.mjs evaluation/hr3/scorer/test/schema-cli.test.mjs evaluation/hr3/scorer/test/scorer.test.mjs` |
| integration-tests | 0 | `node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` |
| harness-tests | 0 | `node evaluation/hr3/harness/test.mjs --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| pilot-inputs | 0 | `node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/harness/artifacts/a4-verification-e17L84/inputs` |
| fake-pilot | 0 | `node evaluation/hr3/harness/cli.mjs --stage pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-e17L84/inputs --out evaluation/hr3/harness/artifacts/a4-verification-e17L84/pilot --carry-forward evaluation/hr3/harness/reports/a4-carry-forward.json --mcp-dependencies adapters/mcp/node_modules --tokenizer-dependencies adapters/openai/node_modules` |
| leak-scan | 0 | `node evaluation/hr3/harness/leak-scan.mjs evaluation/hr3/harness/artifacts/a4-verification-e17L84/pilot evaluation/hr3/harness/artifacts/a4-verification-e17L84/inputs` |
| bound-report | 0 | `node evaluation/hr3/harness/cli.mjs --bound-report evaluation/hr3/harness/artifacts/a4-verification-e17L84/pilot --inputs evaluation/hr3/harness/artifacts/a4-verification-e17L84/inputs --out evaluation/hr3/harness/artifacts/a4-verification-e17L84/bounds.json` |
| certification-bundle | 0 | `node evaluation/hr3/harness/certification-bundle-a4.mjs` |

## Changed files

[Complete manifest](reports/recheck4-changes.json): **2377 changed/new files**, comprising **76 Git-visible files and 2301 retained ignored artifacts**. Git tracked differences plus all untracked paths (including ignored), filtered against task-entry content hashes, agree exactly with an independent recursive filesystem/Node SHA-256 inventory against the clean d5ab6bd3 baseline. **12 source/document/test/fixture files** are listed below. All **77774 pre-existing artifact files** remain byte-identical. Every listed hash is read back; the manifest lists itself without a self-hash to avoid circular binding. Repository changes are confined to harness.

- [PAID-PREFLIGHT-A4.md](PAID-PREFLIGHT-A4.md)
- [README.md](README.md)
- [REPORT-A4-RECHECK4.md](REPORT-A4-RECHECK4.md)
- [ledger.mjs](ledger.mjs)
- [test.mjs](test.mjs)
- [test/fixtures/ledger-d5ab6bd3.mjs.txt](test/fixtures/ledger-d5ab6bd3.mjs.txt)
- [test/ledger-contention-a4.test.mjs](test/ledger-contention-a4.test.mjs)
- [test/ledger-race-a4.test.mjs](test/ledger-race-a4.test.mjs)
- [test/writer-owner-a4.test.mjs](test/writer-owner-a4.test.mjs)
- [test/writer-owner-worker.mjs](test/writer-owner-worker.mjs)
- [transport.mjs](transport.mjs)
- [writer-owner.mjs](writer-owner.mjs)
