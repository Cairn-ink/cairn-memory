# Installer local mode: contract for `@cairn-ink/memory` 0.6.0

Status: v0.1 draft (setup session, 2026-10-25), awaiting non-author audit.

Base: `main` at `b2513501` (PR #469 local V1 Raw chain and PR #470 unified
memory V1 are merged). Branch `feat/setup-local-mode`.

Inventory: a read-only Codex inventory (gpt-6.1-sol, xhigh) of `b2513501`
produced the gap list this contract resolves. Its measurements are quoted
where used.

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

### 2.2 Setup session (this contract; the auditor may object with evidence)

| # | Decision | Reason |
| --- | --- | --- |
| S1 | **0.6.0 local mode is explicit MCP memory**: the five default tools (`remember_memory`, `recall_memory`, `inspect_memory`, `correct_memory`, `forget_memory`) over stdio, keyless. **Automatic capture and automatic prompt recall are not part of 0.6.0 local mode.** They stay cloud features; the existing `cairn-memory local …` foreground preview remains an operator path and is not wired by the installer. | The foreground capture host needs an OpenAI key (paid), three separate consents, is Linux/WSL-only, and has a per-session rearm limitation (`integrations/client/raw/local-setup.mjs:199–214`). Local automatic recall does not exist yet (`integrations/client/raw/local-hook.mjs:67–69` emits nothing). Shipping those in the same release triples the surface. Follow-up packet: §11. |
| S2 | The installer stays **dependency-free** for cloud users. The engine ships **inside the installer package** as one tarball built by the existing `packaging/build.mjs` (`cairn-memory-local-preview-0.0.0-preview.1.tgz`, ~650 KB) plus a manifest. Local setup installs that tarball into a private per-user directory with `npm install --ignore-scripts` using the tarball's own `npm-shrinkwrap.json` (pinned `@modelcontextprotocol/server` 2.0.0, `@modelcontextprotocol/core` 2.0.0, `zod` 4.5.4, `tiktoken` 1.0.22). | Keeps `npx` download for cloud users almost unchanged (installer grows from ~0.5 MB to ~1.2 MB packed). Reuses the inspected build (`packaging/build.mjs:80–118`) and the install shape already tested by `packaging/install-preview.mjs:44–77`. Dependencies are never bundled inside the installer tree, so `node_modules` is not copied around and lifecycle scripts never run. |
| S3 | **One private installation root for both clients**: `$CAIRN_MEMORY_HOME` or `~/.cairn-memory` (mode 0700). Layout in §4. | Both clients must share one store and one identity (handoff: "同一個產品"). A single root makes `status` and `uninstall` exact. |
| S4 | **Identity defaults**: personal scope; owner ID generated once (`local-` + 16 lowercase hex), stored in the descriptor; `--project ID` optional. Explicit `--owner ID` / `--db ABS` overrides allowed on first local setup only. | The engine requires an owner (`adapters/mcp/cli.mjs:189`); the ID is a label, not access control. A generated ID avoids collisions if stores are ever merged. |
| S5 | **Client registration** uses each client's own mechanism, never hand-editing Claude's JSON: Claude Code via `claude mcp add --transport stdio --scope user cairn-local -- <node> <wrapper> --db … --owner …`; Codex via `[mcp_servers.cairn-local]` in `config.toml` with `command`/`args`, written with the existing snapshot/lock/validate/rename sequence (`packages/setup/lib/codex.mjs:316–357`). Server name **`cairn-local`** for both. | The hosted Claude flow treats a user-scope server named `cairn` as **legacy** and offers to remove it (`packages/setup/lib/setup.mjs:134–145`, `404–412`); a local server named `cairn` would be mis-detected. Codex's hosted entry is `[mcp_servers.cairn]` (`packages/setup/lib/codex-runtime.mjs:568`). |
| S6 | **Node path**: the engine entry is registered with the absolute `process.execPath` of the setup run, as the preview does (`packaging/install-preview.mjs:63`). `status` reports a missing executable; rerunning `setup --local` rewrites the entries (repair). | MCP hosts launched from GUI contexts may lack the user's `PATH`. |
| S7 | **One mode per client, no mixing.** If a client already has a cloud connection and the user asks for local (or the reverse), setup **refuses, writes nothing**, and prints the exact commands to detach the other mode first. No automatic switch and no data migration in 0.6.0. | A client with cloud hooks capturing to cairn.ink and `cairn-local` tools writing to SQLite would split the user's memory silently. Detaching cloud touches credentials and plugin state that the hosted flow owns; keep that explicit and manual for 0.6.0. |
| S8 | **Engine opt-ins** are not exposed by the installer. The registered argument vector is exactly `--db ABS --owner ID [--project ID]`. | O5. |
| S9 | **Supported platforms for local mode in 0.6.0**: Linux and WSL (tested). macOS: same code path, documented as untested. Windows native: `setup --local` refuses with a message pointing to `docs/windows-install.md`. | The build and install seam has a Windows branch (`packaging/build.mjs:24–37`) but no installed-MCP test on Windows in this track. Refusing is safer than a half-working path. |

