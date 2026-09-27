# CX-1 extraction report

Base: `93e52b7afb298d728cb4831c34bbda6dcf750704`.
Branch: `feat/cx1-shared-client`. Platform: Linux x86_64.

## Module decisions

| Original plugin module | Decision | Shared implementation / reason |
| --- | --- | --- |
| `lib/redact.mjs` | Moved; compatibility export retained | `integrations/client/redact.mjs`; host-independent secret patterns and replacement order, unchanged. |
| `lib/identity.mjs` | Moved; compatibility export retained | `integrations/client/identity.mjs`; atomic UUID publication, telemetry ID and keyed project identity, unchanged. Caller still selects the state root. |
| `lib/control-state.mjs` | Moved; compatibility export retained | `integrations/client/control-state.mjs`; legacy pause marker, generations, locking and dispatch checks, unchanged. |
| `lib/capture-cursor.mjs` | Moved; compatibility export retained | `integrations/client/capture-cursor.mjs`; byte offset/pendingEnd serialization and hashed session paths, unchanged. This is the existing Claude cursor profile, not the future normalized profile. |
| `lib/file-lock.mjs` | Moved; compatibility export retained | `integrations/client/file-lock.mjs`; process ownership, hard-link publication and dead-owner recovery, unchanged. |
| `lib/config.mjs` | Moved; compatibility export retained | `integrations/client/config.mjs`; endpoint validation is transport policy independent of the host. |
| `lib/http.mjs` | Moved; compatibility export retained | `integrations/client/transport-hosted.mjs`; existing JSON poster, auth, timeout, HTTP-error and redirect behaviour, unchanged. Name follows the contract's future hosted transport seam. |
| `lib/recall-query.mjs` | Moved; compatibility export retained | `integrations/client/recall-query.mjs`; host-independent redaction and query preparation, retaining the existing 4,000 UTF-16-unit hosted profile. No new normalization. |
| `lib/capture-event.mjs` | Stays | Validates the Claude hook event fields and source locator. |
| `lib/transcript.mjs` | Stays | Claude record parsing, exclusions, message IDs and capture event IDs remain together with their existing hosted profile. |
| `lib/version.mjs` | Stays | Released plugin version, unchanged at 0.1.0. |
| `scripts/hook.mjs` | Stays, unchanged | Host option/root selection, byte-range reads/newline framing, batching/retries and hook responses remain adapter orchestration. |
| `scripts/launch-capture.mjs` | Stays, unchanged | Claude detached hook/worker handoff. |

All eight extracted source modules are byte-identical to their base-commit
implementations (including `http.mjs` renamed to `transport-hosted.mjs`). They
import only Node built-ins or other shared modules. No extraction, ranking,
prompting, storage, core imports, new dependencies or release changes were added.

## Bundle and compatibility

`node integrations/client/bundle.mjs` enumerates the shared top-level runtime
`.mjs` files (excluding the generator), sorts them, and emits exact source bytes
with one generated-file banner into `plugins/cairn-memory/lib/client/`. The
managed destination is reconciled, removing obsolete entries. There are no
timestamps, build paths or runtime dependencies in the output.

`node integrations/client/bundle.mjs --check` rejects differing, missing or extra
files without writing. `plugins/cairn-memory/test/client-bundle.test.mjs` runs this
check through the existing `npm test` command and exercises tampering, missing
files, obsolete files and regeneration in temporary directories. Root scripts
and CI did not need edits. Shared parity tests are also imported into that gate.

All eight old module paths re-export from the generated directory inside the
plugin. No plugin runtime imports a repository parent. The isolated-plugin parity
test copies only `lib/` and `scripts/` to a temporary installation and invokes its
real hook. The artifact allowlist includes the generated redactor dependency;
the installed artifact test checks its source bytes and imports through the old
redactor path from an actual offline-installed archive.

## Parity evidence

`test/freeze-legacy.mjs` reads only tracked plugin sources from the pinned base
commit into a temporary directory, runs synthetic observations, and freezes the
results in `test/fixtures/claude-hosted-0.1.0.json`. It records source SHA-256s.
It never blesses outputs from the modified working tree. Ordinary tests need no
Git access and never execute the fixture generator.

`test/observe-legacy.mjs` observes the shared implementation, compatibility
exports and an isolated plugin against those frozen outputs:

- Every supported redaction pattern, assignment replacement, Unicode/NUL and
  non-string inputs.
- Seeded synthetic project/install keys, exact key bytes and distinct project
  path identities (case, trailing slash, Unicode and empty path).
