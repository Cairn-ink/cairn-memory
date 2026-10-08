# Explicit canonical-source staging in the native Hermes provider

Status: acceptance fixed before implementation. Local MCP dependency #375 has
passed primary offline gates, independent review and all 21 latest-head CI checks
(run 37828732348). Primary authorized the bounded implementation; primary integrated
acceptance is complete. Fixed-commit independent reviews and latest-head CI remain pending.
Base: `5a764091b9b9cfc3a10d7cc0ec338c722c8a4aaa`.
Branch: `feat/hermes-canonical-staging`; target `feat/indexed-canonical-mcp`.

## Outcome and limits

Allow a deliberately configured native `memory.provider: cairn` to use the same
installed public engine's bounded canonical retention and exact management.
This is a thin host integration, not another memory engine or automatic capture.
Keep submitted roles and source text untrusted; retaining a conversation does
not certify its interpretation, currentness or execution authority.

Primary chooses to include separate access-only management in this slice: a
person who disables new retention must still be able to inspect/discard old
sources without a provider key. Existing profile identities and default five
tools stay unchanged. No provider call, corpus replay or new score is authorized
by this packet. Campaign ceiling remains US$400 with US$30 protected.

## Acceptance fixed before coding

- N1 Accept only explicit `capture_source_policy: indexed-staged-v1` and optional
  `capture_evidence_access: staged-v1`; unsupported values and simultaneous own
  qualification/canonical capture reject before saving configuration or opening
  profile memory. No environment opt-in, inferred consent or fallback mode.
  Omission preserves every existing valid configuration. Access-only may coexist
  with the existing qualified capture or independent classification recovery;
  it must not enable capture or new retention by itself.
- N2 Native discovery and dispatch derive one consistent tool inventory. Plain
  defaults stay five. Canonical mode adds capture and exact inspect/discard
  (eight tools); recovery adds its existing two independently. Access-only adds
  exactly inspect/discard. Preserve deep-copy schemas, UUID/profile binding,
  CLI/primary restrictions, inert lifecycle hooks and existing message identity.
  Do not claim an actual Hermes session ID is forwarded when the bridge uses
  the existing MCP default; no identity migration in this packet.
- N3 Bridge validates and forwards exactly the existing MCP flags, including
  compatible explicit `capture_deadline_ms` canonical decimal string 1–110000
  for either capture mode. Preserve absent-deadline behavior and capture/helper/
  outer timeouts, no retry or raised cap. The pinned wizard supports AND-only
  `when`, not OR: show the deadline as an optional field with clear either-mode
  requirement, retaining strict validation. Exercise the real setup prompt
  function with controlled inputs rather than inventing a host schema feature.
- N4 Credential isolation remains unchanged. Only explicit capture/recall/
  classification receives the dedicated Cairn model key; discovery, exact
  evidence inspection/discard and manual tools receive none. No generic key,
  `NODE_OPTIONS`, provider network fallback or transcript logging. Demonstrate
  invalid config and discovery do not touch real profile memory. Setup remains
  subject to existing non-atomic wizard/restart limitations; do not overclaim.
- N5 Through pinned actual Hermes MemoryManager, SDK bridge and a freshly
  installed/hash-checked local artifact, synthetic empty, malformed and failed
  extraction preserves late canonical details and assistant attribution.
  Nonempty capture has `qualificationStatus: not-requested`, selected receipts
  only and no qualifier call. New keyless manager reads the exact source/format/
  expiry after retention is disabled. Ordinary memory/recall excludes staging.
  A scripted AIAgent dispatch exercises the real native routing, not natural
  model tool selection or semantic reliability.
- N6 Same-batch replay makes no extra model calls or expiry extension; policy
  conflicts and discarded events remain explicit failures. Wrong profile cannot
  inspect the source, tool arguments cannot inject authority, discard does not
  forget admitted memories, and a later same-ID capture cannot bypass closure.
  Preserve default, qualified and recovery-mode regression behavior. Missing
  model can retain failed source but is never reported as successful ingestion.
- N7 Keep native `json.dumps(args)` 60000-character admission, bridge 65537-byte
  bounded read, MCP 65536-byte input and 262144-byte encoded-result/output checks.
  Exercise Unicode/escaped payloads and configuration-envelope overhead on real
  bridge calls, including one near-boundary accepted case and explicit refusal
  without partial writes or payload reflection. Do not enlarge/truncate/retry
  merely to fit; a core-legal payload need not fit every host boundary.
