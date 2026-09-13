# Hermes explicit source-qualified capture (S9)

Dependent on verified S8; same installed JavaScript engine, no Python memory engine.

- H1: Optional native config capture_qualification accepts exactly source-bound-v2. Absence retains old paths-only config/five tools. Null, bool, other strings and unknown fields reject. Native setup blank optional input must remain omitted; key remains separate. No automatic opt-in.
- H2: Discovery and dispatch share configured five/six tool allowlist; schemas come from actual installed MCP. Discovery is keyless and uses disposable synthetic DB, not profile DB. Session configuration remains bound; no mode/identity/timeout authority in tool arguments.
- H3: Bridge forwards fixed capture mode. Only explicit capture/recall can receive dedicated CAIRN_MEMORY_OPENAI_API_KEY; never generic key, diagnostics, config JSON or other operations. Existing context/profile identity checks and inert hooks unchanged.
- H4: Fixed capture-only deadlines SDK120s/helper125s/outer135s; old operations remain30/35/45. No user-selected deadlines/retry. Timeout/shutdown terminate active helper and SDK tree; uncertain writes require inspection and same-payload batch replay, not new batch or assumed rollback. Test reduced deadlines without actual waits. Do not claim protection from arbitrary OS SIGKILL without proving it.
- H5: Actual pinned Hermes0.21.1 c8aa5608c24e3636e77c267650c0f1f52e44adb0 canonical runner against actual installed artifact on Node22.16/24.15. Verify setup/config, native MemoryManager6tools explicit capture, source-only recall, inspection, cold duplicate zeroHTTP with fake provider only. Existing provider/agent-loop tests remain green; a scripted AIAgent explicit capture dispatch is wiring evidence, not natural tool selection accuracy.
- H6: Docs show opt-in, costs/source window, submitted roles unverified, per-call source-evidence, no passive capture/upstream endorsement/general quality guarantee. Root gates plus independent Standards/Spec exacthead before next step. No real credentials, provider calls, package publication, feature merge or deployment.

Fixed base: `d9589389c90e2b52baae1641dc2694d097125b18`.

## Root verification

Both Node 22.16.0 and 24.15.0 passed generic tests (31), JSON validation,
strict plugin validation, MCP tests (53) and artifact tests (54).
The canonical pinned Hermes runner passed existing provider (5), existing
agent-loop (2), new qualified provider (7) and new qualified conversation (1)
tests on both Node versions. Root reran all four files; independent authors
also ran both new files on both runtimes. No TypeScript gate exists here.

Canonical command, from the pinned Hermes checkout:

```sh
scripts/run_tests.sh /absolute/cairn/integrations/hermes/test/test_provider.py /absolute/cairn/integrations/hermes/test/test_agent_conversation.py /absolute/cairn/integrations/hermes/test/test_qualified_provider.py /absolute/cairn/integrations/hermes/test/test_qualified_conversation.py -- --cairn-executable /absolute/installed/bin/cairn-memory.mjs --cairn-node /absolute/node -q -p no:cacheprovider
```

Installed archive SHA-256:
`aa46bb1f4792dc7de514dee397708d6406066685b0668d2808b5e13a1007b2f5`.
Real host discovery, dispatch, MCP and SQLite ran against temporary synthetic
profiles. Test-only Node preload supplies 16 fake provider request responses;
cold inspection and replay use zero. No actual provider network or credential.
Deadline parameter spies verify each inner/outer policy branch; actual hanging
SDK children verify reduced capture timeout and shutdown without auto-retry.
The source archive's optional bytecode precompile reports missing `.git`; the
canonical runner executes the tests and exits zero, not a skipped gate.