- Cursor file names, exact JSON bytes, 0600 permissions, legacy defaults,
  malformed cursors, pendingEnd and discard state.
- Initial/legacy/invalid pause states, exact paused/resumed control JSON,
  preserved generation, active dispatch and stale-generation rejection.
- Lock ownership; authenticated/anonymous HTTP bodies and headers; HTTP 503,
  HTTP 204, missing token and abort-signal creation.
- Real loopback capture/recall requests: exact body byte lengths and SHA-256s,
  original session IDs, explicit/fallback message IDs and ordered event IDs.
  Synthetic input includes >24 messages, the 20,000-unit capture cutoff,
  Unicode, fake secrets, ignored tool blocks, malformed lines and a partial tail.
- A failed second batch (503), append between attempts, a second-batch
  `processing` response, frozen replay, eventual cursor advancement and a later
  capture of appended bytes. Cursor JSON is compared byte for byte at each step.

Existing plugin test files and their assertions/imports are unchanged. Existing
packaging assertions are unchanged; one installed-redactor test was appended.
The new parity test receiver initially decoded Buffer chunks separately; Node
20 exposed a split UTF-8 character. Setting the receiver's UTF-8 stream encoding
fixed the test harness. No production behaviour changed to make it pass.

## Verification environment

The workspace sandbox cannot write the normal npm cache. Dependencies and public
metadata were prepared with an empty npm userconfig and `/tmp/cx1-npm-cache`.
No credentials were read. To preserve packaging's existing sanitized environment,
Node binaries were copied byte-for-byte into `/tmp/cx1-v22.16.0/bin/node` and
`/tmp/cx1-v24.15.0/bin/node`, alongside this npm wrapper:

```sh
#!/bin/sh
exec node /home/chichieh/.nvm/versions/node/v22.16.0/lib/node_modules/npm/bin/npm-cli.js --cache=/tmp/cx1-npm-cache --userconfig=/tmp/cx1-empty.npmrc "$@"
```

The same wrapper was at `/tmp/cx1-tools/npm` for dependency preparation. Node
versions were v20.20.2 (via npx), v22.16.0 and v24.15.0. npm was 10.9.2. No
repository changes were needed for this cache workaround. Runtime-specific PATH
below selects the copied binary for npm and all its child processes.

Commands and final results are recorded below. Initial cache preparation and the
first Node 22 artifact run exited 1 before the environment workaround; the
initial Node 20 run exited 1 due to the test receiver issue described above.

| Exact command | Exit | Result |
| --- | --- | --- |
| `PATH="/tmp/cx1-tools:$PATH" npm ci --prefix adapters/mcp` | 0 | Locked dependencies installed. |
| `PATH="/tmp/cx1-tools:$PATH" npm ci --prefix adapters/openai` | 0 | Locked dependencies installed. |
| `PATH="/tmp/cx1-v22.16.0/bin:$PATH" node packaging/prepare-cache.mjs` | 0 | Public registry metadata cached; no model requests. |
| `node integrations/client/test/freeze-legacy.mjs` | 0 | Frozen observations from the pinned base. |
| `npm_config_cache=/tmp/cx1-npm-cache npm_config_userconfig=/tmp/cx1-empty.npmrc npx -y -p node@20 node --test plugins/cairn-memory/test/*.test.mjs integrations/client/test/*.test.mjs` | 0 | 39 passed; Node 20.20.2. |
| `node --test plugins/cairn-memory/test/*.test.mjs integrations/client/test/*.test.mjs` | 0 | 39 passed; Node 22.16.0. |
| `PATH="/tmp/cx1-v22.16.0/bin:$PATH" npm test` | 0 | 117 passed. |
| `PATH="/tmp/cx1-v22.16.0/bin:$PATH" npm run validate` | 0 | JSON valid; version remains 0.1.0. |
| `PATH="/tmp/cx1-v22.16.0/bin:$PATH" npm run test:artifact` | 0 | 85 passed, including offline installed dependency closure. |
| `PATH="/tmp/cx1-v22.16.0/bin:$PATH" npm run test:core` | 0 | 758 passed; also passed with the original Node binary. |
| `PATH="/tmp/cx1-v24.15.0/bin:$PATH" npm test` | 0 | 117 passed. |
| `PATH="/tmp/cx1-v24.15.0/bin:$PATH" npm run validate` | 0 | JSON valid; version remains 0.1.0. |
| `PATH="/tmp/cx1-v24.15.0/bin:$PATH" npm run test:artifact` | 0 | 85 passed. |
| `PATH="/tmp/cx1-v24.15.0/bin:$PATH" npm run test:core` | 0 | 758 passed. |
| `node integrations/client/bundle.mjs --check` | 0 | Generated bundle matches shared source. |
| `git diff --check` | 0 | No whitespace errors. |
| `git diff --cached --check` | 0 | Staged changes also clean. |

