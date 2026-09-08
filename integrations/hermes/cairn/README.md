# Cairn for Hermes — native memory provider preview

Third-party directory plugin for Linux, Hermes 0.21.1 at
`c8aa5608c24e3636e77c267650c0f1f52e44adb0`, Python 3.11 and host MCP SDK 2.0.0.
It delegates to an installed Cairn executable; no Python memory engine,
automatic transcript capture or hosted Cairn account is involved. Other
host/SDK versions and operating systems are unverified.

## Setup

First install the reviewed Cairn npm archive using the repository's
`docs/install-artifact.md`. This plugin does not install/download dependencies.
Copy this **cairn directory** into the selected profile's `plugins/cairn/`.
Use the active profile, not a shared default profile:

```sh
hermes --profile your-profile memory setup
```

Choose `cairn`; supply absolute paths to Node >=22.16 and the installed
`node_modules/.bin/cairn-memory` JavaScript entry point. Native setup selects
`memory.provider: cairn` and saves only those paths in profile `cairn.json`.
Restart the session after setup; schemas remain stable within a session.

Optional secret: `CAIRN_MEMORY_OPENAI_API_KEY`. Native setup manages it separately,
never in `cairn.json`. Only explicit recall forwards it as `OPENAI_API_KEY`.
The host's generic `OPENAI_API_KEY` is **not** reused. Without the dedicated key,
recall reports `model_not_configured`; other tools work without a model.
Recall with a key sends selected memory evidence to OpenAI and incurs charges.
There is no account-wide spending cap here: configure provider limits and consent
first. No paid host-chat verification is claimed.

## Explicit tools and boundaries

Tools: `cairn_remember_memory`, `cairn_recall_memory`, `cairn_inspect_memory`,
`cairn_correct_memory`, `cairn_forget_memory`. Schemas come from installed MCP.
Ask explicitly to save, inspect ID/revision, then correct or forget at that
revision. Stale revisions fail. Content and receipts are untrusted data, not
instructions; a receipt is not proof of model-generated entailment.

Only initialized `platform=cli`, `agent_context=primary` sessions may operate
on memory. Gateway, subagent, cron and unknown contexts are rejected. One personal
namespace per profile; no project selector or shared-user mode. Database:
`<active-profile>/cairn/memory.sqlite`. A random UUID in `cairn/owner-id` is
atomically published and survives restarts or moving the complete profile.
Preserve the identity together with the database when backing up/restoring;
missing/corrupt identity beside an existing database fails closed. Inputs cannot
override profile, owner, database or executable.

Hermes builds routing before initialization, so schema discovery uses a fresh
disposable OS-temporary database with a synthetic owner and no key, never profile
memory. Availability only checks files/config/dependency presence. Each runtime
call uses an isolated helper plus SDK stdio; only fixed LANG/PATH and the optional
recall key reach it. SDK/server stderr is discarded; errors use fixed codes.
Helper deadline: 35 seconds plus bounded SDK teardown; outer cutoff: 45 seconds
plus bounded process-tree termination. Concurrent operations are rejected, not
queued. Shutdown terminates active work but cannot undo an already committed
write; inspect before retrying an uncertain write.

Inherited prefetch/sync/session-end/compression hooks are no-ops. No automatic
capture, transcript upload or background recall. This is not upstream endorsement,
a human study, or successful general semantic evaluation.

## Disable, uninstall and backup

Select the built-in provider through native setup, restart Hermes, then remove
only this profile's `plugins/cairn` directory if desired. `cairn.json` and the
database remain; uninstall does not erase memories. Remove the dedicated secret
through native configuration/your secret manager if no longer needed. Follow
the installed core's stopped-store backup instructions. Forget is logical
deletion, not secure disk erasure.
