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

## Pieces

| File | Role |
| --- | --- |
| `run.mjs` | `setup` creates the synthetic project, canaries and hook settings; `step <name>` runs one budgeted host step (ledger counts every attempt before it starts; at most 24 per host). Hosts get a clean environment, their own process group and, for traced steps, an execve/file-write `strace`. |
| `hook.mjs` | Hook entry for both hosts. Records delivery (fields, transcript state, process placement, seccomp status), recalls through the extracted seam and injects context, and launches a detached worker for `Stop`, `SessionEnd`, `PreCompact` and `PostCompact`. Always exits 0. |
| `worker.mjs` | Detached worker. Reads only the hook-supplied transcript, applies the candidate allowlist, canonicalizes, redacts and bounds each message, and posts batches through the seam (`identity`, `redact`, `control-state`, `file-lock`, `capture-cursor`, `transport-hosted`). Also probes whole-file readability after an optional delay. |
| `core-server.mjs` | Loopback server with hosted-shaped endpoints over one temporary `core/` store and the scripted model in `lib/scripted-model.mjs`; records every received body. |
| `fake-responses.mjs` | Scripted Responses provider for zero-quota Codex steps. Records header names only, never values. |
| `analyze.mjs` | Writes `results.json`: canary hits in delivered bodies, recall output and state; record kinds per transcript; candidate and released-parser replays; hook matrix; trace summary; quota-event schema; timings. |
| `cleanup.mjs` | Dry run by default; `--apply` unlinks only host files whose path contains one of the run's exact session IDs, then removes now-empty directories named by those IDs (never recursive). Shared host files are reported as residue. |

## Typical order

```sh
export TMPDIR=/tmp/f0-tmp PATH="$HOME/.nvm/versions/node/v22.16.0/bin:$PATH"
node run.mjs setup
node run.mjs step claude-precheck        # no model call: isolation and hooks only
node run.mjs step codex-precheck         # scripted provider: zero quota
node run.mjs step claude-capture         # then codex-capture, *-recall, *-image, ...
node analyze.mjs > /tmp/f0-tmp/analysis.json
node cleanup.mjs && node cleanup.mjs --apply
rm -rf /tmp/f0-tmp
```

Traced wall times include detached workers, because `strace -f` waits for every
tracee; use the untraced steps for latency.
