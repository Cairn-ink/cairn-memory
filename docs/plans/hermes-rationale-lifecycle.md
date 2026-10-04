# Explicit native Hermes rationale lifecycle

## Frozen implementation contract (2026-10-05)

Goal: reuse the public lightweight memory engine through the ordinary Hermes
native provider, while preserving source provenance and honest unknown states.
This is an offline integration packet, not a new semantic benchmark or paid run.

Implementation base: `0e2c0942ef3d8f4b4889d3b6d7e037a356ff89d0`, branch
`feat/hermes-rationale-lifecycle`, isolated sibling worktree. This depends on the
MCP lifecycle packet, which depends on #335, #334 and #333. Primary owns the
contract, integration and direct acceptance. One bounded worker implements it;
requested/actual model is GPT-6.1 Sol/high. Separate nonauthor Standards and Spec
reviewers inspect the same final fixed diff. Worker has no Git/delivery authority.

### Allowed files

- `integrations/hermes/cairn/__init__.py`
- `integrations/hermes/cairn/bridge.py`
- `integrations/hermes/test/test_qualified_provider.py`
- new `integrations/hermes/test/test_rationale_conversation.py`
- `integrations/hermes/cairn/README.md`
- `docs/hermes-memory-provider.md`
- this plan
- `docs/limitations.md`
- `CHANGELOG.md` (user-visible preview behavior, not a release)

No core/MCP engine, prompt, wire format, schema, package/lock, CI, plugin.yaml,
version, hook, default recall preference, timeout or existing test-criterion
change. If an existing caller test outside these files is genuinely affected,
report its exact dependency before proposing a scope change. Do not add a second
memory engine, private control framework or generic helper without a consumer.

## NH1–NH9 acceptance

- **NH1 — Explicit configuration.** Add only optional
  `capture_rationale: 'source-bound-v1'`. Require existing v2 capture plus an
  explicit canonical ASCII `capture_deadline_ms` string in 1–110000. Reject wrong
  types/values/missing prerequisites before replacing valid Cairn configuration
  or launching a bridge child. Preserve all previously valid profiles. Expose
  this through native setup; blank fresh input stays disabled, blank
  reconfiguration retains the existing valid value. Document removal of the
  dependent fields. Preserve existing wizard field order where possible.
- **NH2 — Existing boundary.** Independently validate and forward
  `--capture-rationale source-bound-v1` in the bridge. Discovery/routing adds
  only `cairn_inspect_rationale` for the explicit mode. Preserve all old five,
  six, seven and eight inventories; enabled rationale plus v2 gives seven, or
  nine with recovery. Preserve 30/35/45 and 120/125/135-second host envelopes;
  the core deadline is cooperative, not a hard completion or cost guarantee.
  Schemas remain stable within the session. Existing explicit rationale-context
  recall already forwards; do not expand the profile recall default.
- **NH3 — Real host path.** Use pinned Hermes 0.21.1 revision
  `c8aa5608c24e3636e77c267650c0f1f52e44adb0`, Python 3.11, host MCP SDK 2.0.0,
  and a freshly inspected/locally installed current Cairn archive. Exercise
  actual MemoryManager/AIAgent routing, SDK subprocesses and public storage;
  fake completions/provider responses only. No SQL seeding, direct trusted
  binding/transition/rationale review, user profile or real provider key.
- **NH4 — Frozen evidence chain.** Separately submit the four exact user
  messages below. Scripted proposals establish premise → decision
  `supports-decision` and challenge → premise `challenges-premise`, using actual
  receipts. Inspect unchanged A, three sources/two edges and
  `reconfirmation-suggested`; unrelated backup remains unchanged. These are
  untrusted model proposals, not authenticated adoption or execution authority.
- **NH5 — Cold correction and forgetting.** Two independent histories restart
  the actual manager/provider. Cold selection/ranking derives references only
  from request-visible data, not retained expected IDs. Preserve graph/receipts
  across restart. Correct or forget the challenge through ordinary host tools;
  live stale refs reject without state change. Respect documented idempotent
  repeat forget after deletion. After another restart, exclude the old challenge
  ID, receipts and text from rationale/rank context, retain A/premise/backup
  exactly, and report two-source/one-edge `unassessed`, not confirmed, cancelled
  or authorized. Logical forgetting does not promise physical erasure.
- **NH6 — Honest partial outcome.** A separately controlled rationale-stage
  expiry keeps previously admitted sources/filing and reports its failed
  rationale stage, without claiming whole capture failed or inventing success.
  Keyless inspection and exact completed-batch replay add no model traffic or
  implicit retries. Inspection/correction/forgetting never receive the dedicated
  model key. Capture/recall/classification keep their existing dedicated-key
  boundary, never the generic host key.
