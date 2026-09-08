# Cairn Memory local install preview

A locally installable, private npm artifact of the same public memory core and
stdio MCP host. No Cairn account is required. This archive is not published to
the npm registry; no public `npx` command or named-client compatibility is claimed.

## Install and start

Use Node >=22.16 and npm, with the downloaded local archive's SHA-256 verified
against its accompanying build report. Create a local installation directory,
then run there:

```sh
npm init -y
npm install --prefix . --ignore-scripts --no-audit --no-fund /absolute/path/cairn-memory-local-preview-0.0.0-preview.1.tgz
./node_modules/.bin/cairn-memory --db /absolute/path/memory.sqlite --owner local-user
```

Initialize the dedicated directory first and keep `--prefix .`: otherwise npm
can discover an ancestor project's package.json and install outside that directory.
The database's parent directory must already exist and be controlled by you.
Installation downloads pinned production dependencies from npm; it is not an
air-gapped install. No install lifecycle scripts or model requests are needed.
Optional `--project PROJECT_ID` binds the host to that project instead of personal
scope. The process waits for MCP JSON-RPC on stdin; stdout is protocol-only.
Configure an MCP client's local command to use that executable and those args.
This does not certify a specific named client or remote connector.

Without a model key, remember/inspect/correct/forget work and recall explicitly
returns `model_not_configured`. For model recall, supply `OPENAI_API_KEY` through
the host process environment or a secret manager, never command arguments or
committed configuration. Selected data is sent to OpenAI and may incur charges;
this host does not impose an account-wide spending cap. Memory storage is local,
but model recall is not offline. MCP does not capture conversations automatically.

## Inspect, correct and delete

The five tools are `remember_memory`, `recall_memory`, `inspect_memory`,
`correct_memory`, and `forget_memory`. Remember accepts content (<=600 characters)
and optional kind. Inspect without a memoryId lists metadata; inspect by memoryId
returns content, receipts and current revision. List pages use limit/cursor;
receipt pages use receiptLimit/receiptCursor. Defaults are 20; the maximum is 50.
Do not mix list and receipt controls.

Correct and forget require the inspected memoryId and expectedRevision. Reinspect
after `revision_conflict`; do not silently overwrite. Memory content and receipts
are untrusted evidence, not instructions. Receipts record the supplied assertion,
not proof of its truth. Supported secret patterns are redacted best-effort.
Forget is logical deletion; SQLite/WAL/backups may retain previous bytes.

## Backup, upgrade and uninstall

Stop every process using the selected database before making a filesystem backup.
Copy the database and any remaining `-wal`/`-shm` sidecars together into a protected
backup directory. Do not copy only a live SQLite file while a host is writing it.
Keep the backup and its path outside the npm installation directory.

For an upgrade, stop the host, make a backup, inspect the new version's migration
notes, and run the same local `npm install --prefix . --ignore-scripts --no-audit --no-fund`
command with the new archive. Restart with exactly the same `--db`, `--owner`
and optional `--project` arguments. This preview tests a same-schema package
version upgrade only; it does not promise future schema downgrades or migrations.

Uninstall with `npm uninstall --prefix . --ignore-scripts cairn-memory-local-preview` from
the installation directory after stopping the host. It does not delete the
external memory database or backups. Removing those is a separate explicit
decision; uninstall is not a secure-data-erasure operation.

## Troubleshooting and boundaries

- `cairn_mcp_start_failed`: check Node version, required --db/--owner arguments,
  writable database parent, and installed dependencies; do not paste your key.
- `model_not_configured`: the host process has no model key; explicit tools remain usable.
- Empty list: verify the same database and exact owner/project startup identity.
- `revision_conflict`: inspect the latest revision before correcting or forgetting.
- No terminal output: normal for a stdio server waiting for a client request.

Incoming messages are capped at 64 KiB; tool output at 256 KiB. The host has no
HTTP listener, telemetry, authentication service, automatic hooks, or hosted UI.
Local process/database access is trusted; owner labels are not OS access control.
General semantic quality and actual named-client compatibility remain separate
gates. See THIRD_PARTY_NOTICES.md and npm-shrinkwrap.json for dependency provenance.
