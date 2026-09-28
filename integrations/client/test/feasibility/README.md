# F0 pinned-host feasibility harness

Disposable, manual harness for the F0 gate in
[the Codex client contract](../../../../docs/plans/codex-client.md#f0-results).
It starts real `claude` and `codex` processes, so it is **never** run by
`npm test`, CI or any `test:*` script, and its files deliberately avoid the
`*.test.mjs` suffix. Run it only with the maintainer's explicit, current
authorization for synthetic sessions on their subscriptions; without it,
F0 items stay to verify.

It is a feasibility probe, not CX-2/CX-3/LAC/HMA. The parsers in `lib/` are
candidate rules under test, and the loopback server is a stand-in for a local
target, not local automatic capture.

## Pins and prerequisites

- Claude Code `2.1.283` at `~/.local/bin/claude`; `codex-cli 0.157.1` from the
  Node `v22.16.0` global install; Linux (verified on WSL2) with `strace` 5.x.
- `TMPDIR=/tmp/f0-tmp`. Everything the harness owns lives under
  `/tmp/f0-tmp/f0-run`; delete that directory afterwards.

## Safety rules the code enforces

- **Isolation gate.** `run.mjs step` first runs `lib/preflight.mjs`. It checks:
  - installed versions against the pins, read from the binaries;
  - no Claude managed settings file or Windows policy key;
  - Claude user settings excluded and MCP strict and empty;
  - project hooks are the harness's own;
  - no Codex `hooks.json`, `[hooks]` table, system or managed config;
  - no non-empty ancestor `.codex`;
  - trust bypass only for harness hooks;
  - for a real Codex model-only step, a scripted run of the identical configuration
    whose requests contained no user skill name.

  Only `ENOENT` counts as absent; an unreadable file (`EACCES`, `EISDIR`, `EIO`, ...)
  cannot be evaluated. The Codex user config goes through `lib/toml-hooks.mjs`, a
  validating detector that flags any key path starting with `hooks` in bare, quoted,
  escaped, dotted, header or inline form, and any line it cannot classify.

  Any failed or unevaluable check blocks the step before it is counted; there is no
  override.
- **Launch ledger.** Only the orchestrator writes `ledger.json`. It records each launch
  before the host starts, and a Codex thread only when its own process prints
  `thread.started`.
- **Source ownership.** Hooks, workers, analysis and cleanup accept a transcript only
  if all of these hold:
  - its session is in the ledger;
  - its path is the exact host location derived from that launch;
  - automatic memory is not paused;
  - it is a regular, non-symlink file owned by this user under a non-symlinked parent.

  Workers then read through one `O_NOFOLLOW` handle whose inode must match.
- **Cleanup** plans from the ledger alone, re-verifies each path before `unlink`, and
  only `rmdir`s empty directories. Hook events are never read.
- **Supervision.** It starts at spawn. SIGINT, SIGTERM and SIGHUP are forwarded to
  the host's process group, which escalates to SIGKILL after 5 s, and a signal
  before launch prevents the launch. Every callback the supervisor runs after spawn
  goes through one failure path. That covers `onSpawn` (the launch-ledger write) and
  `onStdoutLine` for each line and for the final partial line at stdout end, which
  writes the Codex thread binding. Its first exception sends SIGTERM to the group,
  then SIGKILL after the bound, reaps the host, and rejects with that exception.
  Later callbacks are skipped, so the call settles once.

## Pieces

| File | Role |
| --- | --- |
| `run.mjs` | `setup` creates the synthetic project, canaries (including scripted-compaction settings) and hook settings. `preflight <name>` evaluates the gate without launching. `step <name>` runs one gated, budgeted host step (at most 24 per host). Hosts get a clean environment, their own process group and, for traced steps, an execve/file-write `strace`. |
| `hook.mjs` | Hook entry for both hosts. Records delivery and process placement, recalls through the extracted seam and injects context, and launches a detached worker for harness-owned sessions only. Always exits 0. |
| `worker.mjs` | Detached worker. Authorizes the source, then applies the candidate allowlist, canonicalizes, redacts and bounds each message, and posts batches through the seam. |
| `core-server.mjs` | Loopback server with hosted-shaped endpoints over one temporary `core/` store and the scripted model in `lib/scripted-model.mjs`; records every received body. |
| `fake-responses.mjs` | Scripted Responses provider for zero-quota Codex steps. Records header names only, never values. |
| `analyze.mjs` | Writes `results.json`: canary hits, record kinds, parser replays, hook matrix, trace summary, quota-event schema and timings. Exits 1 on a missing canary value, an unplanted required canary, or any leak: delivered bodies, recall, state or checked host output. |
| `cleanup.mjs` | Dry run by default; `--apply` removes only ledger-owned session files. |
| `lib/` | `ledger`, `source-access`, `cleanup-plan`, `preflight`, `toml-hooks`, `supervise` and `canaries` hold the rules above; `core-http` records bodies and answers a handler failure with `harness_error` only, keeping its message in the local record; `parsers`, `common` and `scripted-model` support the probes. |
| `selftest/` | Offline tests of those rules with in-memory or test-owned filesystems and fake hosts. |

## Offline self-tests

```sh
PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH" \
  node tools/testing/run.mjs integrations/client/test/feasibility/selftest/*.selftest.mjs
```

They start no real host.

## Typical order

```sh
export TMPDIR=/tmp/f0-tmp PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"
node run.mjs setup
node run.mjs preflight claude-capture     # gate only; no launch
node run.mjs step claude-precheck         # no model call: isolation and hooks only
node run.mjs step codex-precheck          # scripted provider: zero quota
node run.mjs step codex-model-only-fake   # records the skill proof a real model-only step needs
node run.mjs step claude-capture          # then codex-capture, *-recall, *-image, ...
node analyze.mjs > /tmp/f0-tmp/analysis.json
node cleanup.mjs && node cleanup.mjs --apply
rm -rf /tmp/f0-tmp
```

Traced wall times include detached workers, because `strace -f` waits for every
tracee; use the untraced steps for latency.
