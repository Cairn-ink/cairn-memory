# Hermes native memory provider preview

Dependency base: `4f46be2f4401249e78f040481134859740176680`, the local
install-artifact branch. This is third-party integration, not a Hermes core PR,
registry release or deployment. The public core remains the only engine.

## Acceptance H01–H08

- H01: A directory provider named `cairn` is discoverable through the real Hermes
  user-plugin discovery path and selectable as `memory.provider: cairn`. Implement
  the documented MemoryProvider registration, configuration and lifecycle APIs.
  No Hermes core changes or deprecated internal imports. Verify against Hermes
  0.21.1 source revision `c8aa5608c24e3636e77c267650c0f1f52e44adb0`.
- H02: Delegate the five existing tools through the actual installed Cairn MCP
  executable. Do not duplicate schemas, storage, extraction or recall logic in
  Python. Prefix tool names for host dispatch if needed, preserving strict input
  validation, receipt semantics, revisions and untrusted-evidence output.
- H03: Setup accepts explicit absolute executable/runtime paths, no arbitrary
  shell command. Availability checks perform no network or subprocess invocation.
  Invalid/missing installation fails clearly without fallback or auto-download.
  Do not save a model credential in plugin configuration or inherit arbitrary
  environment variables into the subprocess. Optional recall credential must be
  explicitly documented; model-free tools work without it.
- H04: All configuration/state belongs to the initialized Hermes profile. Stable
  profile identity and database path survive sessions/restarts, while two fresh
  profiles cannot read or mutate each other's memories. The first preview is
  local single-user CLI only: reject gateway/platform or non-primary agent
  contexts rather than sharing profile memory across unrelated users. Tool
  arguments cannot override owner, database, executable or profile.
- H05: A bounded subprocess lifecycle cleans up on success, timeout, malformed
  result and shutdown. Sanitize operational errors; never log keys, memory text
  or raw provider responses. No detached background ingestion or unbounded queue.
- H06: Through real Hermes discovery and MemoryManager dispatch, test remember,
  inspect, new session/reload, correction, stale-revision rejection, forget and
  profile isolation against an installed archive. A no-key recall must return
  model_not_configured, not lexical results. Include negative transport/config
  tests. This is host/tool lifecycle evidence, not a real-model chat evaluation.
- H07: No automatic transcript capture/prefetch/session-end upload in this slice.
  Inherited hooks remain no-ops, and tests show they do not create memories or
  requests. Explain explicit use, setup, disable/uninstall and preserved database.
  Keep actual host evidence distinct from full chat/model quality or upstream
  catalog endorsement. Semantic evaluation remains a separate release gate.
- H08: Record Python/Node/host versions and reproducible offline host-test command.
  Existing repository gates remain green; independent Standards and Spec reviews
  inspect the same final candidate before a dependent PR. No paid calls by workers,
  publication, user-profile modification, merge or deployment.

## Verification boundary

Use fresh synthetic temporary profiles and the already inspected local npm
archive. Host integration tests must use the actual pinned Hermes source and MCP
SDK, not a stub class standing in for MemoryProvider or MemoryManager. Runtime
availability on other host revisions and interactive chat remain unclaimed.

## Implementation and verification

`integrations/hermes/cairn` is a third-party directory plugin. Actual installed
MCP supplies all five schemas and engine operations. Hermes registers routing
before initialization; therefore schema-only discovery uses a disposable OS-temp
store and synthetic owner without a key. The real profile database cannot open
until explicit CLI/primary initialization. No Hermes source files were edited.

Each call uses an isolated helper and the host SDK; environment is fixed LANG/
PATH plus a dedicated optional key only for recall. SDK diagnostics are discarded,
operational errors are sanitized, and SDK child processes are terminated/reaped
on bounded timeout/shutdown. No hooks ingest or prefetch. Linux is the only
supported preview platform. A persisted random owner UUID moves with a complete
profile; missing/corrupt identity beside an existing database fails closed.

Five real-host tests passed against the installed archive on Node22.16.0 and
24.20.0, using Python3.11.12, MCP2.0.0, psutil7.2.2 and Hermes revision above.
See [reproduction and artifact identity](../hermes-memory-provider.md). Tests
exercise discovery/MemoryManager, source receipts and revision lifecycle,
reloaded sessions/profile isolation, negative configuration/context/transport,
no-key recall, synthetic dedicated-key allowlist and active-child shutdown.
The canary credential is removed before process launch; no paid call occurred.
31 existing plugin tests, JSON/version and marketplace/strict plugin gates pass.
Host-configured Ruff and local documentation link/diff checks also pass.
Independent fixed-candidate Standards/Spec review remains required. Full chat,
paid Hermes recall, publication and general semantic quality are not claimed.
