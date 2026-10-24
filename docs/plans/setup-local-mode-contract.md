# Installer local mode: contract for `@cairn-ink/memory` 0.6.0

Status: v0.7 (setup session, 2026-10-25). v0.1 (`f053a18c`) was audited by a
non-author Codex auditor (gpt-6.1-sol, xhigh, read-only): no P0, fourteen P1,
two P2. v0.2 (`4332b800`): no P0, ten P1, three P2. v0.3 (`3f337e9d`): no
P0, six P1, two P2. v0.4 (`e4462168`): no P0, three P1, one P2. v0.5
(`e8108791`): no P0, two P1, one P2, and **ready for S1 review**. v0.6
(`975de335`) was confirmed **ready for S2 implementation**. v0.7 adds the two
amendments the S1 reviewers asked for (§5.2 step 3, §5.3 child ownership).

Base: `main` at `b2513501` (PR #469 local V1 Raw chain and PR #470 unified
memory V1 are merged). Branch `feat/setup-local-mode`.

Facts verified by the setup session on this machine (2026-10-25), taken as
given below:

- `packaging/build.mjs` produces a byte-identical tarball on Node 22.16.0 and
  24.15.0 (npm 10.9.2 and 11.12.1): SHA-256 `2bca0be1…`, 640,060 bytes, 265
  files.
- Claude Code 2.1.310: `claude mcp add --transport stdio --scope user NAME --
  cmd args…` exits 0 and writes `~/.claude.json`; repeating `add` for an
  existing name exits **1** with `MCP server NAME already exists in user
  config` and changes nothing; `claude mcp get NAME` exits 0 and prints
  `NAME:` followed by indented `Scope:`, `Status:`, `Type:`, `Command:`,
  `Args:` lines (it also health-checks the server, which spawns it); a missing
  name exits **1** with `No MCP server named "NAME". Configured servers: …`;
  a same-name entry in `local` scope shadows the `user` entry in `get` (the
  `Scope:` line says which); `claude mcp remove --scope user NAME` exits 0, or
  1 with `No MCP server named "NAME" in user scope` when absent.
- Codex 0.164.0: `codex mcp add NAME -- cmd args…` appends or **overwrites in
  place** exactly one `[mcp_servers.NAME]` table with `command`/`args`,
  preserving every other byte of `config.toml`, exit 0 both times; `codex mcp
  list --json` and `codex mcp get NAME --json` return parsed transports
  (quoted headers such as `[mcp_servers."cairn"]` are resolved; `get` of a
  missing name exits 1); `codex mcp remove NAME` exits 0 even when absent.
  `codex mcp …` may try to write helper files under `CODEX_HOME`.

## 1. Goal

`npx @cairn-ink/memory setup` (today 0.5.3, hosted-only) gains a **local
mode**: memory lives in a SQLite file on the user's computer, served by this
repository's stdio MCP server (`cairn-memory --db … --owner …`). No cairn.ink
connection and no account. The hosted ("cloud") mode is unchanged.

Completion:

- `@cairn-ink/memory@0.6.0` on npm lets a new user pick local or cloud with the
  same command.
- A user already connected to cloud upgrades and sees **no behaviour change**
  apart from the printed installer version (§10 L06 defines "no change").
- In local mode, Claude Code and Codex both reach memory through MCP.

## 2. Decisions already made

### 2.1 Product owner (do not reopen)

| # | Decision |
| --- | --- |
| O1 | Local and cloud are **two storage choices of one product**, not two packages. One package, one command. No `@cairn-ink/memory-local`. |
| O2 | A **fresh** install asks **once**: store memory on this computer, or in the cairn.ink cloud? Each option gets one sentence. Local: data stays on this computer, free, works offline, cannot sync across computers. Cloud: shared across computers and tools, needs sign-in. |
| O3 | Non-interactive terminals use `--local` or `--cloud`. Without a flag, the installer does not guess: it writes nothing and prints the rerun command, as today's `tty_required` path does. |
| O4 | Existing cloud users are not affected. |
| O5 | Local V1 features (method packages, assets, `read_memory_context`, role profiles, Card dependencies) stay **opt-in**. The installer does not enable them. |
| O6 | Merge to `main` and publish to npm are authorized, subject to §10. The owner sees the version and release notes before `npm publish`. |

### 2.2 Setup session (audited; objections need file:line evidence)