- N8 All tests use synthetic fresh profiles and immediately registered teardown
  for managers, agents, subprocesses, archive/install roots and test scratch.
  Success and deliberate failure leave no unexpected owned residue; attempt all
  cleanup even if one disposer fails. Never inspect existing user profiles or
  clean historical directories. Shared dependency installs and pinned host source
  remain unchanged; required prerequisites absent means blocked, not skipped.
- N9 Primary runs the pinned host's canonical runner, no file retries, for all
  existing five native files and new tests on exact Node22.16.0/24.15.0. Record
  actual exits, fresh installed source hashes and cleanup evidence. Also run
  generic/JSON/strict maintainer checks on both runtimes, relevant Python syntax
  checks and any affected public integration gates. No TypeScript gate exists.
  Independently cross-check changed-file inventories; two nonauthor fixed-commit
  Standards/Spec reviews and all latest-head CI checks plus mergeability must
  pass before ready delivery. No merge, release or deployment.

## Scope and ownership

Production scope is only `integrations/hermes/cairn/__init__.py` and `bridge.py`.
Use one new `integrations/hermes/test/test_canonical_staging.py`, reusing
existing safe test fixtures, and narrow wizard/schema assertions in existing
`integrations/hermes/test/test_qualified_provider.py`. No other existing test or
conftest changes are authorized. If a dedicated fixture is necessary, propose
its path before creation. Documentation: this plan,
`integrations/hermes/cairn/README.md`, `docs/hermes-memory-provider.md`,
`docs/protocol.md`, `docs/limitations.md` and `CHANGELOG.md`. Primary also
authorizes current exposure statements in `docs/staged-capture-evidence.md` and
`docs/standalone-mcp.md` to link the separately verified native opt-in, retaining
no installer/automatic capture/discovery/semantic claims and historical records.

No core/MCP runtime, schema, prompt, model, transport limit, dependency, packaging
inventory, host source, CI, ledger or historical evaluation-result changes.
Do not add hooks, source discovery/search, re-extraction, permanent archiving,
semantic gates, a public release, upstream listing or new product-quality claim.

One actual GPT-6.1 Sol/high worker implements after explicit primary dispatch.
Primary owns this contract, integration, independent source inspection, direct
acceptance and delivery; two separate nonauthor agents own review axes. Keep a
meaningful preimplementation failure, actual command exits, corrections and
entrypoint/caller coverage. Do not edit files during primary frozen-file gates.

## Read-only prerequisite discovery

Existing host source archive directory names Hermes 0.21.1 revision
`c8aa5608c24e3636e77c267650c0f1f52e44adb0`; its Python 3.11.12 virtual environment
and canonical `scripts/run_tests.sh` are present. Presence/name is not source or
dependency authentication: verify the retained archive and relevant installed
versions before execution. Main has read the canonical shell runner and the
wizard's actual AND-only condition. Read the Python runner before executing it,
and ensure its temporary roots are owned and cleaned. Do not use its full-suite
default. Detailed local paths belong in the private checkpoint, not setup claims.

This plan is not implementation or native-host acceptance. Bounded source
discovery and answer utility remain later work after this exact recovery path.

Read-only preflight narrows the authored scope to 12 paths: two production,
two test and eight documentation files. The retained host virtual environment has
an editable finder pointing to the original source. Verification therefore uses
a fresh owned extraction of the authenticated archive and a read-only virtual-
environment link, with in-test assertions that actual MemoryManager, AIAgent
and wizard module paths come from the fresh extraction, not the old host tree.
The original host and dependency install remain untouched. The canonical runner
writes duration/bytecode caches, so keep them inside the owned extracted tree;
forward owned TMP/TEMP and verify cleanup rather than trusting its ignored
cleanup errors. Missing or incorrectly sourced dependencies block the gate.

## Author implementation and retained corrections

Actual GPT-6.1 Sol/high implemented the named 12-path packet after primary
authorization. Core/MCP/defaults, keys, provider services, shared dependencies,
host source, CI, historical plans/results and ledgers are unchanged. The native
provider's validation/discovery/setup and bridge forwarding are the only two
production paths. Existing wizard callers required unconditional deadline
assertion plus two extra optional-field blank inputs in `test_qualified_provider.py`;
the new canonical file reuses only safe isolated-profile/response fixtures.

The meaningful preimplementation native test failed on both exact Node versions
with actual exit 1 (one failed, zero passed): legacy validation rejected the new
policy, after actual fresh MemoryManager/AIAgent/wizard module paths/hashes and
all 96 installed source-file hashes passed. Those baseline runs used owned source
and cleanup but predated filesystem/network containment; they are not containment
evidence. Private raw argv/logs are retained under `/tmp/cairn-n43-author.gCV77L8s`.

