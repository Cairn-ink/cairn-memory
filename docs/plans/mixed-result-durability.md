# Mixed comparison result durability

Status: implementation contract, 2026-10-01. Fixed base:
`7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`.
Worktree: `evaluation-arm-durability`; branch: `fix/evaluation-arm-durability`.

## Problem and boundary

The interrupted one-shot thirty-case experiment had private partial SQLite
stores, but no durable generation/scoring report: the coordinator saved only
after an entire phase returned. Store and request counts do not recover answers
or certify completed cases. Preserve that run, its ordinal-22 failure, frozen
runtime and cumulative budget unchanged. This work cannot recover lost answers.

Add opt-in incremental private result persistence to the PUBLIC mixed generation
and scoring runner, with offline behavior tests. A future separately frozen
operator must explicitly enable it. Do not patch the old private operator or
claim that the old run now has a journal. Observation is not a retry queue,
ledger settlement, evaluator access, new spending authority or resume capability.

## Acceptance contract

- RD1: An explicit fresh private journal binds the existing manifest, roster,
  case/arm order and fixed N. Reject an existing journal, mismatched identity,
  reuse/duplicate phase, unsafe path or invalid option before new dispatch.
  Preserve behavior/report schemas when the opt-in is absent.
- RD2: Persist a phase start before its first dispatch, and each terminal arm's
  existing result, including its actual answer or judgment, after that scope
  and transport are settled and before the next arm starts. Persist failures
  and unresolved outcomes, not only successful arms. Preserve original order,
  reasons and denominators; do not change source/answer/judge/model policies.
- RD3: Use exclusively owned private storage (directories 0700, files 0600),
  atomic publication and file/directory fsync on supported POSIX hosts. Never
  overwrite an earlier committed record. A write/identity failure stops further
  dispatch; it never silently disables persistence or permits a retry.
- RD4: Interrupted inspection distinguishes a durably recorded terminal arm,
  an entered but nonterminal arm, and an unobserved arm. Missing records are NOT
  incorrect answers, completed work or a formal score. Inspection has no key,
  guard, HTTP, evaluator loading, ledger mutation or execution/recovery hook.
  Never mint a whole-phase success marker from a partial journal.
- RD5: Completion markers are durable only after all relevant arm processing
  finishes and bind the existing returned phase report. Scoring retains its
  existing generation validation and evaluator separation. Journal inspection
  is not a substitute for those validations, authentic accounting or scoring.
- RD6: Do not persist the apiKey option, headers, provider response bodies,
  arbitrary exceptions, corpus or evaluator/reference payloads. Existing
  validated output (answers, questions/opaque IDs, receipt coordinates and
  judgments as applicable) remains PRIVATE personal-data-bearing evidence,
  not redacted public telemetry or guaranteed secret-free model content.
  Document this new retention surface and local-file/backup/tampering limits.
- RD7: Build and retain a RED-capable baseline at the real runner seam before
  the fix. Kill a real child after its first completed arm and before whole
  phase return; assert that the first actual answer survives afterward. The
  red must establish this exact symptom, not only a missing import/new option.
  After the fix, rerun the same scenario. Use synthetic inputs and fake HTTP.
- RD8: Include a subprocess interruption gate for generation and scoring,
  complete runs in both arm orders, preflight/arm/judge failure, invalid/reused
  paths and a failed persistence barrier that demonstrably prevents later
  dispatch. Include private-mode/key-canary checks and malformed/truncated or
  forged observation refusal. Cover ordinary unjournaled behavior as well.
- RD9: Verify new fixtures have no unexpected residue after success and test
  failure. Use the canonical owned runner and createTestWorkspace; close
  guards/cores and terminate child groups BEFORE removing their owned scratch.
  Retain explicitly labelled diagnostic logs outside test scratch. Never sweep
  historical temporary directories or touch operational data.
- RD10: Run affected LongMemEval suites/demos and generic/JSON/plugin gates
  on Node 22.16.0 and 24.15.0. Also run the explicit actual native mixed fake-HTTP
  gate with pinned local prerequisites on both versions. Missing prerequisites
  fail rather than silently skip. CI must include ordinary new tests.
- RD11: Primary personally inspects the diff and reruns key integrated paths.
  Independent non-author Standards and Spec reviewers inspect the same final
  candidate SHA versus the fixed base. Fix findings, rerun and repeat both axes
  after changes. Latest-head CI and current mergeability are delivery gates.
