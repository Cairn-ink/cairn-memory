# Offline MOC title boundary matrix

Status: worker offline verification complete after the primary's explicit
`live closed, gates permitted` checkpoint; primary key-path acceptance passed,
and candidate freeze plus independent fixed-diff review remain. This is a
test/documentation change, not an engine fix, classification policy or paid-run
authorization.

Worktree: `moc-title-boundary-matrix`, branch `test/moc-title-boundary-matrix`.
Fixed base: `4ded0564963a680d3b2d2b7fab8c82931ac38d28` (PR #300).
Primary owns acceptance and delivery; the bounded implementation worker was
dispatched as GPT-6.1 Sol/high. Runtime model selection is the primary's dispatch
record; this document does not independently attest it. No commits or pushes
are authorized for this worker packet.

## Acceptance contract

- T01: actual fake-HTTP OpenAI adapter through indexed-evidence `core.capture`
  rejects a visible exact duplicate new L1 title; the same fixture completes
  when the output explicitly references the existing wire-catalog L1 ID.
- T02: case, NFKC compatibility characters and whitespace variants traverse the
  same adapter/capture path and receive `moc_title_conflict`; observations prove
  the existing topic title was visible and no new group or placement appears.
- T03: actual public source-binding invalidation makes a retained MOC's model
  catalog title null; a new proposal for its reserved title still fails. No
  hidden title appears in that model request or source-free diagnostic stream.
- T04: a new L1 whose `newL2Title` matches an existing visible L2 fails atomically;
  a new L1 referencing that visible L2's ID succeeds without creating another L2.
- T05: existing L1 T has an actual L2 parent P, which is absent as an edge from
  model catalog input. A duplicate new T with empty `parentL2Ids` fails and
  leaves the admitted memory unfiled. Explicit existing-T reuse succeeds, and
  public maps then expose P -> T -> memory. No automatic reuse is implemented.
- T06: public namespace, memory/index revision, reference-level and link guards
  reject invalid proposals with unchanged receipts, organization and index.
  A foreign namespace's title does not reserve the same title locally, and
  foreign IDs/titles remain absent from local model requests. No arbitrary
  hierarchy link or guarded-operation bypass is introduced.
- T07: fixtures use `createTestWorkspace` plus immediate teardown registration;
  all runs use the owned runner. Required two-runtime gates are recorded only
  after execution, with no semantic or historical paid-cause claim.

## Caller trace and scope

The new entrypoint is
`adapters/openai/test/classification-title-boundaries.test.mjs`, discovered by
the existing `test:openai` glob. It uses injected synthetic `fetchImpl` and
the real adapter's wire aliases, schema and output validation. `core.capture`
performs real indexed-evidence admission, classification and apply, preserving
the initial-attempt journal. Model-facing request bodies are asserted directly.

`classificationWire` replaces IDs but preserves catalog titles;
`schemas.mjs` restricts existing IDs by hierarchy level and permits new title
strings only for an exhausted catalog. `classification.mjs` validates visible
levels and complete-map creation. `moc-storage.mjs` applies namespace/revision
checks and same-level canonical title reservation. Classification's MOC-only
catalog omits ancestry edges, while public maps expose them. The tests call
public `applyPlacement` and `linkMocs` only to exercise their unchanged refusals;
they do not write SQLite directly or alter production adapters/prompts.

Only this new test, this plan and an appended `docs/limitations.md` note are in
scope. Existing tests, runtime, prompts, policies, corpus, credentials, operational
ledgers, historical paid output and concurrent experiment worktrees are excluded.

## Evidence and execution gate

Read-only baseline at the fixed base, before this implementation packet:

```sh
PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:$PATH node tools/testing/run.mjs adapters/openai/test/classification-application-boundary.test.mjs
```

Observed 6/6 pass, 1,630.84 ms. The existing real-chain fixture verifies
`completed, partial, not_run`, retained `moc_title_conflict`, completed adapter
validation, zero model diagnostics, retained admission/receipt and failed initial
journal; its existing-L1 control completes all three planned batches. This
baseline does not establish the new matrix or the historical paid cause.

Planned gates on Node 22.16.0 and 24.15.0:

```sh
node tools/testing/run.mjs adapters/openai/test/classification-title-boundaries.test.mjs
node tools/testing/run.mjs adapters/openai/test/classification-application-boundary.test.mjs
npm run test:openai
npm test
npm run validate
node tools/testing/run.mjs --script examples/moc-placement.mjs
node tools/testing/run.mjs --script examples/capture.mjs
node tools/testing/run.mjs --script examples/openai-offline.mjs
```

The pinned existing Claude 2.1.260 CLI must also validate marketplace/plugin
strictness using the repository's existing maintainer command. No dependency
installation, heavy command or test run occurs before that permission. No
operational script is needed; `scripts/README.md` does not exist in this memory
repository. The JSON validator is the documented non-operational contributor gate.

### Execution evidence

The primary released the live gate before these runs. Only the matrix worktree's
existing locked OpenAI dependency set was installed:

```sh
PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:$PATH npm ci --prefix adapters/openai --ignore-scripts --no-audit --no-fund
```

It added the single pinned package successfully; no lockfile changed. Each
command below ran from this worktree with `PATH` prefixed by the exact runtime
directory `/home/chichieh/.nvm/versions/node/v22.16.0/bin` or
`/home/chichieh/.nvm/versions/node/v24.15.0/bin` respectively:

```sh
node tools/testing/run.mjs adapters/openai/test/classification-title-boundaries.test.mjs adapters/openai/test/classification-application-boundary.test.mjs
node tools/testing/run.mjs --test-concurrency=1 adapters/openai/test/*.test.mjs
node tools/testing/run.mjs plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs
node tools/testing/run.mjs --script scripts/validate-json.mjs
node tools/testing/run.mjs --script examples/moc-placement.mjs
node tools/testing/run.mjs --script examples/capture.mjs
node tools/testing/run.mjs --script examples/openai-offline.mjs
```

The adapter and generic commands are the repository npm gates' exact underlying
owned-runner invocations. The JSON validator also uses owned script mode.
The demo's printed retained database path is inside its runner-owned directory;
the outer runner removes that newly owned directory after successful exit.
No historical directory cleanup was performed.

For the existing pinned CLI, this direct version read returned
`2.1.260 (Claude Code)`:

```sh
/home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/.bin/claude --version
```

Its executable is native, so owned script mode used the
same installed package's fallback launcher, also verified as 2.1.260 on each
runtime. Exact commands, each prefixed with that runtime's `PATH`, were:

```sh
node tools/testing/run.mjs --script /home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs --version
node tools/testing/run.mjs --script /home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs plugin validate .
node tools/testing/run.mjs --script /home/chichieh/Github/cairn-memory-worktrees/installed-classification-followup/tools/plugin-validation/node_modules/@anthropic-ai/claude-code/cli-wrapper.cjs plugin validate plugins/cairn-memory --strict
```

This matches the maintainer package's marketplace and strict plugin checks; no
dependency installation or mutation occurred in that other worktree.

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| New matrix plus unchanged six-test regression | 12/12 pass, 3924.57 ms | 12/12 pass, 3857.83 ms |
| Full OpenAI suite | 336/336 pass, 139356.05 ms | 336/336 pass, 118925.45 ms |
| Generic suite | 131/131 pass, 3592.37 ms | 131/131 pass, 3729.94 ms |
| JSON/version validation | exit 0 | exit 0 |
| MOC, capture and OpenAI offline demos | 3/3 exit 0 | 3/3 exit 0 |
| Claude 2.1.260 marketplace / strict plugin validation | 2/2 pass | 2/2 pass |

All gates passed on their first invocation; no verification failure or fixture
correction occurred. Exact runtime `--version` reads returned `v22.16.0` and
`v24.15.0`. These are pre-commit worker results at the fixed base plus the three
scoped uncommitted files; primary acceptance, candidate commit and independent
review are separate. No runtime/prompt/policy, existing test or lockfile changed.
The tests use scripted responses and synthetic source data, not semantic-quality
judgments. `git diff --check` passed before the authored checkpoint and after
the evidence updates.

### Primary acceptance checkpoint

The primary personally inspected all 288 lines of the new fixture, this plan
and the limitations diff, confirming only the three scoped files and no runtime
change. The primary independently reran the exact focused pair through the
owned runner, plus `npm test` and `npm run validate`, on both exact runtimes:

| Primary check | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Focused pair | 12/12 pass, 3783.85 ms | 12/12 pass, 3626.30 ms |
| Generic `npm test` | 131/131 pass, 3887.23 ms | 131/131 pass, 3514.41 ms |
| `npm run validate` | exit 0 | exit 0 |

The primary reported no failures and will freeze the candidate after worker
handoff. This checkpoint is pre-commit acceptance, not independent fixed-diff
review, CI evidence or a semantic-quality result.

## Limits and next direction

Passing scripted fixtures demonstrates mechanics and refusal boundaries, not
real-model compliance, semantic topic equivalence or the cause of an old paid
failure whose rejected plan was not retained. A canonical same-title match
proves uniqueness refusal, not interchangeable topology: reusing T can place a
memory under unseen P even when the proposed new T requested no L2 parents.
Potential prevention work should first freeze an explicit topology contract,
then test prompt guidance or bounded source-free refusal diagnostics offline.
Automatic exact-title reuse, title suffixing, hidden-title disclosure and any
engine repair remain outside this packet.