## 3. Scope and non-claims

In scope: §§4–10. Out of scope and stated in docs: local automatic capture and
recall (§11), cloud→local or local→cloud data migration, a GUI, Windows native
local mode, any recall-quality claim, publishing the engine as its own npm
package, the MCP Registry workflow.

## 4. Installation root and descriptor

```
~/.cairn-memory/                      0700, or $CAIRN_MEMORY_HOME (absolute)
  installation.json                   0600, descriptor (below)
  engine/<installerVersion>-<digest>/ 0700, one per installer version
    app/package.json                  {"name":"cairn-memory-local-installation","private":true}
    app/.npmrc                        registry=https://registry.npmjs.org/
    app/node_modules/cairn-memory-local-preview/…   installed engine + pinned deps
  data/memory.sqlite                  0600, created by the engine on first use
  data/                               0700
```

`<digest>` is the first 12 hex of the SHA-256 of `runtime/engine/manifest.json`
(same convention as the hosted Codex runtime copy,
`packages/setup/lib/codex-runtime.mjs:86–92`).

`installation.json` (exact keys, no extras):

```json
{
  "version": "cairn-local-installation-v1",
  "installerVersion": "0.6.0",
  "engine": { "name": "cairn-memory-local-preview", "version": "0.0.0-preview.1",
              "sha256": "<tarball sha256>", "directory": "/abs/.cairn-memory/engine/0.6.0-abc123def456" },
  "executable": "/abs/.cairn-memory/engine/0.6.0-abc123def456/app/node_modules/cairn-memory-local-preview/bin/cairn-memory.mjs",
  "node": "/abs/node",
  "databasePath": "/abs/.cairn-memory/data/memory.sqlite",
  "ownerId": "local-0123456789abcdef",
  "projectId": null,
  "clients": { "claude": { "server": "cairn-local", "scope": "user" } | null,
               "codex":  { "server": "cairn-local", "configPath": "/abs/.codex/config.toml" } | null },
  "createdAt": "2026-10-25T00:00:00.000Z",
  "updatedAt": "2026-10-25T00:00:00.000Z"
}
```

Rules:

- Written atomically (temp file + rename, 0600) under a lock file
  `~/.cairn-memory/.setup.lock` (`wx`, same pattern as `.cairn-setup.lock`).
- Every read validates the exact key set, `version`, absolute paths without
  control characters or `..`, and that `databasePath` and `executable` are inside
  the root unless `--db` was explicit. Anything else is `local_recovery_required`
  (writes nothing, prints the path).
- The database path is **never** deleted by the installer. `uninstall` keeps
  `data/`.
- Paths in this file are private. The installer never prints them in
  non-verbose mode except in `status --verbose` and in error recovery lines.

## 5. Engine distribution (packet S1)

### 5.1 Build time (`packages/setup/build-runtime.mjs`)

- `node build-runtime.mjs` additionally calls `buildArtifact()` from
  `packaging/build.mjs` and copies the tarball to
  `packages/setup/runtime/engine/cairn-memory-local-preview-0.0.0-preview.1.tgz`,
  and writes `packages/setup/runtime/engine/manifest.json`:
  `{ "version": 1, "name", "version", "sha256", "bytes", "files": [...archive files], "sourceHashes": {...} }`
  from the build report.
- `--check` (prepack) rebuilds the artifact into a temp directory and compares
  `files` and `sourceHashes` with the committed manifest and the committed
  tarball's SHA-256 with the manifest `sha256`. Mismatch fails prepack with
  `engine_bundle_stale`. (npm pack output is deterministic for identical
  contents; if a Node/npm difference ever breaks byte identity, the check
  falls back to comparing the tar listing and the extracted file hashes and
  reports `engine_bundle_sha_drift` as a warning, never silently.)