| # | Decision | Reason |
| --- | --- | --- |
| S1 | **0.6.0 local mode is explicit MCP memory**: the five default tools (`remember_memory`, `recall_memory`, `inspect_memory`, `correct_memory`, `forget_memory`) over stdio, keyless. **Automatic capture and automatic prompt recall are not part of 0.6.0 local mode.** They stay cloud features; the `cairn-memory local …` foreground preview remains an operator path and is not wired by the installer. | The foreground capture host needs an OpenAI key, three consents, is Linux/WSL-only, and has a per-session rearm limitation (`integrations/client/raw/local-setup.mjs:199–214`). Local automatic recall does not exist (`integrations/client/raw/local-hook.mjs:67–69`). Follow-up: §11. |
| S2 | The installer stays **dependency-free** for cloud users. The engine ships **inside the installer package** as the tarball built by `packaging/build.mjs` (`cairn-memory-local-preview-0.0.0-preview.1.tgz`) plus a manifest. Local setup installs it into a private per-user directory with `npm install --ignore-scripts` using the tarball's `npm-shrinkwrap.json` (pinned `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/core` 2.0.0, `zod` 4.5.4, `tiktoken` 1.0.22; the builder rejects `hasInstallScript`, `packaging/build.mjs:60–77`). | Cloud users' `npx` download grows from ~0.5 MB to ~1.2 MB only. Reuses the inspected build (`packaging/build.mjs:80–118`) and the install shape tested by `packaging/install-preview.mjs:44–77`, `packaging/test/install.test.mjs:704`. |
| S3 | **One private installation root for both clients**: `$CAIRN_MEMORY_HOME` (absolute) or `~/.cairn-memory`, mode 0700, canonicalized once. Layout in §4. | Both clients share one store and one identity; one root makes `status` and `uninstall` exact. |
| S4 | **Identity**: personal scope; owner ID generated once (`local-` + 16 lowercase hex) and persisted **before** any client registration; `--project ID` optional and **immutable while a local installation is active or pending** (changing it means `uninstall --local` then `setup --local --project …`: in the `uninstalled` state `--project` is accepted and owner and database are kept). `--owner`/`--db` are accepted only when no descriptor exists (`uninstall --local --purge-config` first). Identifier values must satisfy the engine's `identifier()` (`core/validation.mjs:31–35`) **and** be expressible on the engine CLI: non-empty, no leading `-`, no control characters, ≤ 200 code units, trimmed. | The engine requires an owner (`adapters/mcp/cli.mjs:189`); CLI value parsing rejects values that look like flags (`adapters/mcp/cli.mjs:170–180`). |
| S5 | **Client registration uses each client's own MCP commands**, never hand-edited files. Claude Code: `claude mcp add --transport stdio --scope user cairn-local -- <node> <executable> --db … --owner …`, replaced by `remove --scope user` then `add` with a durable journal (§7.1). Codex: `codex mcp add cairn-local -- …`, which overwrites in place, so no remove and no restore race. Server name **`cairn-local`** for both. A client whose CLI lacks these subcommands gets the manual snippet and is marked `manual`. | The hosted Claude flow treats a user-scope server named `cairn` as legacy (`packages/setup/lib/setup.mjs:134–145`, `404–412`); Codex's hosted entry is `[mcp_servers.cairn]` (`packages/setup/lib/codex-runtime.mjs:568`). |
| S6 | **Node path**: the engine is registered with the absolute `process.execPath` of the setup run (`packaging/install-preview.mjs:63`). `status` reports a missing executable; rerunning `setup --local` rewrites the entries. | MCP hosts started from GUI contexts may lack the user's `PATH`. |
| S7 | **One mode per client, no mixing.** Cloud (or unknown) present and local requested, or the reverse: refuse, write nothing, print ordered detach commands (§8). No automatic switch and no data migration in 0.6.0. | Cloud hooks capturing to cairn.ink beside `cairn-local` tools writing to SQLite would split memory silently. |
| S8 | **Engine opt-ins** are not exposed. The registered argument vector is exactly `--db ABS --owner ID [--project ID]`. | O5. |
| S9 | **Platforms**: Linux and WSL tested; macOS same code path, documented untested; Windows native refused (`local_windows_unsupported`). | No installed-MCP test on Windows in this track. |
| S10 | **Engine generations are immutable and never pruned by `setup`.** Each install creates a new generation directory `engine/<engineId>/`; a repair creates the next generation (`-r2`, `-r3`, …) and moves clients through the normal registration journal; only `uninstall --local` removes `engine/`. A generation that a **published registration** references (§4.1) is never renamed, repaired in place or removed by `setup`. | An unavailable or unselected client may still reference an older generation; moving a referenced tree before a verified replacement exists would break it. |
| S11 | **The installer never links `node:sqlite`, never imports engine or repository code, and never starts the MCP server itself.** It spawns only `npm`, `<node> <executable> --check-config`, `claude mcp …` and `codex mcp …`. **`claude mcp get` health-checks the server, which starts the engine and can create the database**; the local-mode code therefore never runs `claude mcp get cairn-local`, and the local status, dry-run and detection paths never run any `claude mcp get`. Claude registration state is inspected by reading `~/.claude.json` (§6.2). The **existing hosted flow** keeps its legacy `oldMCP` probe (`claude mcp get cairn`, `setup.mjs:134–145`, also in hosted `status`, `setup.mjs:282`) exactly as in 0.5.3; S11 and L14 explicitly exclude that pre-existing hosted call. | TRAPS 1–3; a read-only command must not create or migrate the database (`adapters/mcp/server.mjs:159`, `core/database.mjs:388`). |
| S12 | **Detection of Codex state uses Codex's own parser**: `codex mcp list --json` run against a private copy of `config.toml` in a temporary `CODEX_HOME` (the hosted inspection pattern, `packages/setup/lib/codex.mjs:167–185`). No textual TOML matching anywhere. | Quoted headers, dotted keys and multiline strings defeat text matching (re-check P1-3). |
| S13 | **`storage_busy` is transient.** Two MCP servers (Claude and Codex) share one rollback-journal database; the engine's busy timeout handles overlap, and a `storage_busy` result is "retry", not "empty". Documented in the local README section; the installer itself never opens the database. | Coordination note from the primary session, 2026-10-25. |

## 3. Scope and non-claims

In scope: §§4–10. Out of scope and stated in docs: local automatic capture and
recall (§11), cloud↔local data migration, a GUI, Windows native local mode,
any recall-quality claim, publishing the engine as its own npm package, the
MCP Registry workflow.

## 4. Installation root and descriptor

```
~/.cairn-memory/                    0700, or $CAIRN_MEMORY_HOME
  .setup.lock                       0600, wx; {"pid":N,"startedAt":ISO}
  .npmrc                            0600: registry=https://registry.npmjs.org/
  installation.json                 0600, descriptor
  engine/                           0700
    npm-cache/                      private npm cache for engine installs
    <engineId>/app/package.json     {"name":"cairn-memory-local-installation","private":true}
    <engineId>/app/node_modules/cairn-memory-local-preview/…
    <engineId>.failed-<ms>/         quarantined attempt (§5.3)
  data/                             0700
    memory.sqlite                   created by the engine on first use
```

`baseId` = `<installerVersion>-<digest>`, digest = first 12 hex of the
SHA-256 of `runtime/engine/manifest.json` (`packages/setup/lib/codex-runtime.mjs:86–92`
convention). `engineId` = `baseId` or `${baseId}-r${n}` with integer n ≥ 2
naming a repair generation of the same bundle. Pattern
`^\d+\.\d+\.\d+(?:-[\w.]+)?-[0-9a-f]{12}(?:-r(?:[2-9]|[1-9]\d+))?$`. The base
of any `engineId` is obtained by stripping an existing `-r<n>` suffix; repair
ids are always derived from the base, never appended to a repair id. A
generation directory is immutable once a registration references it.

### 4.1 Descriptor

