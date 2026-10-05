# Native Windows installation and keyless lifecycle check

On 2026-10-05, an agent-operated check used a Windows x64 filesystem and native
Windows Node 24.15.0, launched from WSL on Windows NT 10.0.26200. The tested
source contained the Windows npm-launch and CRLF fixes proposed with this
report. A portable Node distribution was verified against Node's published
SHA-256 before use; the machine's existing Node installation was not upgraded.

The first Windows CI run also caught npm normalizing a CRLF executable shebang
after installation, invalidating that file's source hash. A Git attribute now
keeps this executable in LF form even when Windows checkout converts other text
files to CRLF. A fresh `core.autocrlf=true` checkout then passed all five native
tests on Windows with Node 24.15.0, including all 93 installed source hashes.
The native test checks its shebang and every installed source hash.

The check used `packaging/test/windows-preview.test.mjs` with a new owned
temporary directory, an installation path containing spaces and `&`, and empty
model credentials. It installed pinned public dependencies without install
scripts, verified all 93 copied source hashes and the archive hash, confirmed
that setup did not open a database, and refused an existing target without
overwriting its receipt. The installed configuration check reported no database
opening, model key or provider contact.

The actual MCP SDK-to-installed-process walkthrough passed all six stages:
tool discovery, remember with source inspection, process restart with receipt
persistence, correction with stale-revision rejection, model-disabled recall,
and forgetting with empty active inspection. There were zero model requests.

A separate native PowerShell check also followed the documented
`npm.cmd run install:preview` command, loaded `installation-receipt.json` with
`Get-Content` / `ConvertFrom-Json`, and passed the same six-stage walkthrough
using the receipt's executable path. It used a new absolute temporary target
instead of the guide's persistent `LOCALAPPDATA` target.

The four command/archive regression tests also passed natively: literal npm
arguments, bundled npm entry-point selection, unchanged non-npm commands, and
CRLF archive inspection that still rejects an unexpected file. Tests own their
scratch and remove it after their child processes exit. Private raw logs and
local installation paths are retained outside this repository.

## Reproduction and limits

After installing the locked SDK dependency set, run on native Windows:

```powershell
npm.cmd ci --prefix adapters/mcp --ignore-scripts
node --test packaging/test/build-command.test.mjs packaging/test/windows-preview.test.mjs
```

The focused check may download public dependencies, but needs no model key and
makes no model calls. CI adds the same check on `windows-latest` with Node 22.16
and 24. The ordinary POSIX process-group test runner remains unsupported on
Windows; this check uses direct `node --test` with its own workspace cleanup.

This is one agent-operated native environment, not a human onboarding result,
all-Windows certification, Windows ACL audit, chat-client compatibility check,
real-model recall measurement or long-term reliability result. The reader's
reported installation after manual changes is separate feedback; their exact
Windows/Node versions and exercised operations were not provided.