The following tamper sequence ran against the actual checked-in bundle, then
restored it. The three check exits were **0, 1, 0**, respectively:

```sh
node integrations/client/bundle.mjs --check
cp plugins/cairn-memory/lib/client/redact.mjs /tmp/cx1-redact-backup.mjs
printf '\n// synthetic tamper\n' >> plugins/cairn-memory/lib/client/redact.mjs
node integrations/client/bundle.mjs --check
cx1_tamper_exit=$?
cp /tmp/cx1-redact-backup.mjs plugins/cairn-memory/lib/client/redact.mjs
printf 'tamper check exit=%s\n' "$cx1_tamper_exit"
node integrations/client/bundle.mjs --check
```

The failing check reported `client_bundle_stale: redact.mjs`; the file was
restored before subsequent tests. Temporary-copy tests also reject missing and
extra bundle entries. A first shell attempt stopped after the expected check
failure because zsh reserves `status`; restoration was completed immediately and
the full sequence above reran successfully with `cx1_tamper_exit`.

`cmp /home/chichieh/.nvm/versions/node/v22.16.0/bin/node /tmp/cx1-v22.16.0/bin/node`
and `cmp /home/chichieh/.nvm/versions/node/v24.15.0/bin/node /tmp/cx1-v24.15.0/bin/node`
both exited 0. Regenerating the golden fixture and running
`cmp /tmp/cx1-golden-before.json integrations/client/test/fixtures/claude-hosted-0.1.0.json`
also exited 0.

## Changed files

All 33 files are within the allowed paths. The module table explains the runtime
files; the bundle section explains the generator, compatibility copies and
artifact closure; the parity section explains the fixture and test harness.

```text
integrations/client/CX1-REPORT.md
integrations/client/bundle.mjs
integrations/client/capture-cursor.mjs
integrations/client/config.mjs
integrations/client/control-state.mjs
integrations/client/file-lock.mjs
integrations/client/identity.mjs
integrations/client/recall-query.mjs
integrations/client/redact.mjs
integrations/client/test/fixtures/claude-hosted-0.1.0.json
integrations/client/test/freeze-legacy.mjs
integrations/client/test/observe-legacy.mjs
integrations/client/test/parity.test.mjs
integrations/client/transport-hosted.mjs
packaging/artifact-files.json
packaging/test/install.test.mjs
plugins/cairn-memory/lib/capture-cursor.mjs
plugins/cairn-memory/lib/client/capture-cursor.mjs
plugins/cairn-memory/lib/client/config.mjs
plugins/cairn-memory/lib/client/control-state.mjs
plugins/cairn-memory/lib/client/file-lock.mjs
plugins/cairn-memory/lib/client/identity.mjs
plugins/cairn-memory/lib/client/recall-query.mjs
plugins/cairn-memory/lib/client/redact.mjs
plugins/cairn-memory/lib/client/transport-hosted.mjs
plugins/cairn-memory/lib/config.mjs
plugins/cairn-memory/lib/control-state.mjs
plugins/cairn-memory/lib/file-lock.mjs
plugins/cairn-memory/lib/http.mjs
plugins/cairn-memory/lib/identity.mjs
plugins/cairn-memory/lib/recall-query.mjs
plugins/cairn-memory/lib/redact.mjs
plugins/cairn-memory/test/client-bundle.test.mjs
```

## Boundaries

All requested verification gates completed successfully after the test-environment
and test-receiver fixes described above.

These are synthetic offline/client compatibility results, with loopback HTTP and
public npm dependency downloads only. No real transcripts, host settings,
credential files, models, paid services, pushes or PRs were used. No files outside
the allowed paths are changed; dependency installation only populated ignored
worktree directories. No version bump was made.

Pinned-host feasibility (F0), pairing, Codex parsing, the normalized common
profile, new quota/concurrency controls and local-core client transport are
subsequent packages. This extraction neither implements nor claims their
acceptance gates. Actual Claude/Codex host execution and deployed hosted-service
behaviour were not exercised; D1 evidence here is baseline output parity plus
unchanged implementation bytes and existing regression tests.