- RD12: No paid calls, .env access, operational ledger edits/settlement, old
  experiment reads/replays, main/PR merges, release/deploy, core/MOC/schema/
  prompt/model/default-policy changes or accuracy/lightweight claims. The
  cumulative US$300 ceiling remains unchanged. This PR is a prerequisite for
  another separately reviewed protocol, not a benchmark score or product gate.

## Implementation scope

Allowed runtime files: `evaluation/longmemeval/mixed-generation.mjs`,
`mixed-scoring.mjs`, one focused result-journal module, and their necessary
new test/fixture files under `evaluation/longmemeval/test/` and `testing/`.
Use existing native fake-HTTP helpers rather than inventing a parallel runner.
Keep the new generation/scoring option explicit and version the journal,
not the unchanged phase report. Prefer a small API; no generic job framework,
automatic resume, recovery payment logic or new dependency.

Allowed documentation: this plan, a focused maintainer guide, the relevant
privacy boundary in `docs/protocol.md`, and narrow contributor/limitations/
roadmap additions explaining the gate. Root scripts/CI changes are allowed
only if needed to run the scoped tests; do not loosen existing gates.

## Sequencing after this PR

1. Deliver RD1–RD12; do not claim a replacement score.
2. Audit finite remaining fresh-case availability and budget WITHOUT resetting
   exposure or reading evaluator material early. Freeze a new fair evaluation
   protocol; previously used cases cannot be called unseen holdouts. Any old
   replay or changed paid-run policy requires separate explicit authorization.
3. Use actual retained outcomes to separate admission, candidate, selection,
   answer and transport failures. Extend existing stage observers only for an
   otherwise unexpressible minimized failure. Repair then test fresh holdouts.
4. Validate normal installed MCP/Hermes cross-session decision/reason/history
   use and measure latency/RSS/requests. These product/semantic/lightweight
   gates remain open; neither this engineering PR nor a tiny benchmark passes
   them by implication.

## Ownership and evidence

Primary owns this contract, architecture boundaries, integration and acceptance.
One implementation worker: requested/actual GPT-6.1 Sol, effort high. Separate
non-author GPT-6.1 Sol/high Standards and Spec reviewers are assigned after
candidate freeze. Record commands, tested SHA, original red and corrected green,
fixture cleanup, failures and reviewer findings here before delivery.

## Implementation and prefreeze evidence

Implementation owner: bounded worker, requested and actual GPT-6.1 Sol, high.
Base is the fixed SHA above; all results in this section were collected before
the candidate commit. Primary exact-candidate acceptance, independent Standards
and Spec review, latest-head CI and mergeability remain separate delivery gates.
No cost/token data is exposed; none is inferred from the model label.

Runtime entrypoints: `runMixedGeneration` and `scoreMixedGeneration` accept an
explicit own `resultJournal` handle, created by
`createMixedResultJournal({ directory, prepared })`. The same process-local
one-shot handle binds generation followed by scoring, fixed N, manifest/roster
digests, opaque IDs and case/arm order. `inspectMixedResultJournal({ directory })`
is offline observation only. Existing preparation and generation/scoring report
versions remain unchanged. The focused journal module imports only Node builtins
and `mixed-validation`; it does not load SDK, guard, native runtime or evaluator.

Caller inventory: public runtime definitions are in the two mixed modules.
Existing callsites are LongMemEval tests and the explicit native test file;
their omitted option continues to exercise ordinary behavior. New enabled
callsites are owned synthetic ordinary/native journal fixtures and the child
interruption fixture. The pre-grant mixed demo remains preparation/packing only.
No CLI, frozen private operator, paid evaluator, corpus, ledger, core, MOC,
prompt, default policy or installed-host callsite changed.

The original RED ran before runtime edits:

```sh
/home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs \
  --test-name-pattern='RD7 generation interruption' \
  evaluation/longmemeval/test/mixed-result-journal.test.mjs
```

It reached the real Cairn core/fake-HTTP answer and a settled authentic X scope,
paused at the second `withCaseScope`, killed the child with SIGKILL, then failed
on retained `undefined` versus actual `Synthetic memory fact.`. It did not fail
on a missing journal import or unsupported new option. The same real runner
seam passes with the opt-in on Node 22/24. A separate initial fixture setup
error attempted to replace a frozen guard method; the corrected fixture copies
the interface while preserving the original authentic methods. This setup
failure is labelled separately and is not regression evidence.

