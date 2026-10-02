# Explicit supplied-history source policy

Fixed base: `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4` (`origin/main`).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/supplied-history-source-policy`.
Branch: `feat/supplied-history-source-policy`.
Implementation owner: bounded GPT-6.1-Sol worker, high reasoning; primary owns
source-policy decisions, acceptance and two independent review axes.

## Contract

- SH1: Add only the explicit pure `prepareSuppliedHistoryCase(options,
  comparisonProfile)` and `suppliedHistoryPolicy()` API in `mixed-source.mjs`,
  version `cairn-lme-supplied-history-v1`. Preserve legacy v2 behavior, shapes,
  errors and all digests; leave all callers and defaults unchanged.
- SH2: Reuse bounded validation, normalization/redaction, stable greedy
  partitioning, timestamp decoration, origin maps and both planner profiles.
  Include every valid supplied session in original order with roles intact,
  including after/equal question minutes and unordered dates. Preserve floating
  dataset-local minutes; do not guess clocks, sort, repair, clip or select by
  labels. Malformed and over-cap input fails before either arm can execute.
  The question is only a recall query, never ingestion content.
- SH3: Declare all-supplied-history inclusion and timestamp preservation in a
  separate immutable policy with distinct policy/history/turn/case hash domains.
  Report `sessionsAfterQuestion` only in the new result alongside unchanged
  original/eligible/excluded counts. Both policy and case identity must differ
  even when legacy eligible history equals supplied history. Inputs and original
  history remain digest-bound; output is immutable and key-order stable.
- SH4: Write synthetic tests before the implementation and record RED, then
  GREEN. Cover before/equal/after same-day and next-day sentinels, unordered
  dates and equal ties, all-future histories, both profiles, reconstruction of
  every turn body and indexed window, Cairn/Mem0 input parity, v2 digest
  snapshots, normalization/redaction/chunks/astral text and strict validation
  (getters, sparse arrays, prototypes, Unicode, limits, extra fields and oracle
  fields) through the actual API.
- SH5: Document only this additive offline preparation contract in comparison
  docs, limitations and changelog. Distinguish input parity, supplied-history
  fidelity and formal chronology; no certified score or paid-run claims.
- SH6: Run `npm test`, `npm run validate`, `npm run test:longmemeval` and the
  ingestion/comparison/public synthetic demos on Node 22.16.0 and 24.15.0.
  Install existing locked isolated `adapters/openai` dependencies and required
  `tools/plugin-validation` maintainer tooling if needed. Retain raw RED/GREEN
  and gate logs. Inspect scope/diff, freeze a local
  candidate, then primary acceptance and two non-author reviews precede push.
  There is no JavaScript typecheck gate.

## Evidence and boundaries

The [paper §3.1](https://arxiv.org/html/2410.10813v2#S3.SS1) describes the
formal assumption `tq > tN`. The pinned executable supplied-history baselines
enumerate the haystack without a universal question-date cutoff:
[dataset format](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/README.md#dataset-format),
[generation](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/generation/run_generation.py#L66),
[retrieval](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/retrieval/run_retrieval.py#L224).
These supplied primary sources motivate representing both policies honestly;
source fidelity does not establish semantic quality.

Only synthetic data is in scope. No actual study, corpus, book, source,
evaluator, reference answer, environment credential or operational ledger is
read. No model/provider calls, native integration, runner/scorer wiring,
installation caller or prompt change, frozen protocol/operator alteration,
score alteration, merge or release is authorized. Native/scorer/paid-run and
inventory integration remain separate future gates. Keeping supplied later
sessions is neither permission to use future personal data nor official-score
certification.

## Entrypoints and evidence record

The changed entrypoints are two new named exports only. Existing
`prepareMixedSourceCase` callers in generation, evidence, comparison profiles,
controlled runner and demos retain the legacy wrapper and policy. No browser
flows or UI assumptions are affected. Worker owns focused and required offline
checks; primary owns acceptance reruns and independent review coordination.

Raw logs: `/tmp/cairn-supplied-history-gates.7MXtoJ` (new owned evidence directory;
no operational source or study directory was used). Candidate SHA is recorded
in the worker handoff because a commit cannot embed its own SHA.

Before implementation, on both Node 22.16.0 and 24.15.0:

```sh
node tools/testing/run.mjs evaluation/longmemeval/test/supplied-history.test.mjs
```

RED logs: `node-22.16.0-RED.log`, `node-24.15.0-RED.log`. The legacy snapshot
test passed; seven new-API tests failed because the named API did not exist.
The initial implementation run (`node-22.16.0-focused-GREEN.log`) passed 23/25:
two fixture expectations were incorrect (blank text fails `invalid_history`
before normalization; a three-byte ligature fixture exceeded input bytes before
rendering). Fixtures were corrected to preserve existing error precedence and
exercise actual normalization expansion with U+FDFA. No implementation change
was needed for those errors; the correction passed 25/25.

Final focused command on both runtimes:

```sh
node tools/testing/run.mjs evaluation/longmemeval/test/supplied-history.test.mjs evaluation/longmemeval/test/mixed-source.test.mjs
```

`node-22.16.0-focused-snapshots-final.log` and
`node-24.15.0-focused-snapshots-final.log`: 25/25 passed, zero skips. Tests pin
the new policy/history/default-case digests identically across runtimes and
the complete legacy serialized outputs for both profiles. A read-only
fixed-base module import also verified byte-identical legacy output against
`git show 7467aeb:.../mixed-source.mjs`; see
`baseline-output-and-supplied-digests.log`.

The baseline comparison used this read-only command (the fixture is the same
synthetic unordered chronology fixture as the focused suite):

```sh
node --input-type=module -e '
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import * as current from "./evaluation/longmemeval/mixed-source.mjs";
const id = (kind, name) => `lme-${kind}-${createHash("sha256").update(name).digest("hex")}`;
const cid = id("case", "supplied-history-synthetic");
const names = ["next-day", "equal-first", "earlier", "same-day-after", "equal-second"];
const dates = ["2023/10/16 (Mon) 00:00", "2023/10/15 (Sun) 17:53",
  "2023/10/14 (Sat) 09:30", "2023/10/15 (Sun) 17:54", "2023/10/15 (Sun) 17:53"];