- **NH7 — Owned verification.** Use fresh synthetic profiles and owned temporary
  roots; close actual managers, helper/SDK children and fake transports before
  cleanup. Retain genuine failures and cleanup outcomes. Reuse the canonical
  host runner with `--file-retries 0`, a new owned pytest base and both exact Node
  22.16.0/24.15.0 runtimes. Do not alter or clean historical host/test roots.
  Missing prerequisites fail; they are not skipped passes. Preparation should
  use one finite owned setup rather than a new control/observer forest.
- **NH8 — Claims and disclosure.** Document the extra source-receipt model work
  during opted-in capture and selected local evidence leaving the device. No
  account-wide budget guarantee, passive transcript collection, automatic
  adoption, semantic accuracy, native natural tool-choice, lightweight resource
  or competitive-score claim. Record fake request counts honestly; fake model
  requests are not zero model-port requests or paid calls. Update limitations
  and unreleased changelog without releasing or changing versions.
- **NH9 — Verify and deliver.** Worker reports affected caller checks and exact
  source/artifact/runtime bindings, failures and results. Primary reads the
  complete actual diff and personally reruns key native flows and applicable
  generic/JSON/strict-plugin/MCP/artifact checks on the combined candidate.
  Independent nonauthors review both axes after freeze; only then push a draft
  dependent PR. All applicable latest-head CI and actual mergeability must pass
  before ready. No GitHub main merge, release, deployment, operational ledger,
  paid/native operational experiment, credentials or historical cleanup.

## Exact synthetic sources frozen before implementation/tests

| Batch | User message |
| --- | --- |
| decision | I chose A for my offline field notes. |
| premise | A supports offline work for my field notes. |
| challenge | I checked: A cannot work offline for my field notes. |
| backup | I keep a paper backup for my field notes. |

Correction: `I rechecked: the offline limitation was a mistaken report.`
This does not prove that A supports offline work. Cold recall uses
`field notes` with explicit `contextMode: 'rationale-evidence'`.

## Initial prerequisite checkpoint

The prior disk-audit report names
`/tmp/cairn-hermes-host-nyi8sE`; only that named root was inspected, not a full
`/tmp` scan. Its historical archive SHA-256 is
`233128e6c8ba89be76d97c2c9d70e0c44d78e1e805d4917d87d43e267b6249d2`.
A read-only `-B -I` package-version probe found Python 3.11.12, MCP 2.0.0,
psutil 7.2.2, pytest 9.1.1, pytest-asyncio 1.3.0 and anyio 4.12.1.
This is prerequisite discovery, not current pinned-host acceptance or permission
to modify the historical root. Verify public pinned source and use a fresh owned
test setup; do not run the archived canonical runner in place, where optional
bytecode compilation could modify historical files. Actual installed artifact,
native tests and final review/delivery remain pending.

## Owned preparation and caller checkpoint (2026-10-05)

One owned setup, `/tmp/cairn-hermes-rationale.PGQDHO83`, holds the authenticated
pinned source, copied development venv, bytecode-disabled Python wrapper,
locally built/installed artifact, private npm cache and synthetic test roots.
The public commit resolves to tree `2a23dfdd9b530a0a5a01b4773ca9c0f1edf3ee04`;
complete tree membership/modes and genuine Git blob hashes were checked before
execution. Two pinned codeload requests returned HTTP 429 and remain preparation
failures, not downloads. The named historical archive was instead authenticated
against the public recursive tree. Eighteen PowerShell files differ only by
declared LF/CRLF checkout conversion: the authenticated root `.gitattributes`
sets `*.ps1 text eol=crlf`, with no overriding attribute file. No raw-archive
byte-parity claim or PowerShell execution is made. The finite source report is
`source-authentication.json` (SHA-256 `94169fdd486dad4aa7c392ad793bf15a499748bb56c336cfd5fb19d1b0ac554b`).

The fresh copied Python reports 3.11.12, MCP 2.0.0, psutil 7.2.2, pytest 9.1.1,
pytest-asyncio 1.3.0 and anyio 4.12.1. Editable finder and imported host module
paths resolve exclusively to the fresh pinned source, not the historical host.
Actual user HOME is preserved; only synthetic profiles and standard temp paths
are redirected. Canonical runner and per-file helper were read completely;
their optional compile step reports the archive's absent Git metadata and may
write bytecode only in this fresh setup. No historical source was changed.

Artifact: `temp/cairn-local-artifact-ujTLcq/cairn-memory-local-preview-0.0.0-preview.1.tgz`
under the setup, SHA-256 `25e65fe1764ad3cc1ee02974ea408acd6a344f54b00809d086c3da7b59332d2a`.
Its `build-report.json` source hashes were compared against all 93 installed
bodies. Installed entrypoint `install/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs`
has SHA-256 `56d8fe270b3945fb60287fca25c42a762595afab0cbf28c94b43b8c3ae59df86`.
Locked SDK and four artifact production dependencies were prepared with an
owned cache; manifests/locks remain unchanged. Setup/artifact are explicitly
retained for primary direct acceptance, not undeclared historical residue.