Private runner corrections were setup failures, not product failures: readonly
npm pack needed a cache-temp write (`EROFS`, child status 226); namespace-specific
`/proc` must follow the readonly root bind, and an owned `/dev` mount is needed for
interpreter entropy. Final orchestration preserves HOME unchanged, verifies
PID/proc correspondence, namespace-owned PID 1, readonly shared paths, an owned
write canary and separate empty-route network namespace before execution. Only
eight exact cached production metadata/tarball entries (17,667,523 bytes) are
copied to an owned cache; integrity is checked and no registry access occurs.
Private npm arguments select that cache and disable compile-cache writes.

Initial contained focused verification on Node 22 returned actual exit 1: 17 passed/5 failed.
Four new fixture assertions used the wrong conflict code; actual existing code
is `event_payload_conflict`. Another assumed the host's unknown-tool response had
a core `ok` field; real MemoryManager returns `tool_error`. The runner also caught
npm's owned `node-compile-cache`; this was removed by whole-root cleanup and then
prevented through the private child setting. Both next focused runs returned
actual exit 1: 25 passed/1 failed, solely because the near-native Unicode fixture exceeded
the unchanged 6,000-token extraction request ceiling (11,407 local tokens).
The controlled correction changes only its repeated stem from 2,300 `中` characters
to 460 `こんにちは` repetitions, preserving 3,000 UTF-16 units/message × 4 and the
same escaping/suffix mix; primary measured 4,047 local tokens and actual fit.
No production token/context/transport limit was raised or success assertion weakened.

N6 was not loosened: canonical failed/malformed/timed-out events are closed on
identical replay, unlike ordinary nonstaged admission semantics. Primary's actual
synthetic core probes on both Nodes resolved the initial source-reading concern;
native cases assert the same closure/no-model-call/unchanged-expiry behavior.
Configuration-envelope refusal can create a profile owner directory but no DB
or captured source. Oversized result tests use a synthetic SDK server, not an
actual-core output-overflow claim. All manager/provider teardown is registered
before discovery/initialization; agent teardown immediately after construction.
The deliberate cleanup failure attempts every disposer and removes the owned
profile. Full primary six-file/generic/JSON/maintainer gates remain pending.

## Recovered author checkpoint and entrypoint coverage

After the prior author was lost during a daemon restart, primary assigned the
remaining corrections to an actual GPT-6.1 Sol/high author on the same worktree,
branch and fixed base. The recovered packet changes no production behavior.
The fake HTTP fixture now logs both `/responses/input_tokens` and `/responses`
using separate count/generation method labels. Replay, policy conflict, refusal
and keyless management assertions therefore compare the complete provider log;
deadline and scripted AIAgent expectations require exactly count then generation.
Canonical failure replay still requires `capture_evidence_closed`, no additional
HTTP and unchanged expiry. The current documentation command names all six native
files with `--jobs 1 --file-retries 0`; the older five-file, 22-test and 72-hash
result remains explicitly historical. Setup inventories distinguish qualified
capture from canonical capture and do not double-count exact management tools.
Spacing corrections are confined to this packet's new prose; N1–N9 are unchanged.

The retained pre-recovery `focused3` records show actual exit 0 on both Node
22.16.0 and 24.15.0: two files, 26 passed, zero failed each. Each verified all
96 installed artifact source hashes and 11 unchanged pinned-host source hashes,
then removed its whole owned root. Those completed runs were inspected, not
repeated. The recovered author's affected single-file `focused4` gate uses the
fully inspected unchanged private runner and actual pinned shell/Python canonical
runner, again with one worker and no file retry. Primary integrated gates,
fixed-commit Standards/Spec review and latest-head CI remain pending. Elapsed
author recovery time and token/cost measurements are not available.

| Changed entrypoint / dependent caller | Requirements and observable evidence | Owner of remaining acceptance |
| --- | --- | --- |
| Native configuration validation, setup schema and pinned `_prompt_schema_fields` / `cmd_setup` | N1/N3/N4: strict flags, own-field conflict, either-mode deadline, real controlled wizard prompts; narrow existing qualified wizard assertions updated | Author focused cases; primary full six-file matrix |
| Native discovery and MemoryManager dispatch, including scripted AIAgent routing | N2/N4/N5/N6: all capture/access/recovery inventory unions, copied schemas, inert hooks, key isolation, fixed profile binding and synthetic explicit agent dispatch | Author canonical cases; primary legacy provider/conversation regressions |
| Python SDK bridge to installed MCP capture and exact evidence management | N3/N5/N6: actual installed engine, late assistant/user source recovery, selected receipts, keyless restart, unchanged expiry, policy/profile/discard fences and full HTTP log comparisons | Author canonical cases; primary affected public integration gates |
| Native admission and bridge transport boundaries / lifecycle cleanup | N7/N8: accepted Unicode fixture, pretransport refusal, envelope overhead, synthetic SDK output ceiling, late extraction deadline, registered all-disposer cleanup | Author canonical cases; primary syntax and containment acceptance |
| Setup guide and current exposure documents | N2/N9: qualified versus canonical inventory, management union, explicit current six-file command, retained historical results and unchanged semantic/installer limits | Primary document and fixed-diff review |

