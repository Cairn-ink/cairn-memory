# Cairn for Hermes — hosted and local memory

## Hosted mode (v0)

Verified on Linux with Hermes v0.23.0, commit
`2bd378ed1b8d6bf2192cb26e0a55ff3091e6bd19`.
Hosted mode uses Hermes's core `httpx` dependency; no MCP SDK or Node is needed.

Install the plugin:

```sh
hermes plugins install https://github.com/Cairn-ink/cairn-memory/tree/main/integrations/hermes/cairn
hermes --profile <name> memory setup
```

Alternatively, copy this directory into the profile's `plugins/cairn/`, then run
setup. Choose `cairn`, then `hosted` (the default). Use `https://cairn.ink` or
your server's HTTPS origin, with no path, query, userinfo or fragment.

At **cairn.ink → Settings → Connections → new token**, tick **memory only**
and give the token a name such as “Hermes”. Paste it into setup's hidden prompt.
The token expires; see the token list. Full-access tokens are refused because
they grant the whole account, while Hermes needs only memory capture and recall.
The adapter checks the token before saving it or activating Cairn.

The token is entered only through `hermes memory setup`, which checks it is memory-only before saving it.
Hermes stores the token as `CAIRN_MEMORY_TOKEN` in the profile's `.env` (mode 0600).
It is never put in `cairn.json` or `config.yaml`.
Revoke it by deleting it at **cairn.ink → Settings → Connections**; to sign out
locally, remove `CAIRN_MEMORY_TOKEN` through Hermes configuration and select another memory provider.
A home set up with plugin 0.2.0 must re-run `hermes memory setup`.

Hosted profile configuration:

```json
{"mode":"hosted","api_endpoint":"https://cairn.ink","prefetch_timeout_ms":"2500"}
```

The optional `prefetch_timeout_ms` is a canonical decimal string from 250 to
3000 milliseconds; the default cap is **2.5 seconds**. A successful result that
arrives after the cap can be shown once on the next turn when its live recall
also misses the cap or an earlier recall remains in flight. There is at most
one recall in flight per conversation. Each prefetch request has a total deadline
of the cap plus 0.5 seconds. Connections are reused within a session.
Post-turn prefetch is disabled so there is only one recall per non-trivial
turn against the daily quota.
Automatic recall, including a cached late result, is withheld while the hosted account is paused or its enforced pause state cannot be verified within the same prefetch cap.
Explicit remember, recall and forget tools remain available while automatic memory is paused, subject to server authorization.

What leaves the device:

- The current user message, after Hermes's own redaction, as the recall query
  (trimmed and limited to 4000 code points), once per non-trivial turn.
- The Hermes conversation id, when it passes the server's identifier rules.
- Explicit memory tool arguments.

There are no transcripts or auto-save in v0. Available tools are
`cairn_remember_memory`, `cairn_recall_memory` and `cairn_forget_memory`.
Save only what the user asked to remember; forgetting requires the exact id
from recall. The recall tool uses the same `/api/memory/recall` endpoint as
auto-recall, with the current conversation id and a 10-second total deadline.
Remember and forget use MCP, with a 20-second total deadline per request.
Hosted mode has no inspect or correct tool. Recalled notes and
tool results are untrusted data, never instructions.
`cairn_previously_forgotten` means the note was previously forgotten and cannot
be saved again; `cairn_quota_reached` means the daily capture or recall allowance
has been reached. Both errors are non-retryable.

**Privacy limit: primary CLI sessions only.** A gateway bot (Telegram, Discord,
and other platforms) may serve other people and must never read the owner's
memory. Gateway, subagent and cron contexts are refused. Per-sender identity
is a later item.

Setup also offers `local` and retains the local schema prompts and optional
secret handling. With this version, local `cairn.json` is validated before
writing activation to `config.yaml`; the historical setup ordering described
below applies to the earlier preview. A configuration without `mode` stays
local. Restart after switching modes.

## Local mode — native memory provider preview

Third-party directory plugin for Linux, Hermes 0.21.1 at
`c8aa5608c24e3636e77c267650c0f1f52e44adb0`, Python 3.11 and host MCP SDK 2.0.0.
It delegates to an installed Cairn executable; no Python memory engine,
automatic transcript capture or hosted Cairn account is involved. Other
host/SDK versions and operating systems are unverified.