Affected owners: provider configuration/discovery/native wizard and dedicated
key tests in `test_qualified_provider.py`; independent SDK argv guards in
`bridge.py`; three new actual MemoryManager/AIAgent rationale scenarios. The
original five/six/seven/eight inventories, v2-only bridge cases and non-rationale
key profile remain tested. `docs/automatic-rationale-loop.md` describes its
earlier slice accurately; a current native pointer there would be a separate
documentation scope, not an edit in this nine-file packet.

### Retained first invocation and correction

The first canonical Node 22 invocation (session 60741, final chunk `16af11`)
naturally exited 1: qualified-provider **13 passed / 2 failed**, new rationale
conversation **2 passed / 1 failed**, no skips; 186.5 seconds total. Both complete
correct/forget histories passed. These three authored assertion mistakes are
retained, not product regressions or regraded passes:

- Discovery is cached within a session; invalid disk configuration must be
  tested through a fresh provider, not by expecting cached schemas to reload.
- The pinned host rejects an unregistered tool with its own string-error
  envelope; the disabled provider separately rejects it as `invalid_input`
  without launching another child.
- Core duplicate capture explicitly reports `previousOutcome: 'unavailable'`
  alongside `not-run`/`duplicate`; replay must assert that field and still make
  no new scripted HTTP calls.

Correction round 1 changes these test expectations only. Production validation,
deadlines, key boundaries and runtime capture/replay remain unchanged. The first
15/18 result and three assertion failures are recorded through the original tool
session/chunks; no file retry or product retry was requested.
Logging limitation: there is no re-readable byte-exact local full first console
or separated stderr. It was not copied before worker context compaction;
`native-first22-failure-evidence.md` in the setup is an explicit summary, not a
fabricated full console or separated stderr log. The upstream runner itself
merges per-file stderr into stdout.

### Reproducing the native matrix

From the authenticated fresh Hermes checkout, use the canonical runner below.
Select the exact Node 22.16.0 or 24.15.0 binary and a distinct new pytest base
for each invocation. These variables name test-owned setup paths; they do not
replace the real user HOME or provide model credentials.

```sh
CAIRN_REPO=/home/chichieh/Github/cairn-memory-worktrees/hermes-rationale-lifecycle
CAIRN_SETUP=/tmp/cairn-hermes-rationale.PGQDHO83
CAIRN_NODE=/home/chichieh/.nvm/versions/node/v22.16.0/bin/node
CAIRN_BASE="$CAIRN_SETUP/pytest-full22"
env -i HOME=/home/chichieh \
  PATH="$CAIRN_SETUP:${CAIRN_NODE%/*}:/usr/bin:/bin" \
  HERMES_PYTHON="$CAIRN_SETUP/python-no-bytecode" \
  TMPDIR="$CAIRN_SETUP/temp" TMP="$CAIRN_SETUP/temp" TEMP="$CAIRN_SETUP/temp" \
  /bin/bash scripts/run_tests.sh \
  "$CAIRN_REPO/integrations/hermes/test/test_provider.py" \
  "$CAIRN_REPO/integrations/hermes/test/test_agent_conversation.py" \
  "$CAIRN_REPO/integrations/hermes/test/test_qualified_provider.py" \
  "$CAIRN_REPO/integrations/hermes/test/test_qualified_conversation.py" \
  "$CAIRN_REPO/integrations/hermes/test/test_capture_recovery.py" \
  "$CAIRN_REPO/integrations/hermes/test/test_rationale_conversation.py" \
  --file-retries 0 -j 1 -- --basetemp="$CAIRN_BASE" \
  --cairn-executable "$CAIRN_SETUP/install/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs" \
  --cairn-node "$CAIRN_NODE" -q -p no:cacheprovider
```

The correction-only run adds
`-k 'rationale_requires or dedicated_key_forwarded or rationale_expiry'` after
`--` and used the new `pytest-correction22` base. It naturally exited 0 with
4 passed / 0 failed in 71.5 seconds (chunk `2081ae`), without file retries.
This does not replace the retained first failure or the complete native matrix.

## Worker verification checkpoint (2026-10-05)

| Invocation | Actual result | Canonical wall time |
| --- | --- | --- |
| First focused Node 22, before assertion correction | 15 passed / 3 failed; exit 1 | 186.5 s |
| Correction-only Node 22 | 4 passed / 0 failed; exit 0 | 71.5 s |
| Complete six-file Node 22, final runtime/test bytes | 27 passed / 0 failed; exit 0 | 359.7 s |
| Complete six-file Node 24, same final runtime/test bytes | 27 passed / 0 failed; exit 0 | 271.3 s |