const input = { history: { question_id: cid, sessions: names.map((name, i) => ({
  session_index: i, session_id: id("session", name), date: dates[i], turns: [{
    turn_id: id("turn", name), role: i % 2 ? "assistant" : "user", content: `Sentinel ${name}.`
  }] })) }, question: { question_id: cid, text: "Synthetic recall only?", date: dates[1] },
  namespace: { ownerId: "synthetic-supplied-history", scope: "project", projectId: cid } };
let moduleText = execFileSync("git", ["show",
  "7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4:evaluation/longmemeval/mixed-source.mjs"], { encoding: "utf8" });
for (const [relative, local] of [["../../plugins/cairn-memory/lib/redact.mjs",
  "plugins/cairn-memory/lib/redact.mjs"], ["./ingestion.mjs", "evaluation/longmemeval/ingestion.mjs"]])
  moduleText = moduleText.replace(relative, pathToFileURL(`${process.cwd()}/${local}`).href);
const baseline = await import(`data:text/javascript;base64,${Buffer.from(moduleText).toString("base64")}`);
for (const profile of [undefined, "indexed-evidence-v1"]) {
  const old = baseline.prepareMixedSourceCase(input, profile);
  const now = current.prepareMixedSourceCase(input, profile);
  if (JSON.stringify(old) !== JSON.stringify(now)) throw Error("legacy output changed");
  console.log("baseline JSON output identical", profile ?? "default",
    createHash("sha256").update(JSON.stringify(old)).digest("hex"));
}
const result = current.prepareSuppliedHistoryCase(input);
console.log(JSON.stringify({ policy: result.policy.digest,
  case: result.caseDigest, history: result.originalHistoryDigest }));
