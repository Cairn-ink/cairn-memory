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
The independent experimental `source_candidate_policy` field accepts exactly
`bounded-keyset-v1`. The wizard saves it in this profile's `cairn.json`; the
bridge validates it again and passes the fixed installed CLI flag on both
schema discovery and tool calls. It is not a tool argument and does not grant
another owner or namespace. Only source-evidence/rationale-evidence recall uses
the larger local candidate examination: at most 20,000 current physical rows
in 256-row pages, first four receipts per eligible memory, and top 1,024 by
literal overlap. Unicode runs (including contiguous CJK text) are not semantic
word segmentation. The existing visible 120-code-point label, two selector
pages, model budgets, final source bounds, provider cost and retention limits
remain. Body/default recall and five-tool inventory stay unchanged when this
sole option is set. Blank reconfiguration may retain it; remove the field and
restart to disable it. This is not an accuracy, latency or default-promotion
claim.
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

## Explicit tools and boundaries

Tools: `cairn_remember_memory`, `cairn_recall_memory`, `cairn_inspect_memory`,
`cairn_correct_memory`, `cairn_forget_memory`. Schemas come from installed MCP.
The inventories are five by default, six with capture, seven with recovery, and
eight with both. The optional deadline changes no tool or schema.
The source-candidate policy also changes no tool or schema.
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

## Disable, uninstall and backup

Select the built-in provider through native setup, restart Hermes, then remove
only this profile's `plugins/cairn` directory if desired. `cairn.json` and the
database remain; uninstall does not erase memories. Remove the dedicated secret
through native configuration/your secret manager if no longer needed. Follow
the installed core's stopped-store backup instructions. Forget is logical
deletion, not secure disk erasure.