```json
{
  "version": "cairn-local-installation-v1",
  "state": "pending" | "installed" | "uninstalling" | "uninstalled",
  "installerVersion": "0.6.0",
  "ownerId": "local-0123456789abcdef",
  "projectId": null,
  "database": { "path": "/abs/.cairn-memory/data/memory.sqlite", "external": false },
  "engine": { "id": "0.6.0-abc123def456", "package": "cairn-memory-local-preview",
              "packageVersion": "0.0.0-preview.1", "sha256": "<tarball sha256>" } | null,
  "node": "/abs/node" | null,
  "operation": null | {
    "kind": "setup" | "uninstall",
    "clients": ["claude", "codex"],
    "startedAt": "ISO",
    "checkpoints": {
      "claude": { "state": "planned" | "registering" | "done" | "manual" | "detaching" | "detached",
                  "destination": "/abs/canonical/home",
                  "previous": <vector> | null, "desired": <vector> | null },
      "codex":  { "state": "...", "destination": "/abs/canonical/.codex/config.toml", "previous": ..., "desired": ... }
    }
  },
  "clients": {
    "claude": { "server": "cairn-local", "scope": "user", "home": "/abs/canonical/home", "vector": <vector> } | null,
    "codex":  { "server": "cairn-local", "configPath": "/abs/canonical/.codex/config.toml", "vector": <vector> } | null
  },
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

`<vector>` = `{ "engineId", "node", "databasePath", "ownerId", "projectId" }`.

**Published registration references**: the set of `engineId`s that may be
registered in a client, namely every `clients.X.vector.engineId` plus, for
every checkpoint in state `registering` or `done`, its `desired.engineId` and
its `previous.engineId`. A checkpoint in state `planned` is **not** a reference
(nothing has been written to a client yet). §5.2 and §5.3 use this set.

Rules:

- **Root canonicalization**: the root is `realpath`ed once after creation.
  Engine directory, executable (`root/engine/<engineId>/app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs`)
  and default database are **derived** from the canonical root and the
  validated `engineId`; absolute paths stored in the descriptor are used only
  for display and for comparison, never as a base for deletion.
- **Reads**: file ≤ 64 KiB, `0600`, uid match on POSIX, strict UTF-8 JSON,
  duplicate keys rejected, exact key sets per `state` (table below), enums
  exact, every `engineId` (top-level and inside every vector) matches the
  pattern, every path absolute without control characters or `..` components.
  `database.external === false` ⇒ `database.path === root/data/memory.sqlite`;
  `external === true` ⇒ the path is outside the root. Violations are
  `local_recovery_required` (nothing written; the descriptor path is printed
  through `write.literal`). An invalid descriptor is **never rewritten**; §9
  orphan recovery handles it.

  | `state` | `engine` | `node` | `operation` | `clients.*` |
  | --- | --- | --- | --- | --- |
  | `pending` | null or object | string | object with `kind: setup` | null or object |
  | `installed` | object | string | null | at least one object |
  | `uninstalling` | object or null | string or null | object with `kind: uninstall` | any |
  | `uninstalled` | null | null | null | both null |

- **Deletion allowlist** (the only paths the installer ever removes or
  renames, each checked with `lstat` to be a non-symlink entry directly under
  the canonical root or `root/engine`): `root/engine/<engineId>` (rename only,
  §5.3, and only when `<engineId>` is not a published registration reference),
  `root/engine` (uninstall, §9 step 5), `root/.setup.lock`, and with
  `--purge-config` `root/installation.json` and `root/.npmrc`. Nothing nested
  inside a generation is ever renamed or removed. Every rename or removal
  `lstat`s its source immediately before acting and refuses symlinks; reused
  owned directories must be `0700` and owned by the current uid. `database.path` resolving
  inside any allowlisted path is `local_recovery_required`.
- **Client destinations are recorded before mutation**: each checkpoint
  records `destination` when it is `planned` (Claude: canonical `HOME`, where
  the `user` scope's `~/.claude.json` lives; Codex: canonical
  `$CODEX_HOME/config.toml` or `~/.codex/config.toml`, resolved by the hosted
  path's function, `packages/setup/lib/codex.mjs:144–157`); completion copies
  it into `clients.X.home`/`configPath`. On every run the current environment's
  destination is compared with the recorded one (checkpoint first, then
  receipt); a difference refuses registration and detachment for that client
  with `local_client_home_changed` (both paths through `write.literal`, plus
  the rerun hint with the original environment). A client whose CLI is not
  available, or whose recorded destination differs, is **unknown, not
  detached**; engine deletion is refused while any such client has a receipt or
  a non-`detached` checkpoint.
- **Writes**: temp file + `fsync` + `rename` in the root, 0600, only while
  the lock is held.
- **Lock**: `.setup.lock` with `wx`, content `{"pid", "startedAt", "child"}`
  (`child` = the npm pid while an engine install runs, else null; §5.3). On
  `EEXIST`, read it; if the recorded setup pid and child pid are both dead,
  `local_lock_stale` prints the path and the exact `rm` command (never
  auto-removed); if either is alive, `lock_retry` as today.
- Paths are private: printed only by `status --verbose`, recovery lines and
  manual snippets, always through `write.literal`, shell-quoted with
  `shellArgument` (`packages/setup/lib/output.mjs`).

### 4.2 Transactions

Every mutating run writes `operation` (kind, consented client set, per-client
`destination`, `previous` and `desired` vectors, all checkpoints `planned`)
**before** the first external mutation, and clears it last. A rerun that finds
an `operation` resumes it: it re-validates the recorded client set,
destinations and vectors and continues from the first checkpoint that is not
`done`/`manual`/`detached`, never asking consent again and never regenerating
`ownerId`. A valid pending `kind: setup` operation makes **local** the
effective mode of a no-flag `setup` run (so the O2 question is never asked
twice), subject to §6.3 conflicts.

| From | Action | To |
| --- | --- | --- |
| absent | fresh `setup --local` after consent | `pending` with owner, database, `operation.kind=setup` |
| `pending` | engine verified (§5.2 steps 5–6) | `pending`, `engine` set |
| `pending` | client registered | checkpoint `done`; `clients.X` set |
| `pending` | all checkpoints `done`/`manual` | `installed`, `operation: null` |
| `installed` | rerun (repair, upgrade, add a client) | `pending` with `operation.kind=setup` for the selected clients → … → `installed` |
| `installed`/`pending` | `uninstall --local` confirmed | `uninstalling`, `operation.kind=uninstall` with the selected clients |
| `uninstalling` | client detached | checkpoint `detached`; `clients.X = null` |
| `uninstalling` | scoped operation complete, another client still registered | `installed`, `operation: null` (remaining registrations stay) |
| `uninstalling` | all clients null and `engine/` removed | `uninstalled` |
| `uninstalled` | `setup --local` | `pending` (same owner, same database) |

## 5. Engine distribution (packet S1)

### 5.1 Build time (`packages/setup/build-runtime.mjs`)

- `node build-runtime.mjs` additionally calls `buildArtifact()` from
  `packaging/build.mjs` (build-time repository code, not shipped) and writes
  `packages/setup/runtime/engine/<name>-<version>.tgz` and
  `packages/setup/runtime/engine/manifest.json`:
  `{ "schemaVersion": 1, "package": { "name", "version" }, "sha256", "bytes",
     "files": [...], "sourceHashes": {...}, "generatedHashes": { "package.json": …, "npm-shrinkwrap.json": … } }`,
  `generatedHashes` being SHA-256 of the two generated files extracted from
  the tarball.
- `--check` (prepack), in this order:
  1. The committed tarball must match the committed manifest's `sha256` and
     `bytes`, and the committed manifest's `package`, `files`, `sourceHashes`
     and `generatedHashes` must equal the rebuild's. Any difference fails with
     `engine_bundle_stale` (so a stale `sha256` or `bytes` can never pass).
  2. If the committed tarball's SHA differs from the rebuilt tarball's SHA,
     extract both: the file lists must be identical and every file's hash
     (sources and generated) and mode must match; then print
     `engine_bundle_sha_drift` (warning) and pass; otherwise `engine_bundle_stale`.
- `packaging/build.mjs` and `packaging/artifact-files.json` are not modified.
  The bundle's internal package name/version stays the preview name.
- `runtime/` is already in `files` (`packages/setup/package.json:9`).

### 5.2 Setup time (`packages/setup/lib/local-engine.mjs`, dependency-free)

`installEngine({ root, engineId, node, env, write, t, databasePath, ownerId, projectId, references })`
(`references` = the published registration reference set of §4.1; S1's tests cover both the unreferenced and the referenced branch, including allocation of `-r10` when `-r2`…`-r9` exist):

1. Verify the bundled tarball's SHA-256 and byte count against the shipped
   manifest and validate the manifest shape (`engine_bundle_invalid`).
2. `root/engine/<engineId>/` (the caller passes the published registration
   references, §4.1):
   - absent → create `…/app` 0700 and continue at step 3;
   - present and **unreferenced** → **reuse check**: steps 5 **and** 6 must
     pass; if they do, return without running npm; if they fail, quarantine
     (§5.3) and install afresh at the same `engineId`;
   - present and **referenced** → reuse check; if it passes, return; if it
     fails, the tree is left untouched and the installer installs the **next
     repair generation** `${baseId}-r${n}` (base of the supplied id; smallest
     integer n ≥ 2 whose directory does not exist, `.failed-*` included) as a
     fresh directory, returns that `engineId`, and the caller moves clients to it
     through the normal registration journal (`desired` = the new generation,
     `previous` = the old one); the old generation stays until `uninstall`.
3. Write `app/package.json` (0600, `wx`). An interrupted earlier attempt never
   reaches this step again: step 2 has already quarantined or reused the
   existing generation.
4. Spawn `npm install --prefix <app> --ignore-scripts --no-audit --no-fund
   [--offline] <tarball>` with **exactly** this environment: `PATH` =
   directory of `node` + `path.delimiter` + the caller's `PATH`;
   `npm_config_userconfig` = `root/.npmrc`; `npm_config_cache` =
   `root/engine/npm-cache` (or the validated absolute `CAIRN_SETUP_NPM_CACHE`
   test seam); `TMPDIR`/`TMP`/`TEMP` passed through after the validation of
   `packaging/build.mjs:40–47`; `SystemRoot` on Windows;
   `npm_config_audit=false`, `npm_config_fund=false`; nothing else (no `HOME`,
   no key variables, no `CAIRN_*`). `--offline` when
   `CAIRN_SETUP_NPM_OFFLINE=1`. Timeout 120 s; stdout/stderr captured into the
   error's `params`, shown only with `--verbose`, never interpolated into
   translated text.
5. **Installed-tree verification**: the set of regular files under
   `app/node_modules/cairn-memory-local-preview/` equals `manifest.files`
   exactly (no extras, nothing non-regular); every hash equals `sourceHashes`
   or `generatedHashes`; the four pinned dependencies' `package.json` report
   the pinned versions. Else `local_engine_verification_failed`.
6. **Syntax check**: `<node> <executable> --check-config --db <databasePath>
   --owner <ownerId> [--project <projectId>]` with the same sanitized
   environment; require `{ ok: true, databaseOpened: false, providerContacted:
   false, modelKeyPresent: false }` (`packaging/install-preview.mjs:66–70`).
   This proves syntax and a loadable CLI only (`adapters/mcp/cli.mjs:367`
   loads the server afterwards); MCP start-up is proven by acceptance E01.
7. Return `{ executable, engineId, sha256 }`.

### 5.3 Failure and recovery

- A failure in steps 3–6 of a **new, unreferenced** attempt renames the
  directory to `root/engine/<engineId>.failed-<unix ms>` after the child has
  closed (same filesystem, no deletion), reports
  `local_engine_install_failed` (or the specific
  `local_engine_verification_failed`) and leaves the descriptor `pending` with
  `engine: null`. The next run installs afresh.
- A process killed during step 4 of a fresh install leaves an incomplete
  directory at the final `engineId`; because the checkpoint was still
  `planned`, the generation is unreferenced, so the next run quarantines it
  and installs afresh. L10 tests SIGKILL during npm.
- **Child ownership.** `installEngine` reports every spawned child's pid
  through `onChild({ kind, pid })`; the coordinator (S2) records the npm pid in
  `.setup.lock` (`{"pid", "startedAt", "child": pid | null}`). Stale-lock
  recovery (§4.1) treats the lock as stale only when **both** the setup pid
  and the recorded child pid are dead; while either is alive the run refuses
  with `lock_retry`. Quarantine of a generation is therefore never attempted
  while a previous npm child may still be writing into it. When the child pid
  cannot be determined (no `child` field, older lock format), recovery is
  conservative: `local_lock_stale` prints the path and asks the user to
  confirm no `npm` process is running before removing the lock.
- `.failed-*` directories are removed only by `uninstall --local`;
  `status --verbose` lists them.
- Previous `engine/<id>` directories are never removed by `setup` (S10).

## 6. Mode selection and command surface (packet S2)

### 6.1 Options

- New flags: `--local`, `--cloud`. Mutually exclusive (`mode_conflict`, exit 2).
  `--local` is valid with `setup` and `uninstall`; `--cloud` only with `setup`
  (`mode_option_scope`, exit 2).
- When the **effective** mode is local (flag or routing), `--endpoint`,
  `--reauthorize`, `--manual-token`, `--no-browser`, `--no-clipboard`,
  `--codex-daily-cap`, `--codex-capture-exec` are rejected before any write
  (`local_option_invalid`, exit 2).
- `--owner ID` and `--db ABS` only with `setup --local` and only when no
  descriptor exists; `--project ID` only with `setup --local` and only when no
  descriptor exists or the descriptor is `uninstalled`; otherwise
  `local_option_invalid`. Identifier rules: S4.
- `uninstall --local [--yes] [--purge-config] [--client claude|codex]`: `--yes`
  skips the confirmation (required when non-interactive); `--purge-config`
  also deletes `installation.json` and `.npmrc` and is rejected together with
  `--client` (`local_option_invalid`) and while any registration receipt
  remains (§9). Data is never deleted.
- Controls `disable`, `pause`, `resume`, `prompt-recall-on|off`, `config`
  remain hosted Codex controls; when the detected union is `local` they print
  `local_control_unsupported` (exit 2).
- `--client claude|codex` limits **registration and detachment** to that
  client; **detection and conflict refusal always cover both clients**.
- `--lang`, `--verbose`, `--dry-run` keep their meaning.

### 6.2 Detection (read-only)

Per detected CLI (`availableClient`), evaluated **before** the hosted
coordinator runs:

| Client | **cloud-owned** | **local-owned** | **unknown** |
| --- | --- | --- | --- |
| Claude Code | plugin `cairn-memory@cairn-memory` listed by `claude plugin list --json` in **any** scope and **any** enabled/configured state; **or** the `~/.claude.json` read (next column) finds an own property `mcpServers["cairn"]` (legacy user-scope server; this replaces `oldMCP` **for detection only**; the hosted flow keeps its own `oldMCP` call after routing) | the user-scope configuration file `~/.claude.json` (canonical `HOME`) has an own property `mcpServers["cairn-local"]` (**non-starting inspection**: the file is read with a 4 MiB bound and parsed as JSON; only the `mcpServers` object's `cairn` and `cairn-local` entries (`type`/`command`/`args`) are examined; unrelated entries, parse excerpts and file contents are never retained in diagnostics or printed); **or** the descriptor records `clients.claude` or a Claude checkpoint in state `registering`/`done` (then a missing entry is "registration missing", still local). **Absence rule**: missing file, missing own `mcpServers` property, or missing own `cairn-local` property means absent | `plugin list` fails other than with the specific absence output; `~/.claude.json` exists but is unreadable, over the bound, or not JSON; `mcpServers` is present but not a non-null, non-array object; the recorded Claude destination differs from the current one; the Claude CLI is unavailable while a Claude receipt or non-`detached` checkpoint exists |
| Codex | native inspection (S12) lists `cairn` with transport `streamable_http`; **or** `$CODEX_HOME/cairn/installation.json` exists | native inspection lists `cairn-local` with transport `stdio`; **or** the descriptor records `clients.codex` (then a listing without `cairn-local` is "registration missing", still local) | `config.toml` unreadable other than `ENOENT`; native inspection fails or returns malformed/unrecognized data (a valid empty list is **none**); the recorded Codex destination differs from the current one; the Codex CLI is unavailable while a Codex receipt or non-`detached` checkpoint exists. Both `cairn` and `cairn-local` present is **mixed** |

Plus the descriptor: absent, valid (`state`), or `local_recovery_required`.

Permitted writes during detection: the temporary `CODEX_HOME` copy for native
inspection (removed afterwards; the hosted inspection already does this) and
nothing else. `--dry-run` and `status` run the same probes. A Claude
`cairn-local` entry without a valid descriptor is `local_orphan`; an unknown
Claude state blocks the cloud flow's writes as well (`unknown` row in §6.3).
`claude mcp get cairn-local` is never used by the installer.

The **union** is: `none`; `cloud` (cloud somewhere, no local, no unknown);
`local` (local somewhere, no cloud, no unknown); `mixed` (cloud and local
anywhere); `unknown` (**any** unknown, regardless of local or cloud elsewhere).
A valid pending `operation` of kind `setup` counts as local ownership for the
union.

### 6.3 Routing (`setup`)

Order of evaluation: parse options → `--client` selection → detection →
**mode and option validation** (table below, `local_option_invalid`) →
`--dry-run` (describes what would happen, including a pending `operation`,
and exits without touching the root) → recovery/resume (`local_recovery_required`,
`local_lock_stale`, pending `operation`) → mutation.

| Union | interactive, no flag | non-interactive, no flag | `--local` | `--cloud` |
| --- | --- | --- | --- | --- |
| none | ask once (O2), then route as the chosen flag | `mode_required` (exit 2; prints both rerun commands) | local (§6.4) | existing cloud flow |
| cloud | existing cloud flow, no new question (O4) | existing cloud flow (its own TTY rules) | `mode_conflict_cloud` | existing cloud flow |
| local | local repair of registered clients; ask for each detected unregistered client | local repair of registered clients only; unregistered clients are listed with the `--local` rerun command; exit 0 | local; interactive runs still ask consent for unregistered clients, non-interactive registers all detected clients | `mode_conflict_local` |
| mixed | `mode_mixed` (exit 2) | `mode_mixed` | `mode_mixed` | `mode_mixed` |
| unknown from a **hosted** probe (`plugin list`, `oldMCP`), no local ownership anywhere | existing cloud flow (it reports its own error) | existing cloud flow | `mode_unknown` (exit 2; names the client and the failing probe) | existing cloud flow |
| unknown from a **local** probe (`~/.claude.json` unreadable or malformed, Codex inspection malformed), no local ownership | `mode_unknown` | `mode_unknown` | `mode_unknown` | `mode_unknown` |
| unknown **with** local ownership or a pending local operation anywhere | `mode_unknown` | `mode_unknown` | `mode_unknown` | `mode_unknown` |

A pending `operation` is resumed **only** when the requested action and mode
match it (`setup --local`/effective local resumes `kind: setup`;
`uninstall --local` resumes `kind: uninstall`); `setup --cloud` and
`--dry-run` never resume, and `setup --cloud` with a pending local operation
is `mode_conflict_local`.

Additional cells:

- Descriptor `installed` but no CLI detects `cairn-local`: union `local`;
  repair re-registers the recorded clients.
- `cairn-local` registered in a client but no valid descriptor:
  `local_orphan` (exit 2) printing `npx @cairn-ink/memory uninstall --local`.
- No CLI available: `clients_missing`, exit 0, as today.
- `--local --client codex` with Claude cloud-owned: `mode_conflict_cloud`.

The existing cloud flow's behaviour in the `cloud` and `unknown` rows is
unchanged from 0.5.3 as defined by L06.

### 6.4 Local setup transaction

1. Preflight: Node ≥ 22.16 (`node_required`); not `win32`
   (`local_windows_unsupported`); detection, validation and conflicts (§6.3).
2. Print `local_privacy`: data stays in `~/.cairn-memory`; the installer sends
   nothing anywhere; semantic recall needs a model key; **if the client's
   environment already carries `OPENAI_API_KEY`, the engine will use it for
   recall and send selected text to that provider** (`adapters/mcp/cli.mjs:370`).
3. Consent: interactive, for each selected client not yet registered, ask
   `connect_claude` / `connect_codex` as today (Claude defaults yes, Codex
   requires yes). Non-interactive with `--local`: all selected clients.
   Nothing agreed → `clients_declined`, exit 0.
4. Create the root (0700; refuse an existing symlink or foreign-owned root:
   `local_root_invalid`), canonicalize, take the lock.
5. Descriptor: create `pending` (owner, database) or load the existing one;
   write `operation` with the consented client set and, per client, the
   `previous` vector (from `clients.X.vector`, or null) and the `desired`
   vector (new `engineId`, current `node`, database, owner, project).
6. `installEngine` (§5.2); write `engine`.
7. For each client in `operation.clients`, in order Claude, Codex: checkpoint
   `registering`, register (§7), checkpoint `done` (or `manual`) and set
   `clients.X`. A hard failure stops the loop; the descriptor stays `pending`
   with the checkpoint, and the recovery line says `npx @cairn-ink/memory
   setup --local` resumes.
8. All checkpoints `done`/`manual` → `installed`, `operation: null`, write,
   release the lock. Print `local_done` and the restart hint; exit 1 if any
   client is `manual`, else 0.

## 7. Client registration

### 7.1 Claude Code (`packages/setup/lib/local-claude.mjs`)

- Capability probes (`supports()` convention, `setup.mjs:115`): `mcp add
  --help` shows `--transport` and `--scope`; `mcp remove --help` shows
  `--scope`. Otherwise `claude_mcp_required`: print
  `local_manual_claude` through `write.literal` (shell-quoted), mark `manual`,
  continue with Codex.
- **Inspection** is the non-starting read of `~/.claude.json` described in
  §6.2: absent entry → absent; `type: "stdio"` with `command`/`args` → present,
  parsed into an observed vector; any other shape → `claude_mcp_drifted`.
  `claude mcp get` is never run (S11). Shadowing by a `local` or `project`
  scope entry is Claude's resolution concern and is not detected in 0.6.0;
  the README documents `claude mcp list` for users who see two `cairn-local`
  servers.
- **Registration** when absent: `claude mcp add --transport stdio --scope user
  cairn-local -- <node> <executable> --db <db> --owner <owner> [--project <id>]`,
  then inspect and require the entry with the desired vector
  (`claude_mcp_unverified` otherwise, nothing further written).
- **Replacement** when present: inspect **immediately before** mutating. The
  observed vector must equal the checkpoint's `desired` (→ nothing to do,
  checkpoint `done`) or `previous`. If it equals neither, or `previous` is
  null while an entry exists, refuse with `claude_mcp_drifted` (exit 2,
  nothing removed, manual commands printed). Otherwise run `remove --scope
  user`, then `add` with `desired`, then inspect. If `add` fails: `add` with
  `previous`; if that fails too, `claude_mcp_restore_failed` with the manual
  command. A crash between `remove` and `add` leaves checkpoint `registering`
  with both vectors; the resume re-inspects (absent → add `desired`).
- The hosted plugin and marketplace are not touched.

### 7.2 Codex (`packages/setup/lib/local-codex.mjs`)

- No qualification, no hooks, no `installation.json`, no credential.
- Capability probes: `codex mcp add --help` shows `-- <COMMAND>`; `codex mcp
  remove --help` and `codex mcp list --help` exist. Otherwise
  `codex_mcp_required`: `local_manual_codex` (TOML table via `write.literal`),
  mark `manual`.
- `$CODEX_HOME` resolution and directory checks exactly as the hosted path
  (`codex.mjs:144–157`, `308–312`); the canonical `configPath` is recorded
  (§4.1) and compared on every later run.
- **Registration and replacement** are the same command, because `add`
  overwrites in place: under the hosted `.cairn-setup.lock` in `$CODEX_HOME`
  (`codex.mjs:335–345`), snapshot `config.toml`, run `codex mcp add
  cairn-local -- <node> <executable> --db <db> --owner <owner> [--project <id>]`,
  then verify with native inspection (S12) of the **real** file: exactly one
  `cairn-local`, `transport.type === 'stdio'`, `command` and `args` equal the
  desired vector. If `add` fails, nothing is restored (the file was not
  changed by a failed `add`); if verification fails, `codex_mcp_unverified`
  with the manual snippet, nothing further written.
- **Detachment**: `codex mcp remove cairn-local` (exit 0 even when absent),
  then native inspection must not list `cairn-local`.

### 7.3 Shared

- Both clients receive the identical argument vector derived from the
  canonical root and the descriptor.
- Manual snippets and copyable commands are printed with `write.literal`.
  Serialization follows the output grammar: shell commands quote dynamic
  arguments with `shellArgument`; the Codex TOML snippet uses TOML basic
  strings (escape `\`, `"` and control characters; never shell quoting);
  argv displays use JSON. The approved-flow snapshots elide absolute paths and
  the 80-column check exempts literal lines explicitly; L23 verifies
  copyability per grammar (shell lines round-trip through a POSIX shell
  parser; the TOML snippet parses with native `codex mcp list --json` in a
  temporary home).