Complete Node 22 closed naturally (session 73517, chunk `f44384`) with retries
disabled and no skips: provider 5, agent 2, qualified provider 15, qualified
conversation 1, recovery 1 and new rationale 3. The canonical console is retained
as `native-full22-console.log` in the owned setup. All registered manager/agent
closures and provider-child teardown assertions passed. After natural completion,
the worker removed its exact fresh pytest roots (`pytest-correction22`,
`pytest-full22`, `pytest-full24` and the closed failed-run `pytest-focused22-first`)
and checked all four absent; cleanup exited 0. Original failure counts/observations
remain recorded, not regraded. Formal host/dependencies/artifact remain for primary
direct acceptance; this does not retain ordinary synthetic test DBs. The new correct/forget
histories each assert 44 locally scripted HTTP requests; the separate expiry
history asserts 8. Real provider network/paid calls are zero; scripted model/count
calls are nonzero. The reused `rationaleModel.classify` fixture returns
`parentIds: []`: `classification.status: 'applied'` means completed classification
with these memories unfiled, not successful MOC tree placement or routing quality.
Primary serialized its other broad gates after resource contention; no worker
timer was increased, file retried or failure regraded. Node 24 ran only after
primary's serial direct focused verification released the same host's slot. It
closed naturally (session 43910, chunk `4cd7b6`), with the same per-file test
counts and no skips. Its full console is retained as `native-full24-console.log`;
all closure assertions passed before cleanup. The three new scenarios passed
on each runtime; they do not infer native natural tool choice or semantic quality.

Final runtime/test SHA-256 bindings at this checkpoint:

| File | SHA-256 |
| --- | --- |
| `cairn/__init__.py` | `14b9cba502781fd42fd0457750867f3616eaf5632113aaa6d52458357f6b1ac5` |
| `cairn/bridge.py` | `5ff4d5f110c8796b3886116732ac17044f401bb702fb4e2e6af5f9514544ae6e` |
| `test/test_qualified_provider.py` | `d7943bf51914c7a383d13daa773f57e0426812fa351e0701bbeb78f04a79af1a` |
| `test/test_rationale_conversation.py` | `a2c7a073face8efdd564c964f41e3f9abc86c216626e8c19fd0754d9fb375c22` |

Paths in this table are relative to `integrations/hermes/`. Runtime/test edits
are paused; worker source writing is complete. Primary direct acceptance and
applicable contributor gates are recorded below; same-fixed-candidate nonauthor
Standards/Spec reviews and latest-head CI remain separate pending checkpoints. This worker
authored the packet and cannot supply those final independent reviews.

### Primary direct acceptance and contributor gates

Primary inspected the actual provider/bridge/test diff and independently matched
all 93 installed artifact source hashes to the build report and current checkout.
It directly ran the two affected native files serially against the same fresh
host/artifact, with new pytest bases and retries disabled: Node 22 and 24 each
passed 18/18, zero skips, natural exit 0, canonical 206.8 / 182.4 seconds
(outer 207130.175986 / 182535.444156 ms). Both primary test roots were cleaned
in `finally` with absence assertions. All four runtime/test hashes stayed exact.

| Primary gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Generic | 591/591, exit 0; 390117.597462 ms | 591/591, exit 0; 392336.059241 ms |
| Serial MCP | 116/116, exit 0; 82621.292327 ms | 116/116, exit 0; 64144.156104 ms |
| Serial artifact | 90/90, exit 0; 377782.122128 ms | 90/90, exit 0; 319350.71221 ms |
| JSON/version | 10 JSON files and 0.3.0, exit 0 | 10 JSON files and 0.3.0, exit 0 |
| Locked Claude 2.1.260 | Marketplace + strict plugin exit 0 | Marketplace + strict plugin exit 0 |

The serial MCP/artifact commands preserve all selected source assertions and
timers, limiting only verification file concurrency:

```sh
node tools/testing/run.mjs --test-concurrency=1 adapters/mcp/test/*.test.mjs
node tools/testing/run.mjs --test-concurrency=1 packaging/test/*.test.mjs
```

Earlier primary failures remain distinct: MCP before the OpenAI dependency was
prepared exited 1 (Node 22: 96/116 passed; Node 24 exact counts not retained).
After preparation, high-load parallel MCP runs exited 1 (Node 22: 109 passed,
1 failed, 6 cancelled; Node 24: 110 passed, 6 cancelled). Actual 20/30-second
timeouts were observed under contention, not relaxed. Two concurrently started
artifact lanes were terminated and exited 143, not passes. Later serial gates
do not regrade these records. Owned dependency/validator caches and configs were
cleaned; no manifest/lock, production timer or runtime behavior was changed.
