# Windows local preview setup

Use **PowerShell, Git, Node >=22.16, npm and `tar.exe`**. The local preview does
not require a Cairn account. The [native installation check](evidence/windows-install.md)
covers the model-free SDK lifecycle; connecting a particular chat client and
model-guided recall are separate checks.

## Install into a new directory

From PowerShell:

```powershell
git clone https://github.com/Cairn-ink/cairn-memory.git
cd cairn-memory
node --version
tar.exe --version
$cairnInstall = Join-Path $env:LOCALAPPDATA 'cairn-local'
npm.cmd run install:preview -- --directory "$cairnInstall" --owner local-user
```

The target must be new, and its parent must already exist without symlink or
junction components. `$env:LOCALAPPDATA` is normally an existing absolute path.
If `cairn-local` already exists, inspect that installation and choose a different
new name; the installer never overwrites or deletes it. You can also supply an
absolute path such as `C:\Users\YOUR_NAME\cairn-local`, with quotes around paths
containing spaces. The Unix example `/absolute/new/cairn-local` is not a Windows
installation path.

`npm.cmd` avoids PowerShell's `npm.ps1` execution-policy restriction. Inside the
installer, npm's JavaScript CLI runs with the current Node binary, without a
shell. Keep npm installed with Node, or launch the installer through
`npm.cmd run install:preview` so its npm entry point is available.

The installer downloads pinned public npm dependencies with install scripts
disabled. It creates `app/`, `data/` and a private `installation-receipt.json`.
It makes no model requests and does not open a memory database during setup.
The receipt includes local paths and identity; keep it private. POSIX permission
bits do not establish a private Windows ACL: use a directory whose Windows
permissions restrict access appropriately for your data.

## Run the model-free walkthrough

From the same source checkout and PowerShell session:

```powershell
npm.cmd ci --prefix adapters/mcp --ignore-scripts
$cairnReceipt = Get-Content -Raw -LiteralPath (Join-Path $cairnInstall 'installation-receipt.json') | ConvertFrom-Json
node adapters/mcp/walkthrough.mjs --executable "$($cairnReceipt.executable)"
```

Use the receipt's `executable`, a `.mjs` file, rather than the Unix `.bin` path.
The walkthrough starts the installed server with Node and uses a fresh synthetic
database. Expect `status: "passed"` and six passed stages:

1. Discover the five memory tools.
2. Save a memory and inspect its source text.
3. Restart the server and inspect the same memory and receipt.
4. Correct the memory and reject a stale revision.
5. Verify that model recall reports `model_not_configured` without a key.
6. Forget the memory and verify that active inspection is empty.

No model key is needed. This check does not demonstrate a successful semantic
recall, autonomous AI tool selection or compatibility with every Windows client.

## Connect your AI tool

Copy `stdio.command` and `stdio.args` from the receipt into a client that supports
local stdio MCP. Use the same database, owner and project across sessions. The
receipt's Node command and arguments already use absolute Windows paths; do not
replace them with Unix paths or a shell command string.

Check the [client evidence matrix](promotion-claims.md#supported-paths) before
choosing a client. The SDK check above does not certify a local Claude, Codex or
ChatGPT setup. Model-guided recall requires a separate OpenAI key supplied through
the server process's secret environment and may incur provider charges.

[Installation, backups and deletion boundaries](../packaging/README.md) ·
[Recorded walkthrough](../README.md#watch-the-recorded-walkthrough) ·
[Known limitations](limitations.md)