## 8. Conflicts (S7)

| Situation | Behaviour |
| --- | --- |
| effective local, union `cloud` | `mode_conflict_cloud` (exit 2), nothing written. Prints, in this order: 1) if Codex is cloud-owned: `npx @cairn-ink/memory uninstall --client codex` (hosted uninstall; it also clears `pairing_record` through Claude, `codex-runtime.mjs:316`) then `codex mcp remove cairn` (the hosted uninstall keeps the MCP table on purpose, `codex-hooks.test.mjs:134`); 2) if Claude is cloud-owned: `claude plugin uninstall cairn-memory@cairn-memory --scope <scope>` for each listed scope, and `claude mcp remove --scope user cairn` when the legacy server exists; 3) rerun `npx @cairn-ink/memory setup --local`. Credentials on cairn.ink are untouched. |
| effective local, union `unknown` | `mode_unknown` (exit 2): names the client and the probe that failed; nothing written. |
| `--cloud`, union `local` (or a pending local `operation`) | `mode_conflict_local` (exit 2): prints `npx @cairn-ink/memory uninstall --local` then rerun `setup --cloud`. Data stays in `~/.cairn-memory/data`. |
| union `mixed`, any flag | `mode_mixed` (exit 2): prints both detach lists above. |
| `cairn-local` present, no valid descriptor | `local_orphan` (exit 2): prints `npx @cairn-ink/memory uninstall --local`. |
| descriptor invalid | `local_recovery_required` (exit 2): prints the descriptor path and `uninstall --local --purge-config` (§9 orphan path). |
| recorded client destination differs from the current environment | `local_client_home_changed` (exit 2): prints both paths and the rerun hint. |

