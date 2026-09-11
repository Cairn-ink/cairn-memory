# Installed capture to fresh MCP lifecycle

Base: `920e07cd717520d5f5da308a4372d537985cb76b`. This is an experiment
harness, not a new public capture tool or automatic Hermes transcript integration.
GPT-5.4 mini reasoning-none passed the retained small source-faithfulness suite;
it is the explicit candidate here. Defaults and production remain unchanged.

## Frozen acceptance before implementation and paid calls

- I1: Import capture core and OpenAI adapter from an inspected, offline-installed
  local artifact, not workspace runtime files. Record archive SHA and verify
  installed runtime hashes against that artifact before using it. Use only a
  fresh synthetic database, owner and project.
- I2: Capture a user message `Harbor team review happens on Friday.` through the
  actual programmatic capture API with explicit `gpt-5.4-mini-2026-03-17` extraction.
  Retain every admitted claim and original source receipt for independent source
  review; empty capture, unsupported claims or lost required fact fail. Original
  receipts need not equal paraphrased memory text. Close the producer core.
- I3: Start a fresh actual stdio MCP client/server process for each stage: recall
  the Friday fact with original provenance; rediscover and correct it to Monday;
  recall Monday without an active Friday assertion; rediscover and forget it;
  finally recall a successfully completed empty result and confirm the forgotten
  target cannot be inspected. Mutations derive ID/current revision from consumer
  recall/inspect, never from the producer's ID as an oracle. Require actual
  `forgotten:true`, not successful no-op. Failed/incomplete recall is not absence.
- I4: Preserve namespace isolation and stale-revision protection. Scripted
  negative controls must reject empty capture, unsupported/unbound receipts,
  unchanged correction, no-op forgetting and incomplete empty recall. Semantic
  judgments remain explicitly agent-reviewed, not human or deterministic proof.
- I5: Real provider key stays only in the primary private operator. Existing
  authenticated loopback proxy and experiment launcher give children only a
  random capability. All count/generation calls use the original USD20 shared
  ledger and reviewed extension. No retries/refills/new authorization. This
  stage cap is USD0.50 reserved and 100 requests within its remaining balance;
  write immutable intent before requests and retain failure/accounting results.
- I6: Add model-free tests, run them and generic validation on Node22.16 and24;
  run existing live-evidence-offline suite and pinned Claude validation. Freeze
  code, independently review Standards and Spec, then run one scoped real
  installed experiment only after both pass. Publish sanitized evidence and
  independently review final commit before push. No merge/release/deployment.

Evidence scope is installed programmatic capture plus real MCP transport and
provider lifecycle. It is not autonomous host tool choice, a public capture CLI,
Hermes auto-capture, large-history reliability, a benchmark against competitors,
or permission to promote a model default.
