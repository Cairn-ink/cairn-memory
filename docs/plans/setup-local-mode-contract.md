# Installer local mode: contract for `@cairn-ink/memory` 0.6.0

Status: v0.2 (setup session, 2026-10-25). v0.1 was audited by a non-author
Codex auditor (gpt-6.1-sol, xhigh, read-only, `f053a18c`): no P0, fourteen P1
and two P2 findings. v0.2 adopts all of them; the auditor re-checks v0.2.

Base: `main` at `b2513501` (PR #469 local V1 Raw chain and PR #470 unified
memory V1 are merged). Branch `feat/setup-local-mode`.

Inventory: a read-only Codex inventory of `b2513501` produced the gap list this
contract resolves. Measurements quoted where used. Facts verified by the setup
session on this machine (2026-10-25): `packaging/build.mjs` produces a
byte-identical tarball on Node 22.16.0 and 24.15.0 (npm 10.9.2 and 11.12.1,
SHA-256 `2bca0be1…`, 640,060 bytes, 265 files); Claude Code 2.1.310 has
`claude mcp add --transport stdio --scope user NAME -- cmd args`, `mcp get NAME`
and `mcp remove --scope user NAME`; Codex 0.164.0 has `codex mcp add NAME --
cmd args`, `codex mcp remove NAME` and `codex mcp get NAME --json`, and `add`
appends exactly one `[mcp_servers.NAME]` table with `command`/`args` while
preserving every other byte of `config.toml`.

## 1. Goal

`npx @cairn-ink/memory setup` (today 0.5.3, hosted-only) gains a **local
mode**: memory lives in a SQLite file on the user's computer, served by this
repository's stdio MCP server (`cairn-memory --db … --owner …`). No cairn.ink
connection and no account. The hosted ("cloud") mode is unchanged.

Completion:

- `@cairn-ink/memory@0.6.0` on npm lets a new user pick local or cloud with the
  same command.
- A user already connected to cloud upgrades and sees **no behaviour change**
  apart from the printed installer version.
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
| S1 | **0.6.0 local mode is explicit MCP memory**: the five default tools (`remember_memory`, `recall_memory`, `inspect_memory`, `correct_memory`, `forget_memory`) over stdio, keyless. **Automatic capture and automatic prompt recall are not part of 0.6.0 local mode.** They stay cloud features; the existing `cairn-memory local …` foreground preview remains an operator path and is not wired by the installer. | The foreground capture host needs an OpenAI key (paid), three separate consents, is Linux/WSL-only, and has a per-session rearm limitation (`integrations/client/raw/local-setup.mjs:199–214`). Local automatic recall does not exist yet (`integrations/client/raw/local-hook.mjs:67–69` emits nothing). Follow-up: §11. |
| S2 | The installer stays **dependency-free** for cloud users. The engine ships **inside the installer package** as one tarball built by the existing `packaging/build.mjs` (`cairn-memory-local-preview-0.0.0-preview.1.tgz`, 640,060 bytes) plus a manifest. Local setup installs that tarball into a private per-user directory with `npm install --ignore-scripts` using the tarball's own `npm-shrinkwrap.json` (pinned `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/core` 2.0.0, `zod` 4.5.4, `tiktoken` 1.0.22; the builder rejects `hasInstallScript`, `packaging/build.mjs:60–77`). | Keeps the `npx` download for cloud users almost unchanged (installer packed size grows from ~0.5 MB to ~1.2 MB). Reuses the inspected build (`packaging/build.mjs:80–118`) and the install shape tested by `packaging/install-preview.mjs:44–77` and `packaging/test/install.test.mjs:704`. |
| S3 | **One private installation root for both clients**: `$CAIRN_MEMORY_HOME` (absolute, no symlink components after creation) or `~/.cairn-memory`, mode 0700. Layout in §4. | Both clients must share one store and one identity. A single root makes `status` and `uninstall` exact. |
| S4 | **Identity defaults**: personal scope; owner ID generated once (`local-` + 16 lowercase hex), persisted **before** any client registration; `--project ID` optional. `--owner ID` / `--db ABS` are accepted only on the very first local setup (no descriptor yet). | The engine requires an owner (`adapters/mcp/cli.mjs:189`); the ID is a label, not access control. Persisting first means an interrupted setup never regenerates identity. |
| S5 | **Client registration uses each client's own MCP commands**, never hand-edited files: Claude Code `claude mcp add --transport stdio --scope user cairn-local -- <node> <executable> --db … --owner …`; Codex `codex mcp add cairn-local -- <node> <executable> --db … --owner …`. Server name **`cairn-local`** for both. No TOML regex editing anywhere in the local path. A client whose CLI lacks these subcommands gets the manual snippet and is marked `manual`. | The hosted Claude flow treats a user-scope server named `cairn` as legacy and offers removal (`packages/setup/lib/setup.mjs:134–145`, `404–412`); Codex's hosted entry is `[mcp_servers.cairn]` (`packages/setup/lib/codex-runtime.mjs:568`). Native `codex mcp add` preserves unrelated TOML (verified above), so the P2 TOML-subset risk disappears. |
| S6 | **Node path**: the engine is registered with the absolute `process.execPath` of the setup run (`packaging/install-preview.mjs:63`). `status` reports a missing executable; rerunning `setup --local` rewrites the entries. | MCP hosts started from GUI contexts may lack the user's `PATH`. |
| S7 | **One mode per client, no mixing.** Cloud present and local requested (or the reverse): refuse, write nothing, print the exact detach commands in a safe order (§8). No automatic switch and no data migration in 0.6.0. | Cloud hooks capturing to cairn.ink beside `cairn-local` tools writing to SQLite would split memory silently. Detaching cloud touches credentials, pairing and plugin scopes that the hosted flow owns. |
| S8 | **Engine opt-ins** are not exposed. The registered argument vector is exactly `--db ABS --owner ID [--project ID]`. | O5. |
| S9 | **Platforms**: Linux and WSL tested; macOS same code path, documented untested; Windows native refused (`local_windows_unsupported`) with a pointer to `docs/windows-install.md`. | No installed-MCP test on Windows in this track. |
| S10 | **Engine directories are never pruned by `setup`.** Each installer version installs side by side under `engine/<id>/`; only `uninstall --local` removes `engine/`. | An unavailable or unselected client may still reference an older engine (audit P1-5). Disk cost is a few MB per installer version and is documented. |
| S11 | **The installer never links `node:sqlite`, never imports engine or repository code, and never starts the MCP server itself.** It only spawns `npm` and `<node> <executable> --check-config`. | TRAPS 1–3; keeps the hosted import graph unchanged. |