These are refusals in every terminal type.

## 9. `status` and `uninstall --local`

`status` (after the existing cloud lines, which are unchanged):

```
Claude Code: 本機記憶（cairn-local）           / local memory (cairn-local)
Codex: 本機記憶（cairn-local）
  引擎：已安裝 0.6.0                            / engine: installed 0.6.0
  Node：可用 | 找不到，請重跑 setup --local      / node: available | missing, rerun setup --local
  資料：~/.cairn-memory/data                     (--verbose: full paths, owner, engine id, .failed-* dirs)
```

Local status reads the descriptor and runs the §6.2 probes (Codex native
inspection on a temporary copy; Claude's `~/.claude.json` read plus the
hosted `plugin list` probe) and reports per client `registered`, `missing` or
`unknown`. The local status lines start no engine process, run no `claude mcp
get`, no hosted Codex qualification, and repair nothing; the hosted status
lines above them are unchanged, including their legacy `oldMCP` call. Tests assert no filesystem change under `HOME`, `CODEX_HOME` and
`CAIRN_MEMORY_HOME` other than the removed temporary inspection copy, that a
registered entry pointing at a nonexistent database leaves it nonexistent,
and that the installer spawned only the allowlisted probe commands.

`uninstall --local`:

1. Two paths:
   - **descriptor path** (valid descriptor): the state machine of §4.2 with
     `operation.kind = uninstall` and the selected client set;
   - **orphan path** (no descriptor, or invalid descriptor, or `root/engine`
     present without a descriptor): no descriptor is read or written; the
     installer detaches `cairn-local` from the **selected** available clients
     only (`--client` honoured; Claude `mcp remove --scope user cairn-local`,
     Codex `mcp remove cairn-local`, both idempotent) and **never removes
     `root/engine`**, because without a valid descriptor no recorded
     destination can be proven detached: it prints `local_uninstall_retained`
     with the engine path and the manual command to remove it once the user
     has checked every Claude and Codex home they use. With `--purge-config`
     it also removes `installation.json` and `.npmrc` (allowlist, §4.1). It
     prints a recovery receipt line per removed item through `write.literal`.
