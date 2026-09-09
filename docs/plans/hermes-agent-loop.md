# Hermes actual agent-loop verification

Dependency base: `06c3169f9381a8e107f11dedc71985d29a45e6ff` (preview installer).

## Acceptance

1. Run the actual pinned Hermes0.21.1 AIAgent conversation loop against the
   installed Cairn artifact. Test native memory-provider and general MCP-client
   modes separately, keeping plugin discovery, schemas, tool dispatch, stdio
   transport and SQLite real. Model completions may be scripted, never claim
   real-model tool selection or semantic recall from these tests.
2. SessionA explicitly remembers and inspects a synthetic memory/receipt;
   a fresh agent SessionB inspects the same ID/content and receipt, corrects it,
   rejects stale revision, forgets it, and verifies absence. Assert the actual
   conversation tool results, not only the scripted final answer. No-key recall
   must produce model_not_configured. Both modes expose only Cairn tools.
3. Fresh temporary profiles/config only. Deny unintended network, strip
   credentials and do not use real accounts. No provider calls, automatic
   capture, client-global settings, production access or runtime engine changes.
4. Use host canonical test runner and the existing installed-artifact arguments;
   test both Node22.16 and24. Record exact host revision, archive hash, commands
   and which parts are mocked. New host tests remain explicitly opt-in because
   the upstream host/dependencies are not installed by ordinary repository CI.
5. Document coverage without asserting Claude/Codex/ChatGPT compatibility,
   upstream endorsement, human outcomes or autonomous real-model decisions.
   Keep paid full-chat/semantic gate explicitly unverified. Update changelog.

## Scope limit

If the pinned host cannot safely exercise either mode without rewriting its
internals, document the specific observed failure rather than bypassing the
dispatch under test. No public runtime contract change is authorized here.

## Evidence

- Worker new agent-loop suite2/2 on Node22.16.0,24.20.0 (additional24.15.0 run
  passed). DRI independently reran new suite plus original provider suite using
  the canonical host runner:7/7 on22.16.0 and7/7 on24.20.0.
- Exact command and environment boundary: `docs/hermes-agent-loop.md`; archive
  hash4db3754fcf44caba56de73fceee67de795c742c18b972008351ce7abef086f0d.
- Initial MCP assertions exposed the host's real untrusted text wrapper and
  distinct result/error JSON envelopes. Tests now assert those actual boundaries
  instead of bypassing the host. No runtime code was changed to obtain green.
- Plugin suite31/31, JSON/version and pinned marketplace/strict plugin validation
  passed. Main reused the already installed pinned2.1.260 maintainer validator
  from the parent worktree; no account-backed chat client was launched.
- Opt-in host integration tests are not automatically installed/run by public
  CI. Existing core, adapters, provider runtime and artifact bytes unchanged.
  No new paid requests; cumulative conservative reservation remains4.179912/5USD.