## 3. Scope and non-claims

In scope: §§4–10. Out of scope and stated in docs: local automatic capture and
recall (§11), cloud↔local data migration, a GUI, Windows native local mode,
any recall-quality claim, publishing the engine as its own npm package, the
MCP Registry workflow.

## 4. Installation root and descriptor

```
~/.cairn-memory/                    0700, or $CAIRN_MEMORY_HOME
  .setup.lock                       0600, wx; content: {"pid":N,"startedAt":ISO}
  .npmrc                            0600: registry=https://registry.npmjs.org/
  installation.json                 0600, descriptor
  engine/                           0700
    npm-cache/                      npm cache for engine installs (private)
    <engineId>/app/package.json     {"name":"cairn-memory-local-installation","private":true}
    <engineId>/app/node_modules/cairn-memory-local-preview/…
    <engineId>.failed-<ts>/         a renamed partial install (see §5.3)
  data/                             0700
    memory.sqlite                   created by the engine on first use
```

`engineId` = `<installerVersion>-<digest>`, digest = first 12 hex of the
SHA-256 of `runtime/engine/manifest.json` (convention of
`packages/setup/lib/codex-runtime.mjs:86–92`).

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
  "clients": {
    "claude": { "state": "registering" | "registered" | "manual" | "detaching", "server": "cairn-local", "scope": "user",
                "engineId": "0.6.0-abc123def456", "node": "/abs/node" } | null,
    "codex":  { "state": "...", "server": "cairn-local", "engineId": "...", "node": "/abs/node" } | null
  },
  "createdAt": "ISO", "updatedAt": "ISO"
}
```

Rules:

- **Root canonicalization**: the root is `realpath`ed once after creation;
  every path the installer derives (engine dir, executable, default database)
  is built from that canonical root, never read back from the descriptor.
  The executable is `root/engine/<engine.id>/app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs`.
- **Reads**: file ≤ 64 KiB, owner-only mode (`0600`, uid match on POSIX),
  strict UTF-8 JSON, duplicate keys rejected (the parser counts keys per
  object), exact key sets per `state`, `version` exact, enums exact,
  `engine.id` matches `^\d+\.\d+\.\d+(?:-[\w.]+)?-[0-9a-f]{12}$`, `node` and
  `database.path` absolute without control characters or `..` components.
  `database.external === false` requires `database.path ===
  root/data/memory.sqlite`; `external === true` requires the path to be
  outside the root entirely. Any violation is `local_recovery_required`
  (writes nothing; prints the descriptor path with `write.literal`).
- **Deletion targets** are only `root/engine/**` and `root/.setup.lock`. The
  installer refuses to proceed when `database.path` resolves inside a deletion
  target (`local_recovery_required`).
- **Client destinations** are fixed: Claude scope `user`; Codex the real
  `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`) resolved at run time by
  the same function as the hosted path (`packages/setup/lib/codex.mjs:144–157`).
  The descriptor records no client file paths.
- **Writes**: temp file + `fsync` + `rename` in the root, 0600, only while the
  lock is held.
- **Lock**: `.setup.lock` with `wx`. On `EEXIST`, read it; if the recorded pid
  is not alive, report `local_lock_stale` with the path and the exact `rm`
  command (never auto-remove); otherwise `lock_retry` as today.
- Paths are private: printed only by `status --verbose`, recovery lines and
  manual snippets, always through `write.literal`.

### 4.2 State machine

| From | Action | To |
| --- | --- | --- |
| absent | fresh `setup --local` after consent | `pending` (owner generated, `engine: null`, `clients` null) |
| `pending` | engine installed and verified | `pending` with `engine` set |
| `pending` | client registered | `clients.X.state = registered` |
| `pending` | all agreed clients `registered` or `manual` | `installed` |
| `installed` | rerun (repair/upgrade) | `pending` (same owner) → … → `installed` |
| `installed`/`pending` | `uninstall --local` confirmed | `uninstalling` |
| `uninstalling` | each client detached | `clients.X = null` |
| `uninstalling` | all clients null and `engine/` removed | `uninstalled` (`engine: null`, `node: null`, database kept) |
| `uninstalled` | `setup --local` | `pending` (same owner, same database) |

A rerun in any state resumes from the recorded checkpoints and never
regenerates `ownerId`.

## 5. Engine distribution (packet S1)

### 5.1 Build time (`packages/setup/build-runtime.mjs`)

- `node build-runtime.mjs` additionally calls `buildArtifact()` from
  `packaging/build.mjs` (this is build-time code inside the repository, not
  shipped) and writes:
  - `packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz`;
  - `packages/setup/runtime/engine/manifest.json`:
    `{ "schemaVersion": 1, "package": { "name", "version" }, "sha256", "bytes",
       "files": [...], "sourceHashes": {...}, "generatedHashes": { "package.json": …, "npm-shrinkwrap.json": … } }`.
    `generatedHashes` are SHA-256 of the two generated files extracted from the
    tarball.
- `--check` (prepack): rebuild into a temp dir; if the rebuilt SHA equals the
  committed tarball's SHA and the manifest, pass. Otherwise extract both
  tarballs, compare the complete file lists and every file's hash (including
  the generated files); if all equal, print `engine_bundle_sha_drift` as a
  warning and pass; else fail with `engine_bundle_stale`. A committed manifest
  whose `files`/`sourceHashes`/`generatedHashes` differ from the rebuild fails
  regardless of SHA.
- `packaging/build.mjs` and `packaging/artifact-files.json` are not modified.
  The bundle's internal package name/version stays the preview name and is
  documented as internal.
- `runtime/` is already in `files` (`packages/setup/package.json:9`), so the
  bundle ships automatically. Packed installer size is recorded in the release
  notes.

### 5.2 Setup time (`packages/setup/lib/local-engine.mjs`, new, dependency-free)

`installEngine({ root, engineId, node, env })`:

1. Verify the bundled tarball's SHA-256 and byte count against the shipped
   manifest (`engine_bundle_invalid`).
2. `root/engine/<engineId>/` must not exist (or be a verified complete install,
   step 6, in which case return it). Create `…/app` 0700.
3. Write `app/package.json` (0600, `wx`).
4. Spawn `npm install --prefix <app> --ignore-scripts --no-audit --no-fund
   [--offline] <tarball>` with **exactly** this environment: `PATH` =
   directory of `node` + `path.delimiter` + the caller's `PATH`;
   `npm_config_userconfig` = `root/.npmrc`; `npm_config_cache` =
   `root/engine/npm-cache` (or the validated absolute
   `CAIRN_SETUP_NPM_CACHE` test seam); `TMPDIR`/`TMP`/`TEMP` passed through
   after the same validation as `packaging/build.mjs:40–47`; `SystemRoot` on
   Windows; `npm_config_audit=false`, `npm_config_fund=false`; nothing else
   (no `HOME`, no `OPENAI_API_KEY`, no `CAIRN_*`). `--offline` is added when
   `CAIRN_SETUP_NPM_OFFLINE=1`. Timeout 120 s; stdout/stderr captured and
   shown only with `--verbose`.
5. **Installed-tree verification**: for every entry of `manifest.files`, the
   file exists under `app/node_modules/cairn-memory-local-preview/` and its
   hash equals `sourceHashes[...]` or `generatedHashes[...]`; no extra regular
   files under that directory; `node_modules/{@modelcontextprotocol/server,
   @modelcontextprotocol/core,zod,tiktoken}/package.json` report the four pinned
   versions. Mismatch: `local_engine_verification_failed`.
6. **Syntax check**: spawn `<node> <executable> --check-config --db <db>
   --owner <owner> [--project <id>]` with the same sanitized environment (no
   key variables) and require `{ ok: true, databaseOpened: false,
   providerContacted: false, modelKeyPresent: false }`
   (`packaging/install-preview.mjs:66–70`). This proves syntax and loadable
   CLI only; MCP start-up is proven by acceptance E01, not at setup time.
7. Return `{ executable, engineId, sha256 }`.

### 5.3 Failure and recovery

- On any failure in steps 3–6 the installer renames the partial directory to
  `root/engine/<engineId>.failed-<unix ms>` (same filesystem, no deletion),
  reports `local_engine_install_failed` (npm exit code under `--verbose`) and
  leaves the descriptor in `pending` with `engine: null`. The next run installs
  afresh; `.failed-*` directories are removed by `uninstall --local` only, and
  `status --verbose` lists them.
- Previous `engine/<id>` directories are never removed by `setup` (S10).

## 6. Mode selection and command surface (packet S2)

### 6.1 Options

- New flags: `--local`, `--cloud`. Mutually exclusive (`mode_conflict`, exit 2).
  `--local` is valid with `setup` and `uninstall`; `--cloud` only with `setup`
  (`mode_option_scope`, exit 2).
- `--local` with `setup` rejects `--endpoint`, `--reauthorize`,
  `--manual-token`, `--no-browser`, `--no-clipboard`, `--codex-daily-cap`,
  `--codex-capture-exec` (`local_option_invalid`, exit 2). The rejection applies
  to the **effective** mode: when no flag is given and routing resolves to
  local, the same options are rejected before any write.
- `--owner ID` (engine `identifier` rules) and `--db ABS` only with `setup
  --local` and only when no descriptor exists; otherwise `local_option_invalid`.
- `uninstall --local [--yes] [--purge-config]`: `--yes` skips the confirmation
  (required when non-interactive); `--purge-config` also deletes
  `installation.json` and `.npmrc`. Data is never deleted.
- Controls `disable`, `pause`, `resume`, `prompt-recall-on|off`, `config`
  remain hosted Codex controls; when the detected union is local-only they
  print `local_control_unsupported` (exit 2) because local mode has no
  automatic capture.
- `--client claude|codex` limits **registration and detachment** to that
  client; **detection and conflict refusal always cover both clients**.
- `--lang`, `--verbose`, `--dry-run` keep their meaning.

### 6.2 Detection (read-only)

Per detected CLI (`availableClient`), evaluated **before** the hosted
coordinator runs:

| Client | **cloud-owned** | **local-owned** | unknown |
| --- | --- | --- | --- |
| Claude Code | plugin `cairn-memory@cairn-memory` listed by `claude plugin list --json` in **any** scope and **any** enabled/configured state; **or** a user-scope MCP server `cairn` exists (`oldMCP`, `setup.mjs:134–145`) | `claude mcp get cairn-local` exits 0 | `plugin list` or `mcp get` fails with anything other than the specific absence output |
| Codex | `[mcp_servers.cairn]` table present in the resolved `config.toml` text, **or** `$CODEX_HOME/cairn/installation.json` exists | `[mcp_servers.cairn-local]` table present in the `config.toml` text (textual header match; no `codex` child process, because `codex mcp …` may write helper files into `CODEX_HOME`) | `config.toml` unreadable other than `ENOENT` |

Plus the descriptor: absent, valid (`state`), or `local_recovery_required`.

Permitted writes during detection: none. Claude detection runs only
`plugin list --json` and `mcp get` (the latter is what the hosted flow already
runs on `setup`; `--dry-run` and `status` skip it exactly as today, and local
`--dry-run`/`status` derive Claude's local state from the descriptor alone).

The **union** of all detected clients is one of: `none`, `cloud`, `local`,
`mixed` (cloud and local anywhere, across or within clients), `unknown`
(any unknown and no local).

### 6.3 Routing (`setup`)

Order of evaluation: parse options → `--client` selection → detection →
recovery (`local_recovery_required`, `local_lock_stale`) → conflicts →
`--dry-run` → mode.

| Union | interactive, no flag | non-interactive, no flag | `--local` | `--cloud` |
| --- | --- | --- | --- | --- |
| none | ask once (O2), then route as `--local` or `--cloud` | `mode_required` (exit 2; prints both rerun commands) | local | existing cloud flow |
| cloud | existing cloud flow, no new question (O4) | existing cloud flow (its own TTY rules) | `mode_conflict_cloud` | existing cloud flow |
| unknown | existing cloud flow (it reports its own error) | existing cloud flow | `mode_conflict_cloud` | existing cloud flow |
| local | local repair; ask only for a detected client not yet registered | local repair of registered clients only; unregistered clients are listed with the `--local` rerun command; exit 0 | local (register all detected clients without questions) | `mode_conflict_local` |
| mixed | `mode_mixed` (exit 2) | `mode_mixed` | `mode_mixed` | `mode_mixed` |

Additional cells:

- Descriptor `installed` but no CLI detects `cairn-local` (user removed the
  entries): union `local`; repair re-registers.
- Descriptor `pending`/`uninstalling`: resume that transaction first (§4.2).
- `cairn-local` registered in a client but no descriptor: `local_orphan`
  (exit 2) printing `npx @cairn-ink/memory uninstall --local`, which handles
  orphans (§9).
- No CLI available: `clients_missing`, exit 0, as today.
- `--local --client codex` with Claude cloud-owned: still `mode_conflict_cloud`.
- `--dry-run` with `--local` or effective local: prints the planned root, the
  argument vector shape (owner elided), and the per-client action; no lock, no
  directory, no child other than the detection commands above.

The existing cloud flow's output in the `cloud` and `unknown` rows is
**byte-identical to 0.5.3** apart from the version line (L06).

### 6.4 Local setup transaction

1. Preflight: Node ≥ 22.16 (`node_required`); not `win32`
   (`local_windows_unsupported`); detection and conflicts (§6.3).
2. Print `local_privacy` (one paragraph: data stays in `~/.cairn-memory`,
   nothing is sent anywhere, semantic recall needs a model key the user adds
   later and would send selected text to that provider).
3. Consent: interactive, for each selected client not yet `registered`, ask
   `connect_claude` / `connect_codex` as today (Claude defaults yes, Codex
   requires yes). Non-interactive with `--local`: all selected clients.
   Nothing agreed → `clients_declined`, exit 0.
4. Create the root (0700; refuse an existing symlink or foreign-owned root:
   `local_root_invalid`), canonicalize, take the lock.
5. Descriptor: create `pending` with the generated (or `--owner`) owner and the
   database (default or `--db`), or load and validate the existing one and set
   `state: pending`.
6. `installEngine` (§5.2); write `engine` into the descriptor.
7. For each agreed client in order Claude, Codex: set
   `clients.X.state = registering`, register (§7), set `registered` (or
   `manual`). A hard failure (child error other than capability shortfall)
   stops the loop; the descriptor stays `pending` with the checkpoint and the
   error recovery lines say `npx @cairn-ink/memory setup --local` resumes.
8. All agreed clients `registered`/`manual` → `state: installed`, write, release
   lock. Print `local_done` and the restart hint; exit 1 if any client is
   `manual`, else 0.

## 7. Client registration

### 7.1 Claude Code (`packages/setup/lib/local-claude.mjs`)

- Capability probes (same `supports()` convention as `setup.mjs:115`):
  `mcp add --help` must show `--transport` and `--scope`; `mcp remove --help`
  must show `--scope`; `mcp get --help` must exist. Otherwise
  `claude_mcp_required`: print `local_manual_claude` (the exact `claude mcp add`
  command via `write.literal`), mark `manual`, continue with Codex.
- Presence: `claude mcp get cairn-local`; exit 0 → present; the specific
  absence output (`No MCP server named "cairn-local".` or `No MCP server found
  with name: cairn-local`, the two forms recognized at `setup.mjs:134–145`) →
  absent; anything else → `command_failed`. Output is never parsed further or
  printed (it contains private paths).
- Registration when present: record the **previous vector** (from the
  descriptor's `clients.claude`: `engineId`, `node`, database, owner) in the
  `registering` checkpoint, then `claude mcp remove --scope user cairn-local`,
  then `add`. If `add` fails: re-run `add` with the previous vector; if that
  also fails, `claude_mcp_restore_failed` with the manual command. Verify with
  `mcp get cairn-local` exit 0 after every `add`.
- Command: `claude mcp add --transport stdio --scope user cairn-local --
  <node> <executable> --db <db> --owner <owner> [--project <id>]`.
- The hosted plugin and marketplace are not touched.

### 7.2 Codex (`packages/setup/lib/local-codex.mjs`)

- No qualification, no hooks, no `installation.json`, no credential.
- Capability probes: `codex mcp add --help` shows `-- <COMMAND>`; `codex mcp
  remove --help` and `codex mcp get --help` exist. Otherwise
  `codex_mcp_required`: print `local_manual_codex` (the TOML table via
  `write.literal`), mark `manual`.
- `$CODEX_HOME` resolution and directory checks exactly as the hosted path
  (`codex.mjs:144–157`, `308–312`).
- Presence: textual `[mcp_servers.cairn-local]` header in `config.toml`.
- Registration when present: snapshot `config.toml`, `codex mcp remove
  cairn-local`, then `codex mcp add cairn-local -- <node> <executable> --db
  <db> --owner <owner> [--project <id>]`. If `add` fails, restore the snapshot
  bytes atomically (temp + rename, the file is ours to restore because we just
  removed our own table) and report `codex_mcp_restore_failed` if even that
  fails. Verify with `codex mcp get cairn-local --json` in the **real** home:
  `transport.type === 'stdio'`, `command` and `args` equal the vector.
- Lock: the hosted `.cairn-setup.lock` in `$CODEX_HOME` is taken around
  remove/add/verify, as today (`codex.mjs:335–345`).

### 7.3 Shared

- Both clients receive the identical argument vector derived from the
  canonical root and the descriptor.
- Manual snippets are printed with `write.literal` (no 80-column wrapping) and
  contain the real paths; the approved-flow snapshots elide them.

## 8. Conflicts (S7)

| Situation | Behaviour |
| --- | --- |
| `--local` or effective local, union `cloud`/`unknown` | `mode_conflict_cloud` (exit 2), nothing written. Prints, in this order: 1) if Codex is cloud-owned: `npx @cairn-ink/memory uninstall --client codex` (hosted uninstall, which also clears `pairing_record` through Claude, `codex-runtime.mjs:316`) then `codex mcp remove cairn` (the hosted uninstall keeps the MCP table on purpose, `codex-hooks.test.mjs:134`); 2) if Claude is cloud-owned: `claude plugin uninstall cairn-memory@cairn-memory --scope <scope>` for each listed scope, and `claude mcp remove cairn` when the legacy server exists; 3) rerun `npx @cairn-ink/memory setup --local`. Credentials on cairn.ink are untouched. |
| `--cloud`, union `local` | `mode_conflict_local` (exit 2): prints `npx @cairn-ink/memory uninstall --local` then rerun `setup --cloud`. Data stays in `~/.cairn-memory/data`. |
| union `mixed`, any flag | `mode_mixed` (exit 2): prints both detach lists above. |
| `cairn-local` present, no descriptor | `local_orphan` (exit 2): prints `npx @cairn-ink/memory uninstall --local`. |
| descriptor invalid | `local_recovery_required` (exit 2): prints the descriptor path and `uninstall --local --purge-config` as the way out (it works without a valid descriptor, §9). |

These are refusals in every terminal type.

## 9. `status` and `uninstall --local`

`status` (after the existing cloud lines, unchanged):

```
Claude Code: 本機記憶（cairn-local）           / local memory (cairn-local)
Codex: 本機記憶（cairn-local）
  引擎：已安裝 0.6.0                            / engine: installed 0.6.0
  Node：可用 | 找不到，請重跑 setup --local      / node: available | missing, rerun setup --local
  資料：~/.cairn-memory/data                     (--verbose: full paths, owner, engine id, .failed-* dirs)
```

Local status reads the descriptor and `config.toml` text and runs the same
Claude probes the hosted status already runs; it starts no engine process, runs
no `codex` child, performs no qualification and repairs nothing. Tests assert
no filesystem change under `HOME`, `CODEX_HOME`, `CAIRN_MEMORY_HOME` and no
child process other than the fake `claude` recorded calls.

`uninstall --local`:

1. Works in three situations: valid descriptor; **orphan** (no or invalid
   descriptor, but `cairn-local` found in a client, or `root/engine` exists);
   `--purge-config` with an invalid descriptor.
2. Confirmation `y` (or `--yes`), after printing what will be removed and that
   `data/` is kept.
3. Take the lock (create the root if it is missing only to hold the lock).
   Set `state: uninstalling` when a descriptor exists.
4. For each client (selected by `--client`, default both): detach
   (`claude mcp remove --scope user cairn-local`; `codex mcp remove
   cairn-local` with snapshot/verify as §7.2); on success set
   `clients.X = null`. A detach failure stops before step 5 and the descriptor
   stays `uninstalling`; rerun resumes.
5. Only when no client is still registered (descriptor and detection agree):
   remove `root/engine/` (after verifying it is a real directory inside the
   canonical root). Set `engine: null`, `node: null`, `state: uninstalled`.
6. `--purge-config`: also remove `installation.json` and `.npmrc`; the root
   directory stays if `data/` is non-empty.
7. Print the data path via `write.literal` and that the user may delete it.

Existing hosted `uninstall --client codex` is unchanged.

## 10. Acceptance

Every installer test runs from the **packed tarball** (`npm pack` →
`npm install --ignore-scripts <tgz>` into a workspace, the mechanism behind
`CAIRN_SETUP_TEST_PACKAGE`), in a private `HOME`, `CODEX_HOME` and
`CAIRN_MEMORY_HOME`, without network during the test phase.

**Network phase (once per run, before the offline phase):** prime a private
npm cache by installing the bundled engine tarball into a scratch prefix with
`npm_config_cache=<primed>` (this fetches the four pinned dependency tarballs
and their metadata; `packaging/prepare-cache.mjs` alone fetches metadata only).
The offline phase sets `CAIRN_SETUP_NPM_CACHE=<primed>` and
`CAIRN_SETUP_NPM_OFFLINE=1`. In CI the network phase is a separate step.

**Fakes:** `fake-claude.mjs` gains `mcp add|get|remove` with `--scope`
(records argv; stores entries by name and scope in its state; `get` prints the
exact absence text when missing; `--help` advertises `--transport`/`--scope`
unless `state.noMcp`). `fake-codex.mjs` gains `mcp add NAME -- cmd args…`
(appends a `[mcp_servers.NAME]` table with `command`/`args`, preserving other
bytes), `mcp remove NAME`, `mcp get NAME --json` for stdio tables, and
`state.noMcpAdd` to drop the capability; it keeps its existing hosted
behaviours.

**Wiring:** new test files are imported from `packages/setup/test/setup.test.mjs`
(the single `test:setup` entry, `package.json:11`). Version assertions in
existing tests (`setup.test.mjs:179`) move to a shared constant read from
`package.json`. Packed-runtime gates never read repository docs or source.

| ID | Case | Observable |
| --- | --- | --- |
| L01 | fresh interactive, both clients, answer `1`, Claude default yes, Codex `y` | descriptor `installed` with exact keys; `claude mcp add` argv exactly §7.1; `codex mcp add` argv exactly §7.2; `config.toml` other bytes preserved; engine tree verification and `--check-config` passed; exit 0; the fake auth server records zero requests; zh and en snapshots (paths elided) |
| L02 | fresh interactive, answer `2` | from the first client line on, identical to the 0.5.3 fresh-both approved-flow snapshot |
| L03 | fresh non-interactive, no flag | exit 2, no files under any private home, both rerun commands |
| L04 | fresh non-interactive `--local` | same files as L01, no prompts |
| L05 | fresh non-interactive `--cloud` | existing `tty_required` behaviour and output |
| L06 | **existing cloud unchanged**: for each of {both configured; Claude-only configured; Codex-only (qualified); Codex fallback (unqualified); Claude installed but unconfigured; Claude configured but disabled; legacy user-scope `cairn` MCP; Claude without endpoint metadata} × {`setup`, `setup --client codex`, `status`, `--dry-run`, `uninstall --client codex`, `pause`} | the recorded fake-`claude` argv list, `config.toml`, `hooks.json`, `$CODEX_HOME/cairn/**` bytes and the output are **equal** to the same scenario run against the 0.5.3 fixtures, normalizing only the installer version string and the runtime directory digest (`codex-runtime.mjs:90`); no file appears under `CAIRN_MEMORY_HOME`; no new prompt is asked |
| L07 | existing cloud (each of the L06 states), `setup --local` | exit 2, `mode_conflict_cloud`, detach commands in §8 order, no writes |
| L08 | existing local, `setup --cloud` | exit 2, `mode_conflict_local`, no writes |
| L09 | existing local, `setup` no flag, Node path changed | engine dir unchanged, both entries re-added with the new path (remove-then-add recorded), descriptor `updatedAt` changed, nothing else changed; non-interactive variant repairs registered clients only |
| L10 | existing local, installer upgraded (manifest digest changes) | new engine dir beside the old one; entries point to the new one; old dir still present; injected npm exit 1 leaves `<id>.failed-*`, old entries and old dir intact, descriptor `pending` with `engine: null`; the next run completes |
| L11 | interrupted transaction: kill after Claude registered, before Codex | descriptor `pending` with Claude `registered`; rerun resumes, same `ownerId`, Codex registered, `installed` |
| L12 | Claude `add` failure injected after `remove` | previous vector re-added; `claude_mcp_restore_failed` only when the retry is also failed; descriptor checkpoint shows `registering` with the previous vector |
| L13 | Codex `add` failure injected after `remove` | `config.toml` bytes restored to the snapshot |
| L14 | `status` for none / cloud / local / mixed / missing Node / `.failed-*` present | lines per §9; snapshot; no filesystem change; no `codex` child in local status |
| L15 | `uninstall --local`: interactive `y`; `--yes`; orphan without descriptor; invalid descriptor with `--purge-config`; detach failure injected for Codex | entries removed; `engine/` removed only when both clients detached; `data/` intact and printed; unrelated TOML preserved; after injected failure the descriptor is `uninstalling` and a rerun finishes |
| L16 | descriptor tampering: extra key, duplicate key, relative path, `external:false` with a foreign path, database under `engine/`, symlinked root, foreign uid (skipped when not root) | `local_recovery_required`, nothing written, `uninstall --local --purge-config` printed |
| L17 | option errors: `--local --endpoint`; `--local --cloud`; `--owner` without `--local`; `--cloud status`; `pause` on local-only; `--local` with existing descriptor plus `--db` | each exit 2 with its key, no writes |
| L18 | Windows platform injected | `local_windows_unsupported`, exit 2, nothing written |
| L19 | fake `claude` without `mcp add` | `claude_mcp_required`, manual snippet, Claude `manual`, Codex registered, exit 1 |
| L20 | stale lock (dead pid) and live lock | `local_lock_stale` with the `rm` command / `lock_retry`; nothing written |
| L21 | `--dry-run` with `--local` and effective local | planned actions printed, no lock, no root, no child other than detection |
| E01 | real installed engine over stdio (as `packaging/test/qualified-install-mcp.test.mjs` does), keyless, sanitized env | `tools/list` is exactly the five default tools; `remember_memory` → `inspect_memory` (by id and by listing) → `correct_memory` → `inspect_memory` shows the correction → `forget_memory` → `inspect_memory` reports it gone; `recall_memory` returns `model_not_configured` and the fake provider records zero connections (`packaging/test/preview-installer.test.mjs:133` pattern); a second engine process on the same database sees the remembered item (shared visibility) |
| E02 | bundle inventory | `tar -tzf` of the bundled tgz equals `manifest.files`; `sourceHashes` equal the source files at the commit; `generatedHashes` equal the extracted generated files; cross-check against `packaging/artifact-files.json` + extras; counts printed |
| E03 | packed installer inventory | `npm pack --json` list equals `files` rules + `runtime/**` derived from disk; `tar -tzf` agrees; count printed; `prepack --check` passes and fails on an injected stale byte |
| M01 | manual, by the setup session, recorded in the PR: real Claude Code and real Codex in a temp `HOME`/`CODEX_HOME` with the packed 0.6.0, `setup --local`, then `remember_memory` from one tool and `inspect_memory` from the other | both succeed; the same memory id is visible from both tools; `recall_memory` reports `model_not_configured` |

Node 22.16.0 and 24.15.0 for every automated case. Exit codes are reported
verbatim.

## 11. Follow-up (not 0.6.0)

- **0.7.0 candidate**: `setup --local --capture` wiring the foreground capture
  host (`cairn-memory local setup`) with the three consents and the OpenAI key
  slot, Linux/WSL only; and a local `UserPromptSubmit` recall hook. Needs its
  own contract and owner decisions on consent wording and key handling.
- Engine opt-in flags as installer options once the owner wants them.
- macOS verification; Windows native local mode; engine pruning command.

## 12. Packets, ownership and shared files

| Packet | Content | Files |
| --- | --- | --- |
| **S1 engine bundle** | §5 | `packages/setup/build-runtime.mjs`; `packages/setup/runtime/engine/*` (generated, committed); `packages/setup/lib/local-engine.mjs`; `packages/setup/test/local-engine.test.mjs`; `packages/setup/test/engine-cache.mjs` (network-phase priming helper); `packages/setup/test/setup.test.mjs` (import line) |
| **S2 local mode** | §§4, 6–9 | edits: `packages/setup/lib/{options,setup,clients,messages,codex}.mjs`, `packages/setup/test/{fake-claude,fake-codex}.mjs`, `packages/setup/test/{setup,approved-flows,clients}.test.mjs`, snapshots; new: `packages/setup/lib/{local-mode,local-descriptor,local-claude,local-codex}.mjs`, `packages/setup/test/local-mode.test.mjs`, `packages/setup/test/local-cloud-unchanged.test.mjs` (L06) |
| **S3 release** | docs, CI, version | `packages/setup/README.md`, `packages/setup/package.json` (0.6.0), `docs/npx-setup-release.md`, `docs/codex-setup.md`, `docs/local-memory-introduction.md`, `README.md`/`README.zh-TW.md` install sections, **shared:** `CHANGELOG.md`, `.github/workflows/npx-setup.yml` (add `npm ci --prefix adapters/{mcp,openai}`, the network-phase priming step, and `test:setup` from the packed tarball) |

S1 may start now. S2 starts after the auditor confirms v0.2. S3 after S2
review.

Shared files touched: `CHANGELOG.md` and `.github/workflows/npx-setup.yml`
only, in S3, after a coordination entry. Not edited: `packaging/build.mjs`,
`packaging/artifact-files.json`, root `package.json`, `ci.yml`,
`tools/testing/*`, anything under `core/`, `adapters/`, `integrations/`,
`plugins/`, `packaging/test/`.

Constraints carried over: TRAPS 1–12; S11; no secrets in argv/env/logs; no
absolute local paths in committed files.

## 13. Message keys (zh and en, 80-column approved-flow rule)

`ask_mode`, `mode_local_description`, `mode_cloud_description`,
`mode_required`, `mode_conflict`, `mode_option_scope`, `mode_conflict_cloud`,
`mode_conflict_local`, `mode_mixed`, `local_option_invalid`,
`local_control_unsupported`, `local_windows_unsupported`, `local_privacy`,
`local_root_invalid`, `local_lock_stale`, `local_recovery_required`,
`local_orphan`, `local_engine_installing`, `local_engine_install_failed`,
`local_engine_verification_failed`, `engine_bundle_invalid`,
`engine_bundle_stale`, `engine_bundle_sha_drift`, `claude_mcp_required`,
`claude_mcp_restore_failed`, `codex_mcp_required`, `codex_mcp_restore_failed`,
`local_manual_claude`, `local_manual_codex`, `local_registered`,
`local_done`, `local_status_client`, `local_status_engine`,
`local_status_node_ok`, `local_status_node_missing`, `local_status_data`,
`local_status_failed_dirs`, `local_dry_run`, `local_uninstall_plan`,
`local_uninstall_confirm`, `local_uninstall_done`, `local_data_kept`,
`local_resume_hint`, `progress_local_engine`, `progress_local_claude`,
`progress_local_codex`, `recovery_local_setup`.

Copyable commands and TOML/argv snippets go through `write.literal`; the
approved-flow snapshots elide absolute paths.

## 14. Open questions put to the owner (answered by assumption until overridden)

| Q | Assumption |
| --- | --- |
| Automatic capture/recall in local 0.6.0? | No (S1); §11 follow-up. |
| Default store/identity | One per-user store, generated owner, personal scope (S4). |
| Cloud/local coexistence in one client | No; refuse and print ordered detach steps (S7, §8). |
| Platforms | Linux/WSL tested; macOS untested; Windows refused (S9). |