- `packaging/build.mjs` and `packaging/artifact-files.json` are **not
  modified**. The package name/version inside the bundle stays the preview
  name; it is internal to the installer and documented as such.
- `runtime/` is already in `files` (`packages/setup/package.json:9`), so the
  bundle ships automatically. Expected packed size ≈ 1.2 MB; recorded in the
  release notes.

### 5.2 Setup time (`packages/setup/lib/local-engine.mjs`, new)

`installEngine({ root, node, offline, cacheDir })`:

1. Verify the bundled tarball's SHA-256 against `runtime/engine/manifest.json`
   (`engine_bundle_invalid` on mismatch).
2. Create `root`, `root/engine`, `root/data`, `root/engine/<ver>-<digest>/app`
   with 0700, refusing symlinks and foreign ownership (same checks as
   `privateDirectory` in `integrations/client/private-state.mjs`).
3. Write `app/package.json` and `app/.npmrc` (0600, `wx`). If the versioned
   directory already exists with a valid install (step 5 passes), skip to 6.
4. Run `npm install --prefix app --ignore-scripts --no-audit --no-fund
   [--offline] <tarball>` with the sanitized environment used by
   `packaging/build.mjs:40–58` (`PATH` with the current Node first,
   `npm_config_userconfig`, `TMPDIR`, nothing else). Network is used only for the
   four pinned dependencies; `--offline` is a test seam
   (`CAIRN_SETUP_NPM_OFFLINE=1`, together with `npm_config_cache` pointing at a
   primed cache).
5. Run `<node> <executable> --check-config --db <db> --owner <owner> [--project]`
   and require `{ ok: true, databaseOpened: false, providerContacted: false,
   modelKeyPresent: false }` (`packaging/install-preview.mjs:66–70`).
6. Return `{ executable, directory, sha256 }`.

Failure leaves the partial versioned directory for inspection and reports
`local_engine_install_failed` with the npm exit code in `--verbose`. It never
deletes an older versioned directory: upgrades install side by side, then
`installation.json` and the client entries move to the new one; the previous
directory is removed only by `uninstall` or by a later `setup --local` after
the new one passed step 5 (then at most the immediate predecessor is removed).

## 6. Mode selection and command surface (packet S2)

### 6.1 Options

- New flags: `--local`, `--cloud`. Mutually exclusive (`mode_conflict`, exit 2).
  Valid only with `setup` (`mode_option_scope`, exit 2).
- `--local` rejects `--endpoint`, `--reauthorize`, `--manual-token`,
  `--no-browser`, `--no-clipboard`, `--codex-daily-cap`, `--codex-capture-exec`
  (`local_option_invalid`, exit 2).
- `--owner ID` and `--db ABS` are accepted only with `--local` on a fresh local
  install; otherwise `local_option_invalid`.
- `--lang`, `--verbose`, `--dry-run`, `--client claude|codex` keep their
  meaning.

### 6.2 Detection (read-only, before any question)

Per detected client:

| Client | Cloud present | Local present |
| --- | --- | --- |
| Claude Code | plugin `cairn-memory@cairn-memory` installed and configured (`api_endpoint`+`api_token`), via existing `inspectClaude` | `claude mcp get cairn-local` succeeds (`--scope user`), or descriptor `clients.claude` set |
| Codex | `[mcp_servers.cairn]` with `url`, or `$CODEX_HOME/cairn/installation.json` exists | `[mcp_servers.cairn-local]` with `command`, or descriptor `clients.codex` set |

Plus the descriptor at `~/.cairn-memory/installation.json` (absent, valid, or
`local_recovery_required`).

### 6.3 Routing (`setup`)

1. `--cloud` → existing `setupDetected` path, byte-for-byte the same output as
   0.5.3 except the version line. If any detected client is **local**,
   refuse per §8.
2. `--local` → local path (§6.4). If any detected client is **cloud**, refuse
   per §8.
3. No flag, **any** client cloud-configured → existing cloud path, no question
   (O4).
4. No flag, **any** client local-configured (and none cloud) → local path:
   repair/update silently, no question.
5. No flag, nothing configured, interactive → print the two one-sentence
   descriptions (O2) and ask `1) 本機  2) 雲端` with numbered answers
   (`ask_mode`). Empty answer repeats the question once, then exits 0 with
   `nothing_changed`. Then route as 1 or 2.
