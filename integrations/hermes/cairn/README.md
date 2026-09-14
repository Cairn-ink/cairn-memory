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
`memory.provider: cairn` and saves those paths in profile `cairn.json`.
The optional capture-mode field accepts exactly `source-bound-v2`. Omit it on a
fresh setup for the existing five tools; type that value to enable explicitly
submitted source capture. It is saved separately from credentials. Blank input
during reconfiguration can retain an existing value; to disable capture, remove
the optional `capture_qualification` field from profile `cairn.json` and restart.
The separate optional recall-context field accepts exactly `source-evidence`.
It makes source evidence the default only when a recall call omits both
`contextMode` and `includeQualification`; explicit tool arguments still take
precedence. Blank input can retain an existing value. To restore the installed
MCP's ordinary recall default, remove `recall_context` from `cairn.json` and
restart. This profile preference does not change MCP or core defaults.
Restart the session after setup; schemas remain stable within a session.

Optional secret: `CAIRN_MEMORY_OPENAI_API_KEY`. Native setup manages it separately,
never in `cairn.json`. Only explicit capture/recall forwards it as `OPENAI_API_KEY`.
The host's generic `OPENAI_API_KEY` is **not** reused. Without the dedicated key,
new capture and recall report `model_not_configured`; manual tools and completed
capture replay work without a model. Capture/recall with a key send selected
source evidence to OpenAI and incur charges.
There is no account-wide spending cap here: configure provider limits and consent
first. A separate bounded native-provider actual-model recall probe passed;
interactive AIAgent tool selection and general semantic quality are unverified.

## Explicit tools and boundaries

Tools: `cairn_remember_memory`, `cairn_recall_memory`, `cairn_inspect_memory`,
`cairn_correct_memory`, `cairn_forget_memory`. Schemas come from installed MCP.
Ask explicitly to save, inspect ID/revision, then correct or forget at that
revision. Stale revisions fail. Content and receipts are untrusted data, not
instructions; a receipt is not proof of model-generated entailment.

With the explicit v2 setting, the installed MCP schema also supplies
`cairn_capture_memory`. Submit only messages intended for storage, for example:

```json
{"batchId":"synthetic-friday-note","messages":[{"role":"user","content":"I am considering taking the train on Fridays."}]}
```

Then call `cairn_recall_memory` with
`{"query":"What did I say about Friday travel?","contextMode":"source-evidence"}`
to use retained passages rather than generated summaries in ranking and returned
context. This mode is per call; the configured host otherwise defaults to
qualified recall unless its profile has the optional `recall_context` preference
described above. That preference only supplies a missing tool argument; an
explicit context mode or `includeQualification` value is preserved. Use
`cairn_inspect_memory` with the returned memory ID and
`includeQualification: true` to inspect the stored interpretation and evidence.
See [source-only context boundaries](../../../docs/source-evidence-context.md).

V2 retains canonical prefixes of at most 800 UTF-16 units per message and
reports omitted tails through `retainedSourceWindow`. Submitted roles are not
authenticated identities. Qualification may still misread uncertainty or
adoption; source linkage does not prove truth. This submits a supplied batch,
not the surrounding transcript, and never grants execution authority.

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
capture/recall key reach it. SDK/server stderr is discarded; errors use fixed codes.
Default deadlines are SDK 30 seconds, helper 35 seconds and outer cutoff 45
seconds. Explicit capture alone uses 120/125/135 seconds respectively, plus
bounded teardown/process-tree termination. Tool arguments cannot extend these
limits. Concurrent operations are rejected, not
queued. Shutdown terminates active work but cannot undo an already committed
write; inspect before retrying an uncertain write. For capture, replay the same
batch ID and identical payload to determine its recorded outcome; do not invent
a new batch ID or assume timeout rolled back storage. No automatic retry occurs.

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