Worker-owned diagnostic directory:
`/tmp/cairn-mixed-durability-evidence.xP9tbf`. It is outside test scratch and is
retained, not cleaned as a fixture. Key evidence files:

- `RD7-original-red-node22.log`: original symptom, exit 1.
- `SETUP_FAILURE-before-RD7-red.md`: explicitly reconstructed setup-failure note.
- `RD7-corrected-green-final-source-node22.log` and Node24 equivalent: same
  corrected generation interruption seam, exit 0.
- `22-longmemeval.log` and `24-longmemeval.log`: preserved earlier prefreeze
  215/215 passes on each runtime. Subsequent successful routine
  `*-longmemeval-final-source.log` files were reused for a later test-only rerun
  and are not retained raw evidence; their results remain in the tool record.
- `22-longmemeval-indexed-profile-final-source.log` and Node24 equivalent:
  retained 215/216 pass, exit 1, for the new profile fixture's null-prototype
  versus plain-object `deepStrictEqual` assertion. The runner/journal phases
  completed; this was a fixture assertion failure, not a runtime regression.
- `22-longmemeval-indexed-profile-correction1-green.log` and Node24 equivalent:
  final runtime/test contents, 216/216 passed on each runtime, zero
  failures/skips/cancellations. The corrected assertion compares existing
  canonical JSON identity and the unchanged profile fields. The ordinary suite
  includes all 23 journal tests through the unchanged CI test glob, including
  the existing `indexed-evidence-v1` profile's generation/scoring round-trip.
- `22-generic.log` and `24-generic.log`: 580/580 passed on each runtime, zero
  failures/skips/cancellations; this does not relabel unrelated historical reds.
- `22-native-final-source.log` and `24-native.log`: full actual native mixed
  suites, 31/31 on each runtime, zero failures/skips/cancellations. The Node24
  full suite preceded a final narrow prepared-type rejection edit; the
  final-source RD-only rerun is separately labelled below.
- `24-native-final-source-RD.log`: 5/5 actual native integrated RD cases passed
  after that edit, zero failures/skips/cancellations. Native fixture/runtime
  source did not change for the later ordinary profile-test correction.
- Both runtime `*-demo-longmemeval-{ingestion,comparison,public,mixed}.log`,
  `*-validate.log` and `*-plugin.log`: exit 0 for every required demo, JSON
  validation and strict marketplace/plugin validation.

Commands ran with `PATH` selecting Node 22.16.0 or 24.15.0 from the pinned local
Node directories. Required gates were `npm test`, `npm run validate`,
`npm run validate --prefix tools/plugin-validation`, `npm run test:longmemeval`,
the four LongMemEval demos above, and `npm run test:mixed-native-local`.
The explicit native gate used only these supplied pinned installed prerequisites:

```sh
CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv \
CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu \
npm run test:mixed-native-local
```

All new fixtures use `createTestWorkspace`, including opt-in reuse of the
existing mixed-fixture helper. Deferred guard close precedes removal. Native
interruption pauses before native dispatch or after children settle; failure
teardown also tracks owned groups and verifies Linux process-start identity
before signalling, refusing recycled/unverifiable groups. The ordinary RD9
test deliberately runs the exact unjournaled RED assertion through the canonical
owned runner, verifies exit 1 and an empty owned parent afterward. Successful
ordinary/native cases also verify their owned scratch is absent after cleanup.
No historical temporary directory, operational root or old run was swept/read.

Coverage includes terminal and entered/unobserved interruption states, both
arm orders, actual Cairn ingestion failure, preflight and judge failures,
the unchanged indexed-evidence profile identity and both phase reports,
unjournaled schemas, halted completion rather than success, separate scorer/X
validation, reused/mismatched/unsafe options, directory replacement, no-overwrite
publication, file/directory fsync failure and no later scope/judge dispatch.
Privacy checks cover 0700/0600 modes and API-key/reference canaries; malformed,
truncated, oversized and coherently hashed structurally forged records refuse.
Hash links do not authenticate a hostile same-UID rewrite; the maintainer guide
and protocol boundary document that and local backup/model-text retention limits.

This is incremental private observation for a future explicitly enabled operator,
not recovery, resume, an accuracy/lightweight claim, paid permission or completion
of the remaining fresh-case, semantic, product and installed-host gates. RD11
final review and delivery are owned by the primary after the worker freezes the
scoped local candidate; the worker does not push, merge, release or deploy.