6. No flag, nothing configured, non-interactive → `mode_required` (exit 2):
   writes nothing, prints
   `npx @cairn-ink/memory setup --local` and `… --cloud` (O3).

`status`, `--dry-run`, `uninstall`, `disable`, `pause`, `resume`,
`prompt-recall-*`, `config` need no mode flag; they detect.

### 6.4 Local setup sequence

1. Node ≥ 22.16 (`node_required`); platform not `win32` (`local_windows_unsupported`).
2. Detect clients (`availableClient`). None → `clients_missing`, exit 0.
3. Print `local_privacy` (one paragraph: data stays in `~/.cairn-memory`,
   nothing is sent anywhere, semantic recall needs a model key the user adds
   later and would send selected text to that provider).
4. Interactive: for each detected client not yet local, ask `connect_claude` /
   `connect_codex` as today (Claude defaults yes, Codex requires yes). Already
   local clients are updated without asking. Non-interactive with `--local`:
   all detected clients, no questions.
5. Take the lock. Read or create the descriptor (owner generated here).
6. `installEngine` (§5.2).
7. Register each agreed client (§7). Claude first, then Codex; stop on the first
   failure and report progress like today (`progress_*` lines).
8. Write the descriptor last. Print `local_done` with the restart hint.

`--dry-run` prints the planned root, the argument vector shape (without the
owner ID), and per-client actions, then exits 0 without touching disk.

## 7. Client registration

### 7.1 Claude Code (`packages/setup/lib/local-claude.mjs`, new)

- Requires `claude mcp add --help` to show `--transport` and `--scope`, and
  `claude mcp get --help`; otherwise `claude_mcp_required` with the manual
  `.mcp.json` snippet.
- Existing `cairn-local`: `claude mcp get cairn-local` is parsed only for
  presence; the entry is replaced with `claude mcp remove --scope user
  cairn-local` then `add`. Never parse or print its contents (it contains
  private paths).
- Command: `claude mcp add --transport stdio --scope user cairn-local --
  <node> <executable> --db <db> --owner <owner> [--project <id>]`.
- Verify with `claude mcp get cairn-local` exit 0.
- The hosted plugin is **not** installed and the marketplace is not touched.

### 7.2 Codex (`packages/setup/lib/local-codex.mjs`, new)

- Qualification is **not** required: any Codex with `mcp get --json` works.
  Reuse `availableClient`, `snapshot`, `unchanged`, `privateWrite`, the lock and
  the isolated-`CODEX_HOME` validation from `codex.mjs`.
- Candidate text appends or replaces exactly one table:

  ```toml
  [mcp_servers.cairn-local]
  command = "/abs/node"
  args = ["/abs/…/bin/cairn-memory.mjs", "--db", "/abs/.cairn-memory/data/memory.sqlite", "--owner", "local-0123456789abcdef"]
  ```

  Replacement edits only the `[mcp_servers.cairn-local]` body with the same
  regex strategy as `codex-runtime.mjs:579–584`; all other TOML is preserved
  byte for byte.
- Validate the candidate in a temp `CODEX_HOME` with `codex mcp get cairn-local
  --json` expecting `transport.type === 'stdio'`, matching `command` and
  `args`; then lock, re-snapshot, rename, re-verify in the real home.
- No hooks, no `installation.json` under `$CODEX_HOME/cairn/`, no credential.

### 7.3 Shared

- Both clients get the identical argument vector from the descriptor.
- Manual fallback text (`local_manual_claude`, `local_manual_codex`) prints the
  exact command/TOML for users whose CLI lacks the subcommands.

## 8. Conflicts (S7)

| Situation | Behaviour |
| --- | --- |
| `--local` (or interactive choice local) and a client is cloud | `mode_conflict_cloud` (exit 2): names the client(s), writes nothing, prints: Claude: `claude plugin uninstall cairn-memory@cairn-memory` (keeps the token on cairn.ink; nothing is deleted there); Codex: `npx @cairn-ink/memory uninstall --client codex` then remove `[mcp_servers.cairn]` manually (the hosted uninstall keeps it on purpose); then rerun `setup --local`. |
| `--cloud` and a client is local | `mode_conflict_local` (exit 2): prints `npx @cairn-ink/memory uninstall --local` then rerun `setup --cloud`. Data stays in `~/.cairn-memory/data`. |
| No flag, one client cloud and another local | `status` shows both; `setup` without a flag refuses with `mode_mixed` (exit 2) and prints both detach commands. |
| Descriptor present but client entries missing (user removed them) | treated as local, repaired on `setup`. |
| Client entry `cairn-local` present but no descriptor | `local_recovery_required`: prints the entry name and the remove commands; writes nothing. |