2. Confirmation `y` (or `--yes`), after printing what will be removed and that
   `data/` is kept.
3. Take the lock (create the root only if missing, to hold the lock).
4. Detach each selected client: Claude `claude mcp remove --scope user
   cairn-local` (absent is success), Codex `codex mcp remove cairn-local` then
   native inspection; checkpoint `detached`, `clients.X = null`. A detach
   failure stops before step 5; rerun resumes. A client whose recorded
   destination differs from the current environment is
   `local_client_home_changed` and stops the run.
5. Engine removal only when **every** recorded client is null, no checkpoint
   is other than `detached`, no client is unknown (§4.1 destinations), **and**
   the current detection lists no `cairn-local`: remove `root/engine`
   (allowlist checks), set `engine: null`, `node: null`, `state: uninstalled`,
   `operation: null`. A scoped run that leaves another client registered
   returns to `installed` instead.
6. `--purge-config` (descriptor path): allowed only when the descriptor is
   `uninstalled` after step 5 (it is rejected up front with `--client`, §6.1);
   removes `installation.json` and `.npmrc`; the root directory stays when
   `data/` is non-empty.
7. Print the data path via `write.literal` and that the user may delete it.

Existing hosted `uninstall --client codex` is unchanged.

## 10. Acceptance

Every installer test runs from the **packed tarball** (`npm pack` →
`npm install --ignore-scripts <tgz>` into a workspace, the mechanism behind
`CAIRN_SETUP_TEST_PACKAGE`), in a private `HOME`, `CODEX_HOME` and
`CAIRN_MEMORY_HOME`, without network during the test phase.

**Network phase (once per run):** prime a private npm cache by installing the
bundled engine tarball into a scratch prefix with `npm_config_cache=<primed>`
(fetches the four pinned dependency tarballs and metadata). The offline phase
sets `CAIRN_SETUP_NPM_CACHE=<primed>` and `CAIRN_SETUP_NPM_OFFLINE=1`. In CI
the network phase is a separate step.

**Fakes:** `fake-claude.mjs` gains `mcp add|get|remove` with `--scope`
(records argv; stores entries by name and scope; `add` of an existing name in
the same scope exits 1 with the real message; `get` prints the real
`NAME:`/`Scope:`/`Command:`/`Args:` layout for the shadowing scope first and
the real absence text with exit 1 when missing; `remove` of a missing name
exits 1; `--help` advertises `--transport`/`--scope` unless `state.noMcp`).
`fake-codex.mjs` gains `mcp add NAME -- cmd args…` (appends or overwrites one
`[mcp_servers.NAME]` table, preserving other bytes), `mcp remove NAME` (exit
0 when absent), `mcp list --json` and `mcp get NAME --json` for stdio tables,
quoted-header parsing for `[mcp_servers."cairn"]`, and `state.noMcpAdd` to
drop the capability; it keeps its hosted behaviours.