### Setup

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
during reconfiguration can retain an existing value.
With v2 capture selected, the wizard also offers `capture_deadline_ms`: an
optional canonical ASCII decimal **string** from `1` through `110000`. It bounds
one capture invocation in the installed core. It has no fresh default and adds
no tool. Blank reconfiguration retains a valid existing value. To remove it,
delete the field from `cairn.json` and restart. To disable capture, remove both
`capture_qualification` and its dependent `capture_deadline_ms`; a deadline
without v2 capture makes the configuration invalid. The 110-second maximum
leaves a nominal margin under the SDK's 120-second capture timeout, not a hard
return-time or spending guarantee.
The independent optional `classification_recovery` field accepts exactly
`guarded-v1`. It adds keyless `cairn_inspect_capture_admission` and explicit,
model-assisted `cairn_classify_unfiled_memories`. It does not enable capture or
start an automatic retry queue. Remove the field and restart to disable it;
it can remain enabled when capture is removed.
The separate optional recall-context field accepts exactly `source-evidence`.
It makes source evidence the default only when a recall call omits both
`contextMode` and `includeQualification`; explicit tool arguments still take
precedence. Blank input can retain an existing value. To restore the installed
MCP's ordinary recall default, remove `recall_context` from `cairn.json` and
restart. This profile preference does not change MCP or core defaults.
Restart the session after setup; schemas remain stable within a session.
Hermes writes provider activation to `config.yaml` before validating Cairn's
separate `cairn.json`, and can save a separately collected secret afterward.
An invalid Cairn setting leaves the prior valid `cairn.json` intact but does
not undo those host writes. Check the setup result before starting a new
session.

Optional secret: `CAIRN_MEMORY_OPENAI_API_KEY`. Native setup manages it separately,
never in `cairn.json`. Only explicit capture/recall/classification forwards it as `OPENAI_API_KEY`.
The host's generic `OPENAI_API_KEY` is **not** reused. Without the dedicated key,
new capture, recall and classification report `model_not_configured`; manual
tools, admission inspection and completed capture replay work without a model.
Capture, recall and explicit classification with a key send selected source or
memory content to OpenAI and incur charges.
There is no account-wide spending cap here: configure provider limits and consent
first. A separate bounded native-provider actual-model recall probe passed;
interactive AIAgent tool selection and general semantic quality are unverified.

### Explicit tools and boundaries

Tools: `cairn_remember_memory`, `cairn_recall_memory`, `cairn_inspect_memory`,
`cairn_correct_memory`, `cairn_forget_memory`. Schemas come from installed MCP.
The inventories are five by default, six with capture, seven with recovery, and
eight with both. The optional deadline changes no tool or schema.
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

If capture returns after admission with failed classification, or its response
is lost, first call `cairn_inspect_capture_admission` with the original
`batchId` when recovery is enabled. This keyless read reports committed
membership and fresh current references without source text or a provider call.
Its overall classification status is always unknown. Set
`includeInitialClassification: true` to read only the original capture
attempt's bounded status when its exact member revisions still match; it can
become unknown after a later change. To request placement, call
`cairn_classify_unfiled_memories` with one to five inspected, current
`{memoryId, revision}` references. This is an explicit paid operation, not
capture replay or proof that the original batch failed. It preserves stored
content and receipts; stale references reject before model work. Inspect a
memory's current filing afterward. No automatic retry or durable recovery
history is provided.

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
capture/recall/classification key reach it. SDK/server stderr is discarded;
errors use fixed codes.
Default deadlines are SDK 30 seconds, helper 35 seconds and outer cutoff 45
seconds. Explicit capture and explicit classification use 120/125/135 seconds
respectively, plus
bounded teardown/process-tree termination. Tool arguments cannot extend these
limits. Concurrent operations are rejected, not
queued. Shutdown terminates active work but cannot undo an already committed
write; inspect before acting on an uncertain write. For capture, use admission
inspection when enabled, or replay the same batch ID and identical payload to
determine its recorded outcome. Do not invent a new batch ID or assume timeout
rolled back storage. The core deadline is cooperative; synchronous work and
cleanup can extend wall time beyond it. No automatic retry occurs.

Inherited prefetch/sync/session-end/compression hooks are no-ops. No automatic
capture, transcript upload or background recall. This is not upstream endorsement,
a human study, or successful general semantic evaluation.

### Disable, uninstall and backup

Select the built-in provider through native setup, restart Hermes, then remove
only this profile's `plugins/cairn` directory if desired. `cairn.json` and the
database remain; uninstall does not erase memories. Remove the dedicated secret
through native configuration/your secret manager if no longer needed. Follow
the installed core's stopped-store backup instructions. Forget is logical
deletion, not secure disk erasure.