'
```

Legacy full-output SHA-256: default
`659593e6ab03ce9abc01286b676cc8243471f94218d1bd724d22a98ec4c61e0f`,
indexed-evidence
`4d2598149db430940b5c780c9ac1306054efa723386f2279770e11aae191a16a`.
New policy SHA-256:
`908154ac04430df9ef23063658fd5cf553811466b313dfe0a94022f4002a270b`;
new history SHA-256:
`00c46cda3fd487aa7b2169082712cb33aead8b9be5be1776ad8b97001ea91de5`;
new default-case SHA-256:
`cd4fdc73c4e9e7e09b444e8ae0f736db2a6ae25059fc38ad7600860fe68409a0`.

Existing locked dependencies installed successfully with
`npm ci --prefix adapters/openai` and `npm ci --prefix tools/plugin-validation`;
see `openai-npm-ci.log` and `plugin-validation-npm-ci.log`. Neither install
changed tracked dependency files or installed an application integration.

Elapsed time and token/cost measurements remain unknown; primary acceptance
and independent reviews remain required before push.

The first full-matrix loops did not explicitly disable the parent npm compile
cache. After the primary requested canonical cleanup evidence, cache-disabled
final loops were started in new owned per-runtime temporary roots. To avoid
parallel provisional/final full-suite load, the primary requested stopping the
two provisional loops. Only their validated `integrations/client/testing/run.mjs`
wrapper processes received catchable SIGTERM; they forwarded it to the owned
test runners and both exact invocation workspace paths were verified absent
after termination. `node-22.16.0-test.log` and `node-24.15.0-test.log` are retained
as intentionally interrupted provisional evidence, not passing gates or
unexplained regression failures. No shared process or caller temporary
directory was killed or swept.

## Initial candidate required gate results

For candidate `6713fd18b3e74355dc7406e9d67bc63d61d2ed70`, all commands below
passed on **both exact runtimes**, Node 22.16.0 and
24.15.0, with `NODE_DISABLE_COMPILE_CACHE=1` set on each parent npm invocation.
Each runtime used its corresponding `/home/chichieh/.nvm/versions/node/vVERSION/bin`
at the front of PATH and a newly owned `TMPDIR`/`TMP`/`TEMP` under the log root.
Every final gate log starts with `node --version`, the flag and exact command.

| Command | Node 22.16.0 | Node 24.15.0 | Raw log suffix after `node-VERSION-final-` |
| --- | --- | --- | --- |
| `npm run test` (same script as `npm test`) | 580/580, zero skips | 580/580, zero skips | `test.log` |
| `npm run validate` | passed | passed | `validate.log` |
| `npm run test:longmemeval` | 201/201, zero skips | 201/201, zero skips | `test-longmemeval.log` |
| `npm run demo:longmemeval-ingestion` | passed | passed | `demo-longmemeval-ingestion.log` |
| `npm run demo:longmemeval-comparison` | passed | passed | `demo-longmemeval-comparison.log` |
| `npm run demo:longmemeval-public` | passed | passed | `demo-longmemeval-public.log` |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin passed | marketplace and strict plugin passed | `plugin-validation.log` |

Cleanup evidence: `node-22.16.0-final-cleanup.log` and
`node-24.15.0-final-cleanup.log`. The owned roots were empty after generic tests,
validation and the full LongMemEval suite. Existing ingestion/comparison demos
retain two synthetic SQLite output directories per runtime by their established
contract; public-demo scratch was removed, and plugin validation added nothing.
Those outputs remain retained under the new owned evidence roots; no caller
temporary directory was swept.

Initial candidate scope inspection and `git diff --check` passed. Only the renderer, focused
test file, this plan, comparison docs, limitations and changelog are changed.
Existing caller tracing confirms no new API use in a runner, host, installation
caller, scorer, adapter, ledger or core. All implementation/test content covered
by these gates was unchanged at that freeze; only this evidence record was
completed afterward. No JavaScript typecheck exists. No provider, paid model,
actual corpus, operational ledger or semantic score was used.

## Independent Spec review correction: whole-output key order

The Spec reviewer found P2 against candidate `6713fd18`: although case digests
were key-order stable, the returned `originalQuestion` retained the caller's
key insertion order. Reordering otherwise identical valid inputs therefore
changed `JSON.stringify(output)`, contrary to SH3's whole-output stability.
The correction constructs only the supplied-history result's `originalQuestion`
in accepted field order `question_id`, `text`, `date`. It preserves the original
values and exact schema; legacy v2 retains the original snapshot unchanged.
No policy, digest input, normalization, validation, caller or input limit changes.

Before the correction, two independent regression tests (default and
`indexed-evidence-v1`) reversed keys throughout history, question and namespace,
while retaining all array/source order. Both whole-JSON equality tests failed
on both exact runtimes. RED command:

```sh
NODE_DISABLE_COMPILE_CACHE=1 node tools/testing/run.mjs --test-name-pattern='SH3 full output' evaluation/longmemeval/test/supplied-history.test.mjs
```

Raw RED logs: `node-22.16.0-review-whole-output-RED.log` and
`node-24.15.0-review-whole-output-RED.log` (2/2 failures per runtime).
An earlier initial single-test RED probe remains in
`node-VERSION-review-key-order-RED.log`; the separate profile tests provide
the complete before-fix evidence. After the correction, the focused command
documented above passed 27/27 on both runtimes in
`node-VERSION-review-focused-GREEN.log`. The regression also checks fixed
question field order, question immutability and separately stable serialized
rendered history, Cairn plan, Mem0 inputs and origin maps. Legacy full-output
snapshots for both profiles and old/new digest snapshots remain unchanged.

The correction changes only the renderer, focused test and this evidence plan.
The primary explicitly permitted reuse of unaffected generic gates, tied to
the exact prior candidate and dependency/configuration scope. The 580/580
generic results above are carried forward from `6713fd18`, not reported as
rerun against the correction. A source trace with
`rg -n 'mixed-source\.mjs|prepareSuppliedHistoryCase|suppliedHistoryPolicy' core plugins integrations evaluation/architecture -g '*.mjs'`
found no generic-suite dependency importing the changed renderer/API. The
generic test roots mention LongMemEval only in a frozen package-script inventory
fixture. `package.json`, CI, CONTRIBUTING, the test runner and generic suite
configuration/dependencies are unchanged. The repository's review-fix workflow
requires affected checks; full LongMemEval, validation, all three synthetic
demos and marketplace/strict plugin validation were rerun for this correction
on both exact runtimes with the parent compile cache disabled.

| Correction gate | Node 22.16.0 | Node 24.15.0 | Raw log suffix after `node-VERSION-review-` |
| --- | --- | --- | --- |
| Focused renderer/regression command above | 27/27, zero skips | 27/27, zero skips | `focused-GREEN.log` |
| `npm run validate` | passed | passed | `validate.log` |
| `npm run test:longmemeval` | 203/203, zero skips | 203/203, zero skips | `test-longmemeval.log` |
| `npm run demo:longmemeval-ingestion` | passed | passed | `demo-longmemeval-ingestion.log` |
| `npm run demo:longmemeval-comparison` | passed | passed | `demo-longmemeval-comparison.log` |
| `npm run demo:longmemeval-public` | passed | passed | `demo-longmemeval-public.log` |
| `npm run validate --prefix tools/plugin-validation` | marketplace and strict plugin passed | marketplace and strict plugin passed | `plugin-validation.log` |

The correction's `node-VERSION-review-cleanup.log` records empty newly owned
TMPDIR roots after validation and LongMemEval tests. As before, only the
existing ingestion/comparison demos retain their two synthetic SQLite output
directories per runtime; public-demo scratch is removed and plugin validation
adds nothing. All corrected gate logs begin with exact runtime version and
command. The RED log's command-header shorthand used `SH3-full-output`; the
actual executed pattern was the quoted `SH3 full output` command above, as
shown by both failing named tests. Raw assertion output is retained unchanged.
`git diff --check` passed before the corrected scoped candidate commit.
