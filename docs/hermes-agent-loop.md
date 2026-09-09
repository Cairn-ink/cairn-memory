# Hermes agent-loop test boundary

This verification uses Hermes0.21.1 source revision
`c8aa5608c24e3636e77c267650c0f1f52e44adb0`, not an arbitrary current release.
It targets two distinct integration routes:

- Native `memory.provider: cairn`: plugin discovery and MemoryManager dispatch.
- General MCP client: Hermes discovers the installed Cairn stdio tools.

In both cases the intended boundary under test is the actual AIAgent conversation
loop, tool schema delivery, tool execution, installed MCP process and SQLite
persistence. Scripted completion responses choose tool names and arguments.
The final scripted answer alone is not evidence: assertions must inspect the
actual tool-result messages, memory IDs, revisions and Source Receipts.

## Run and observed coverage

Prepare the pinned host and dependencies as in
[native provider verification](hermes-memory-provider.md), then run from that
host checkout:

```sh
scripts/run_tests.sh /absolute/cairn/integrations/hermes/test/test_agent_conversation.py -- \
  --cairn-executable /absolute/install/app/node_modules/.bin/cairn-memory \
  --cairn-node /absolute/node -q -p no:cacheprovider --tb=short
```

Both parameterized routes passed on Linux x64 with Node22.16.0 and24.20.0,
Python3.11.12, host MCP SDK2.0.0. The installed archive SHA256 is
`4db3754fcf44caba56de73fceee67de795c742c18b972008351ce7abef086f0d`.
The tests require the separately prepared upstream checkout, so they are an
explicit opt-in integration gate, not part of the ordinary public repo CI.

SessionA saves and inspects content with its receipt. A fresh AIAgent SessionB
reads the exact same ID/content/receipt, observes no-key recall failure, corrects
content and current receipt, rejects a stale forget, then forgets and verifies
both `memory_not_found` and an empty list. Every completion request receives
only the five Cairn schemas. MCP mode also checks Hermes's real untrusted-result
wrapper and success/error envelope. MemoryManager and host dispatch are not
stubbed, and final scripted answer text is not used as a success assertion.

Test profiles/environment are isolated before host imports. Completion transport
is mocked; background review, compression and tool-search indirection are
disabled. Python IP socket connections are blocked; this is **not** an OS network
sandbox for child processes. No credentials reach the memory process and
no-key recall is asserted explicitly. No model calls are made.

## What this cannot establish

These tests do not establish that a real model will decide to remember or recall
at the right time, retrieve semantically useful memories, or answer correctly.
They are not a human study or a Claude/Codex/ChatGPT compatibility claim. They do
not install automatic transcript capture or imply official Hermes endorsement.

The previously recorded real-model native MemoryManager recall probe remains
separate evidence. Combining a scripted agent loop with that older probe does
not constitute a real-model end-to-end conversation test.

## Paid follow-up gate

A later opt-in test needs one combined spending guard covering agent completion
requests and Cairn recall requests, including failed calls and count preflights.
It must use a fresh profile and synthetic content, assert actual sourced recall,
correction and forgetting across sessions, and retain failed attempts. No such
paid run is authorized or performed by this test package.

Historical evidence files retain the budget balance at their execution time.
The campaign balance entering this package is US$4.179912 reserved of US$5,
leaving US$0.820088; no new provider requests are part of this package.