There is no browser route or browser replay in this packet. Existing default,
qualified capture, independent recovery and source-context recall callers remain
in the primary's six-file regression matrix; no other test fixture or caller was
edited. Source-level coverage does not replace those required integrated runs.

The 12-file delivery inventory was mechanically derived from `git diff --name-only
HEAD` plus `git ls-files --others --exclude-standard`, restricted to regular files,
then independently derived from NUL-delimited `git status --porcelain=v1 -z` with
the same regular-file boundary. The lists matched exactly, count 12. The three
pre-existing dependency symlinks were identified separately and remain excluded.

- `CHANGELOG.md`
- `docs/hermes-memory-provider.md`
- `docs/limitations.md`
- `docs/plans/hermes-canonical-staging.md`
- `docs/protocol.md`
- `docs/staged-capture-evidence.md`
- `docs/standalone-mcp.md`
- `integrations/hermes/cairn/README.md`
- `integrations/hermes/cairn/__init__.py`
- `integrations/hermes/cairn/bridge.py`
- `integrations/hermes/test/test_canonical_staging.py`
- `integrations/hermes/test/test_qualified_provider.py`

Both recovered author `focused4` runs are closed with actual exit 0: one file,
13 passed and zero failed on each exact Node version (193.9 seconds on 22.16.0;
176.0 seconds on 24.15.0). Each used a fresh offline-installed artifact with
SHA-256 `b2c331558f47b156b679b4f8584d7972cb21d0d755c1e35a5c942a4511a401df`;
all 96 installed source hashes and 11 pinned-host source hashes matched.
Every recorded containment/setup/test command exited 0 with no signal or error.
The scratch check found only its exact intentionally retained builder directory;
whole-owned-root teardown then removed it, with `ownedRemoved: true` and an
independent existence check confirming absence for both roots. Raw setup/test
logs and JSON command/cleanup records remain private under
`/tmp/cairn-n43-author.gCV77L8s/focused4-{22.16.0,24.15.0}.{log,json}` and the
corresponding `-setup.log` paths. No file retries were used.

Plan-only evidence additions occurred while author focused runs were active;
this is not a claim that all 12 files were immutable during those author runs.
The final 12-file plus private-helper hash freeze occurs only after both runs
closed and this final evidence append. Private helper SHA-256 remains
`312d42f0b14ceebb789fa7a8e981cbf34941676cea759220df642f7e3ea9a3a5`.
Primary owns the subsequent nine frozen-file gates, full integrated acceptance,
candidate commit, both nonauthor review axes, branch delivery and latest-head CI.

## Primary integrated verification — nine closed gates

The primary agent personally ran and completed the nine integrated commands on
the frozen candidate; these are primary acceptance results, not author reruns.
The orchestration session closed with actual exit 0. Every command recorded actual
exit 0, no signal and no launch error. On each exact Node 22.16.0 and 24.15.0,
the native six-file matrix passed 35/35 with zero failures (351.0 and 299.9 seconds
respectively), and the generic 21-file suite passed 581/581 with zero failures,
skips or cancellations. JSON validation and strict maintainer validation each
exited 0 on both runtimes. The separate Python AST check parsed all four changed
Python files and exited 0. No TypeScript gate exists in this repository.

Exact command arguments are recorded in the private `results.json`; the commands
below express the same eight runtime invocations with `n43_node_bin` set in turn
to `/home/chichieh/.nvm/versions/node/v22.16.0/bin` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin`, and `n43_node_version` set to the
corresponding exact version. All commands ran from the task worktree. Native
paths were enumerated through filesystem reads and independently cross-checked
with `find`, count six; the same two routes agreed on 21 generic files.

```sh
"$n43_node_bin/node" /tmp/cairn-n43-author.gCV77L8s/run.mjs "$n43_node_version" primary \
  integrations/hermes/test/test_agent_conversation.py \
  integrations/hermes/test/test_canonical_staging.py \
  integrations/hermes/test/test_capture_recovery.py \
  integrations/hermes/test/test_provider.py \
  integrations/hermes/test/test_qualified_conversation.py \
  integrations/hermes/test/test_qualified_provider.py