Non-interactive behaviour is identical (these are refusals, not questions).

## 9. `status` and `uninstall --local`

`status` (both clients, after the existing cloud lines):

```
Claude Code: 本機記憶（cairn-local）         / local memory (cairn-local)
  引擎：已安裝 0.6.0                           / engine: installed 0.6.0
  Node：可用                                   / node: available   (or: 找不到 /abs/node → 重跑 setup --local)
Codex: 本機記憶（cairn-local）
資料：~/.cairn-memory/data（--verbose 顯示完整路徑、owner）
```

Status never opens the database and never starts the engine.

`uninstall --local` (new; interactive confirmation `y`, or `--yes`
non-interactive):

1. Remove `cairn-local` from each registered client (Claude: `mcp remove`;
   Codex: delete only the `[mcp_servers.cairn-local]` table, same lock/validate
   path).
2. Remove `~/.cairn-memory/engine/`.
3. Rewrite the descriptor with `clients` both `null` and `engine: null`, or
   remove it when `--purge-config`.
4. **Never** remove `data/`. Print its path and that the user may delete it.

Existing `uninstall --client codex` (cloud) is unchanged.

## 10. Acceptance

All installer tests run from the **packed tarball** installed into a temp
prefix (`npm pack` → `npm install --ignore-scripts <tgz>` into a workspace,
already the pattern behind `CAIRN_SETUP_TEST_PACKAGE`), in a private `HOME`
and `CODEX_HOME` and `CAIRN_MEMORY_HOME`, with no network: the npm cache is
primed once per run by `packaging/prepare-cache.mjs` and the engine install runs
with `CAIRN_SETUP_NPM_OFFLINE=1`. Fake `claude` and `codex` from
`packages/setup/test/fake-*.mjs` are extended: fake Claude gains `mcp add|get|remove`
(records argv, stores entries by name and scope in its state file); fake Codex
gains stdio table parsing (`command`/`args`) and `mcp get cairn-local --json`.

| ID | Case | Observable |
| --- | --- | --- |
| L01 | Fresh interactive, both clients, answer `1` (local), Claude default yes, Codex `y` | descriptor exact keys; `claude mcp add` argv exactly as §7.1; TOML table exactly as §7.2 with other TOML bytes preserved; engine `--check-config` passed; exit 0; zero HTTP (fake auth server records no request); snapshot zh and en |
| L02 | Fresh interactive, answer `2` (cloud) | output identical to 0.5.3 fresh-both flow from the first client line onward (existing approved-flows snapshot) |
| L03 | Fresh non-interactive, no flag | exit 2, nothing written, both rerun commands printed |
| L04 | Fresh non-interactive `--local` | same files as L01, no prompts |
| L05 | Fresh non-interactive `--cloud` | existing `tty_required` behaviour |
| L06 | Existing cloud (both clients configured), `setup` with no flag | **byte-identical** `~/.claude`-side fake calls, `config.toml`, `hooks.json`, `installation.json` and output versus 0.5.3 fixtures (compare the fixture files and the recorded fake calls, not only the snapshot) |
| L07 | Existing cloud, `setup --local` | exit 2, `mode_conflict_cloud`, no writes, detach commands printed |
| L08 | Existing local, `setup --cloud` | exit 2, `mode_conflict_local`, no writes |
| L09 | Existing local, `setup` no flag, new Node path | engine dir unchanged, entries rewritten with the new path, descriptor `updatedAt` changed, nothing else changed |
| L10 | Existing local, installer upgraded (manifest digest changes) | new versioned engine dir, entries point to it, old dir removed after check passes; interrupted install (npm exit 1 injected) leaves old dir and entries intact |
| L11 | `status` for: none, cloud, local, mixed, missing Node | lines per §9; no DB open (watch with a non-existent db path) |
| L12 | `uninstall --local` interactive `y` and `--yes` | entries removed, `engine/` removed, `data/` intact and its path printed; Codex unrelated TOML preserved |
| L13 | Tampered descriptor (extra key, relative path, symlinked root) | `local_recovery_required`, nothing written |
| L14 | `--local` with `--endpoint`; `--local --cloud`; `--owner` without `--local`; `status --local` | each exit 2 with its key |
| L15 | Windows platform injected | `local_windows_unsupported`, exit 2, nothing written |
| L16 | Fake `claude` lacking `mcp add` | `claude_mcp_required`, manual snippet printed, Codex still completes |
| L17 | Codex config.toml concurrently modified between snapshot and rename | `codex_concurrent`, original bytes intact |
| E01 | Real engine: spawn `<node> <executable> --db <tmp> --owner <id>` from the installed engine dir over stdio with a real MCP client (as `packaging/test/qualified-install-mcp.test.mjs` does) | `tools/list` is exactly the five default tools; `remember_memory` → `recall_memory` → `inspect_memory` → `correct_memory` → `forget_memory` round trip without any key; `recall_memory` with a semantic query returns `model_not_configured`, not a network attempt |
| E02 | Installed engine inventory | tar listing of the bundled tgz equals `runtime/engine/manifest.json.files`; `sourceHashes` equal the source files at the commit; cross-check with `packaging/artifact-files.json` + extras; counts printed |
| E03 | Packed installer inventory | `npm pack --json` list equals `files` rules + `runtime/**` derived from disk; `tar -tzf` agrees; count printed |
| M01 | Manual, by the setup session, recorded in the PR: real Claude Code and real Codex in a temp `HOME`/`CODEX_HOME` with the packed 0.6.0, `setup --local`, then one `remember_memory` and one `recall_memory` from each tool | tool call succeeds; the same memory is visible from both tools |