**Wiring:** new test files are imported from `packages/setup/test/setup.test.mjs`
(`test:setup`, `package.json:11`). Version assertions in existing tests
(`setup.test.mjs:179`, `codex-hooks.test.mjs:119`) read the version from the
package under test. Packed-runtime gates never read repository docs or source;
tests that do (`authorization.test.mjs:39–48`, `codex.test.mjs:8`) are
separated into a source-only group that runs from the checkout.

**L06 definition of "unchanged"**: for each scenario the test runs the 0.5.3
fixtures (recorded fake `claude` argv list, `config.toml`, `hooks.json`,
`$CODEX_HOME/cairn/**`, output) and the 0.6.0 run, and requires: every
**mutating** fake call (`plugin …`, `mcp remove`, `configure`, writes to
`config.toml`/`hooks.json`/`cairn/**`) identical in content and order; the
only additional calls are from the allowlist of new read-only probes
(the `~/.claude.json` read, `claude plugin list --json` when it was not
already called at that point, the Codex inspection copy); output identical
after normalizing the version string and the runtime directory digest
(`codex-runtime.mjs:90`); no file under `CAIRN_MEMORY_HOME`; no new prompt.

| ID | Case | Observable |
| --- | --- | --- |
| L01 | fresh interactive, both clients, answer `1`, Claude default yes, Codex `y` | descriptor `installed` with exact keys and recorded destinations; `claude mcp add` argv exactly §7.1; `codex mcp add` argv exactly §7.2; `config.toml` other bytes preserved; engine verified; exit 0; the fake auth server records zero requests; zh and en snapshots |
| L02 | fresh interactive, answer `2` | from the first client line on, identical to the 0.5.3 fresh-both approved-flow snapshot |
| L03 | fresh non-interactive, no flag | exit 2, no files under any private home, both rerun commands |
| L04 | fresh non-interactive `--local` | same files as L01, no prompts |
| L05 | fresh non-interactive `--cloud` | existing `tty_required` behaviour and output |
| L06 | **existing cloud unchanged**: {both configured; Claude-only; Codex-only qualified; Codex fallback; Claude installed unconfigured; Claude configured but disabled; legacy user-scope `cairn`; Claude without endpoint metadata; Claude inspection failure (unknown)} × {`setup`, `setup --client codex`, `status`, `--dry-run`, `uninstall --client codex`, `pause`} | the definition above holds for every cell |
| L07 | each L06 state, `setup --local` | exit 2, `mode_conflict_cloud` (or `mode_unknown`), detach commands in §8 order, no writes |
| L08 | existing local, `setup --cloud`; existing local with pending `operation`, `setup --cloud` | exit 2, `mode_conflict_local`, no writes, no resume |
| L09 | existing local, `setup` no flag, Node path changed | engine dir unchanged; Claude remove+add recorded with `previous`/`desired`; Codex single `add`; descriptor `updatedAt` changed; non-interactive variant repairs registered clients only |
| L10 | upgrade (manifest digest changes); SIGKILL during npm on a fresh id; npm exit 1 on a fresh id; verification failure on a **referenced** id | new dir beside the old one, entries moved, old dir intact; killed attempt is quarantined on the next run and the run completes; exit 1 leaves `<id>.failed-*`, old entries and old dir intact, descriptor `pending` with `engine: null`; referenced id left untouched, `<id>-r2` installed, clients moved via journal, old entries' executable still present until the move completes |
| L11 | interrupted transaction: kill after Claude `done`, before Codex; kill after Codex `add` wrote home A but before its checkpoint `done`, resumed under `CODEX_HOME` B | first: descriptor `pending`, `operation` with Claude `done`; rerun resumes without consent prompts, same `ownerId`, Codex registered, `installed`. second: `local_client_home_changed`, nothing registered under B, home A's entry intact |
| L12 | Claude `add` failure after `remove`; kill between `remove` and `add`; observed entry matching neither `previous` nor `desired` (drift) | previous vector re-added; `claude_mcp_restore_failed` only when the retry also fails; after kill the resume re-adds `desired`; drift → `claude_mcp_drifted`, nothing removed |
| L13 | Codex `add` failure; verification mismatch injected | `config.toml` bytes unchanged after a failed `add`; `codex_mcp_unverified` with snippet |
| L14 | `status` for none / cloud / local / mixed / unknown / missing Node / `.failed-*` present / Claude registered with a nonexistent database path | lines per §9; snapshot; no filesystem change other than the removed inspection copy; the database stays nonexistent; the only `claude mcp get` call recorded is the hosted `oldMCP` (`cairn`) call that 0.5.3 status also makes, never `cairn-local`; only allowlisted probes spawned |
| L15 | `uninstall --local`: interactive `y`; `--yes`; `--client codex` leaving Claude (returns to `installed`); `--purge-config --client codex` (rejected); `--purge-config` while a receipt remains (rejected); orphan without descriptor (`cairn-local` detached from selected clients, engine retained with `local_uninstall_retained`); orphan `--client codex` (Claude untouched); orphan under an alternate `CODEX_HOME` (engine retained); invalid descriptor with `--purge-config` (descriptor bytes never rewritten); Codex detach failure injected; changed `CODEX_HOME` | entries removed; `engine/` removed only on the descriptor path when both clients detached, no unknown client, and detection agrees; never on the orphan path; `data/` intact and printed; unrelated TOML preserved; after injected failure the descriptor is `uninstalling` and a rerun finishes; changed home → `local_client_home_changed`, nothing removed |
| L16 | descriptor tampering: extra key, duplicate key, relative path, `external:false` with a foreign path, database under `engine/`, invalid `engineId` inside a vector, symlinked root, foreign uid (skipped when not root) | `local_recovery_required`, nothing written, purge command printed |
| L17 | option errors: `--local --endpoint`; `--local --cloud`; `--owner` without `--local`; `--owner -x`; `--project` on an `installed` descriptor (rejected) and on an `uninstalled` one (accepted, owner and database kept); `--cloud status`; `pause` on local-only; `--local` with existing descriptor plus `--db` | each exit 2 with its key, no writes (except the accepted `uninstalled` + `--project` case) |
| L18 | Windows platform injected | `local_windows_unsupported`, exit 2, nothing written |
| L19 | fake `claude` without `mcp add` | `claude_mcp_required`, manual snippet, Claude `manual`, Codex registered, exit 1 |
| L20 | stale lock (both pids dead); live setup pid; dead setup pid but live child pid; lock without `child` field | `local_lock_stale` with the `rm` command / `lock_retry` / `lock_retry` / conservative `local_lock_stale` wording; nothing written in any case |
| L21 | `--dry-run` with `--local` and effective local, with and without a pending `operation`; `--dry-run` with a Claude registration pointing at a nonexistent database | planned actions printed, pending operation described, no lock, no root, no child other than detection; database stays nonexistent |
| L22 | quoted Codex header `[mcp_servers."cairn"]`; a multiline string containing `[mcp_servers.cairn-local]`; a valid empty `config.toml`; unknown + local (Codex registered, Claude `plugin list` failing) with no flag; Claude `~/.claude.json` with `cairn-local` but no descriptor, then `setup --cloud`; malformed `~/.claude.json`, then `setup --cloud` | first detected as cloud; second not detected as local; third is `none`; fourth refuses with `mode_unknown`; fifth refuses with `local_orphan`; sixth refuses with `mode_unknown`; `~/.claude.json` as `{}`, as unrelated settings only, with `mcpServers: null`, and with `mcpServers: []` → the first two are absent (cloud flow proceeds), the last two are `mode_unknown`; a sibling `mcpServers` entry carrying a synthetic secret header never appears in any output or error params; all refusals write nothing and run no hosted mutation |
| L23 | literal output: paths containing spaces, `$`, backticks, `"`, `'` and `\` in manual snippets and recovery commands | shell lines round-trip through a POSIX shell parser; the TOML snippet parses with native `codex mcp list --json` in a temporary home to the exact vector; argv display is valid JSON; width check exempts only literal lines |
| E01 | real installed engine over stdio (as `packaging/test/qualified-install-mcp.test.mjs`), keyless, sanitized env | `tools/list` is exactly the five default tools; `remember_memory` → `inspect_memory` (by id and listing) → `correct_memory` → `inspect_memory` shows the correction → `forget_memory` → gone; `recall_memory` returns `model_not_configured` with zero provider connections (`packaging/test/preview-installer.test.mjs:133`); a second engine process on the same database sees the remembered item; with `OPENAI_API_KEY` set to a synthetic value and the test-only fetch preload of `packaging/test/qualified-install-mcp.test.mjs:97` answering with that test's fixture responses, one seeded memory and a `recall_memory` query produce exactly the four captured provider requests that test observes (`qualified-install-mcp.test.mjs:112`) and nothing reaches the network |
| E02 | bundle inventory | `tar -tzf` equals `manifest.files`; `sourceHashes` equal the sources at the commit; `generatedHashes` equal the extracted generated files; cross-check with `packaging/artifact-files.json` + extras; counts printed |
| E03 | packed installer inventory and prepack check | `npm pack --json` list equals `files` rules + `runtime/**` from disk; `tar -tzf` agrees; `--check` passes; passes with a drift warning for a re-gzipped identical archive whose manifest is updated; fails on a stale `sha256`, a stale `bytes`, and a stale `sourceHashes` entry |
| M01 | manual, by the setup session, recorded in the PR: real Claude Code and real Codex in a temp `HOME`/`CODEX_HOME` with the packed 0.6.0, `setup --local`, `remember_memory` from one tool and `inspect_memory` from the other | both succeed; the same memory id is visible from both tools; `recall_memory` reports `model_not_configured` |

Node 22.16.0 and 24.15.0 for every automated case. Exit codes are reported
verbatim.

## 11. Follow-up (not 0.6.0)

- **0.7.0 candidate**: `setup --local --capture` wiring the foreground capture
  host with the three consents and the OpenAI key slot, Linux/WSL only; and a
  local `UserPromptSubmit` recall hook. Needs its own contract and owner
  decisions on consent wording and key handling.
- Engine opt-in flags as installer options once the owner wants them.
- macOS verification; Windows native local mode; engine pruning command.

## 12. Packets, ownership and shared files

| Packet | Content | Files |
| --- | --- | --- |
| **S1 engine bundle** | §5 | `packages/setup/build-runtime.mjs`; `packages/setup/runtime/engine/*` (generated, committed); `packages/setup/lib/local-engine.mjs`; `packages/setup/lib/messages.mjs` (its keys); `packages/setup/lib/output.mjs` (technical set); `packages/setup/test/local-engine.test.mjs`; `packages/setup/test/engine-cache.mjs`; `packages/setup/test/setup.test.mjs` (import line) |
| **S2 local mode** | §§4, 6–9 | edits: `packages/setup/lib/{options,setup,clients,messages,codex,output}.mjs`, `packages/setup/test/{fake-claude,fake-codex}.mjs`, `packages/setup/test/{setup,approved-flows,clients,codex,codex-hooks,authorization}.test.mjs`, snapshots; new: `packages/setup/lib/{local-mode,local-descriptor,local-claude,local-codex}.mjs`, `packages/setup/test/local-mode.test.mjs`, `packages/setup/test/local-cloud-unchanged.test.mjs` (L06), `packages/setup/test/fixtures-0.5.3/**` (recorded baselines) |
| **S3 release** | docs, CI, version | `packages/setup/README.md` (including the clarified promise: setup reads a bounded Claude registration configuration file and extracts only the named MCP registration fields; it does not access credential stores or use authentication fields; both languages), `packages/setup/package.json` (0.6.0), `docs/npx-setup-release.md`, `docs/codex-setup.md`, `docs/local-memory-introduction.md`, `README.md`/`README.zh-TW.md` install sections, **shared:** `CHANGELOG.md`, `.github/workflows/npx-setup.yml` (adapters `npm ci`, network-phase priming step, `test:setup` from the packed tarball) |

S1 is implemented and goes to review against this version. S2 starts after
the auditor confirms v0.3. S3 after S2 review.

Shared files touched: `CHANGELOG.md` and `.github/workflows/npx-setup.yml`
only, in S3, after a coordination entry. Not edited: `packaging/build.mjs`,
`packaging/artifact-files.json`, root `package.json`, `ci.yml`,
`tools/testing/*`, anything under `core/`, `adapters/`, `integrations/`,
`plugins/`, `packaging/test/`.

Constraints carried over: TRAPS 1–12; S11; no secrets in argv/env/logs; no
absolute local paths in committed files.

## 13. Message keys (zh and en)

`ask_mode`, `mode_local_description`, `mode_cloud_description`,
`mode_required`, `mode_conflict`, `mode_option_scope`, `mode_conflict_cloud`,
`mode_conflict_local`, `mode_mixed`, `mode_unknown`, `local_option_invalid`,
`local_control_unsupported`, `local_windows_unsupported`, `local_privacy`,
`local_root_invalid`, `local_lock_stale`, `local_recovery_required`,
`local_orphan`, `local_client_home_changed`, `local_engine_installing`,
`local_engine_install_failed`, `local_engine_verification_failed`,
`engine_bundle_invalid`, `engine_bundle_stale`, `engine_bundle_sha_drift`,
`claude_mcp_required`, `claude_mcp_drifted`,
`claude_mcp_restore_failed`, `codex_mcp_required`, `codex_mcp_unverified`,
`local_manual_claude`, `local_manual_codex`, `local_registered`, `local_done`,
`local_status_client`, `local_status_engine`, `local_status_node_ok`,
`local_status_node_missing`, `local_status_registration`,
`local_status_unverified`, `local_status_data`, `local_status_failed_dirs`,
`local_dry_run`, `local_uninstall_plan`, `local_uninstall_confirm`,
`local_uninstall_done`, `local_uninstall_receipt`, `local_uninstall_retained`,
`claude_mcp_unverified`,
`local_data_kept`, `local_resume_hint`, `progress_local_engine`,
`progress_local_claude`, `progress_local_codex`, `recovery_local_setup`.

Copyable commands and TOML/argv snippets go through `write.literal`,
serialized per grammar (§7.3); the approved-flow width test exempts literal
lines and L23 checks their copyability.

## 14. Open questions put to the owner (answered by assumption until overridden)

| Q | Assumption |
| --- | --- |
| Automatic capture/recall in local 0.6.0? | No (S1); §11 follow-up. |
| Default store/identity | One per-user store, generated owner, personal scope (S4). |
| Cloud/local coexistence in one client | No; refuse and print ordered detach steps (S7, §8). |
| Platforms | Linux/WSL tested; macOS untested; Windows refused (S9). |