"$n43_node_bin/node" integrations/client/testing/run.mjs --test-concurrency=1 \
  evaluation/architecture/test/augmented-model.test.mjs \
  evaluation/architecture/test/checklist-model.test.mjs \
  evaluation/architecture/test/full-label-model.test.mjs \
  evaluation/architecture/test/official-six-v3-report-integrity.test.mjs \
  evaluation/architecture/test/probes.test.mjs \
  evaluation/architecture/test/query-evidence-checklist.test.mjs \
  evaluation/architecture/test/selection-augmentation.test.mjs \
  evaluation/architecture/test/small-candidate-model.test.mjs \
  evaluation/architecture/test/source-answer-accounting.test.mjs \
  evaluation/architecture/test/source-coverage-ranking.test.mjs \
  evaluation/architecture/test/synthetic-lineage.test.mjs \
  plugins/cairn-memory/test/benchmark-suite-registration.test.mjs \
  plugins/cairn-memory/test/capture-filter.test.mjs \
  plugins/cairn-memory/test/capture-lock.test.mjs \
  plugins/cairn-memory/test/client-bundle.test.mjs \
  plugins/cairn-memory/test/hosted-quota.test.mjs \
  plugins/cairn-memory/test/identity.test.mjs \
  plugins/cairn-memory/test/pause-capture.test.mjs \
  plugins/cairn-memory/test/protocol.test.mjs \
  plugins/cairn-memory/test/recall.test.mjs \
  plugins/cairn-memory/test/transcript.test.mjs
"$n43_node_bin/npm" run validate
"$n43_node_bin/npm" run validate --prefix tools/plugin-validation
```

The native helper invokes the authenticated pinned host's actual
`scripts/run_tests.sh` with all six absolute paths, `--file-retries 0 --jobs 1`,
and pytest arguments `--cairn-executable` pointing to the fresh installed artifact,
`--cairn-node` pointing to the exact runtime, `-q -p no:cacheprovider`. Complete
containment and canonical-runner argv are retained in each primary native JSON
record. The ninth command was:

```sh
/usr/bin/python3 -B -c "import ast,pathlib; files=['integrations/hermes/cairn/__init__.py','integrations/hermes/cairn/bridge.py','integrations/hermes/test/test_canonical_staging.py','integrations/hermes/test/test_qualified_provider.py']; [ast.parse(pathlib.Path(p).read_text(), filename=p) for p in files]; print('syntax passed',len(files))"
```

Both native runs used fresh offline installations of artifact SHA-256
`b2c331558f47b156b679b4f8584d7972cb21d0d755c1e35a5c942a4511a401df`.
All 96 packaged source-file hashes matched the installed files, and all 11
authenticated pinned-host source hashes remained unchanged. The contained runner
verified PID/proc ownership, separate empty-route network namespace and read-only
shared paths. Each scratch check found only its exact builder directory before
whole-root cleanup; both records report `ownedRemoved: true`, and both roots were
independently confirmed absent. No file retries, real keys, provider service,
user profiles, operational ledgers or dependency changes were used.

Primary mechanically derived the 12-file inventory through NUL-delimited
`git diff --name-only` plus untracked files and independently through
`git status --porcelain=v1 -z`; the lists matched, count 12, excluding only the
three identified dependency symlinks. All 12 hashes and the unchanged helper hash
matched before/after every gate and through completion. The tested plan hash was
`ef318bc2f19b70e17fd08bdd54b46c649a1c15472ee06882d5036285eacc4ae2`;
only this subsequent plan status/evidence update changes those tested bytes.
The other 11 candidate files and the helper remain frozen.

Raw orchestrator source, exact commands, hash inventories, results and gate logs
remain under `/tmp/cairn-hermes-canonical-gates.M1blsbeC/{run.mjs,results.json,*.log}`.
Raw native source/install/cleanup records remain under
`/tmp/cairn-n43-author.gCV77L8s/primary-{22.16.0,24.15.0}.{json,log}` and the
corresponding `-setup.log` paths. Earlier pending statements above describe their
historical checkpoint. Integrated acceptance is now complete; candidate commit,
both fixed-commit nonauthor reviews and latest-head CI remain pending. These
mechanical gates do not implement or validate the separate raw-layer contract
or expand capture, retention, semantic-quality or delivery claims.