Node 22.16.0 and 24.15.0 for every automated case. Exit codes are reported
verbatim.

## 11. Follow-up (not 0.6.0)

- **0.7.0 candidate**: `setup --local --capture` wiring the foreground capture
  host (`cairn-memory local setup`) with the three consents and the OpenAI key
  slot, Linux/WSL only; and a local `UserPromptSubmit` recall hook. Needs its
  own contract and owner decisions on consent wording and key handling.
- Optional engine flags (`--method-packages local-v1`, …) exposed as installer
  options once the owner wants them on by default.
- macOS verification; Windows native local mode.

## 12. Packets, ownership and shared files

| Packet | Content | Files (new or edited) |
| --- | --- | --- |
| **S1 engine bundle** | §5 | `packages/setup/build-runtime.mjs`, `packages/setup/runtime/engine/*` (generated, committed), `packages/setup/lib/local-engine.mjs`, `packages/setup/test/local-engine.test.mjs`, test helper for primed-cache offline install |
| **S2 local mode** | §§4, 6–9 | `packages/setup/lib/{options,setup,clients,messages,codex}.mjs` (edits), `packages/setup/lib/{local-mode,local-claude,local-codex,local-descriptor}.mjs` (new), `packages/setup/test/{fake-claude,fake-codex}.mjs` (extend), `packages/setup/test/local-mode.test.mjs`, approved-flow snapshots |
| **S3 release** | docs, CI, version | `packages/setup/README.md`, `packages/setup/package.json` (0.6.0), `docs/npx-setup-release.md`, `docs/codex-setup.md`, `docs/local-memory-introduction.md`, `README.md`/`README.zh-TW.md` install section, **shared:** `CHANGELOG.md`, `.github/workflows/npx-setup.yml` (add `npm ci --prefix adapters/{mcp,openai}`, `prepare-cache.mjs`, run installer tests from the packed tarball) |

Shared files touched: `CHANGELOG.md` and `.github/workflows/npx-setup.yml`
only, in S3, after a coordination entry. `packaging/build.mjs`,
`packaging/artifact-files.json`, root `package.json` and `ci.yml` are **not**
edited. `test:setup` already exists (`package.json:11`) and keeps its name.

Not edited: anything under `core/`, `adapters/`, `integrations/`, `plugins/`,
`packaging/test/`.

Constraints carried over: TRAPS 1–12; the installer never links `node:sqlite`
(it only spawns the engine); no secrets in argv/env/logs; the public repo gets
no absolute local paths in committed files.

## 13. Open questions put to the owner (answered by assumption until overridden)

| Q | Assumption in this contract |
| --- | --- |
| Automatic capture/recall in local 0.6.0? | No (S1). Documented as a cloud feature; §11 follow-up. |
| Default store/identity | One per-user store, generated owner, personal scope (S4). |
| Cloud/local coexistence in one client | No; refuse and print detach steps (S7). |
| Platforms | Linux/WSL tested; macOS untested; Windows refused (S9). |
