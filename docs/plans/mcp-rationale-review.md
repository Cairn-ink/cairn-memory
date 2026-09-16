# Explicit rationale correction through local MCP

Dependent base: `eb49aed388460925540fdb3e24e3fe599ec8fcd4`, embedded bounded
replacement. Branch: `feat/mcp-rationale-review`. Public-main aggregate base is
`3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9`. This is the next delivery step, not
a second engine or automatic capture policy. Do not merge, publish or deploy.

## Acceptance

- MR1: Server option `rationaleReview: 'replace-reviewed-v1'` and CLI flag
  `--rationale-review replace-reviewed-v1` explicitly enable a new
  `review_rationale` tool. It is independent of capture/qualification flags:
  enabling correction must not enable capture or retain new source payloads.
  Missing option preserves all prior tool sets. Wrong, empty, duplicate CLI
  values and explicit invalid server values fail before DB/provider access.
  Own-option checks prevent inherited properties from enabling the capability.
- MR2: The tool accepts ONLY `{refs:[{memoryId,revision}]}`, 1–6 distinct refs,
  with strict nested/outer schemas, bounded IDs and safe positive revisions.
  It binds the frozen startup namespace, invokes the SAME
  `core.reviewRationale` with fixed `writeMode: 'replace-reviewed'` and default
  source-only input, and returns the ordinary untrusted MCP envelope/counters.
  Caller cannot choose namespace, mode, provider, prompt, relation verdict or
  raw source. An invalid/foreign/stale ref causes no re-review provider work.
- MR3: Opt-in also exposes existing keyless `inspect_rationale`, once only if
  automatic capture rationale is already enabled. Review is annotated writable,
  destructive and open-world; inspection remains read-only. Descriptions require
  explicit user intent and warn that replacement can withdraw correct proposals,
  empty output removes only in-scope links, sources remain unchanged, and
  `unassessed` is not confirmation or execution permission. No automatic re-review,
  retry, semantic approval, new spending grant or new provider method.
- MR4: Keyless startup and syntax checks remain supported. Keyless inspection
  works; attempting review without `relate` returns model_not_configured without
  changing edges. `--check-config` opens no DB and contacts no provider, reporting
  configured-not-verified/model_not_configured honestly. Help/docs explain source
  disclosure to the configured model, per-call cost and lack of a host spend cap.
- MR5: Actual SDK stdio tests exercise opt-in/default/combined discovery and tool
  annotations; malformed/extra/duplicate/foreign/stale inputs, missing model and
  failed model; source-only payload; successful correction and empty/no-op
  replacement; original source/qualifier/MOC and crossing evidence preservation
  where relevant. Cold restart must observe updated persisted links, not writer
  closures. No natural semantic-quality or natural tool-selection claim.
- MR6: Add installed-artifact regression using the existing isolated package
  build/install and network-blocking synthetic fetch preload: real installed CLI, OpenAI adapter,
  shared core and stdio. Seed a proposed support+challenge through existing
  submitted capture, retain full source evidence, re-review with scripted
  support-only output, observe removed=1/inserted=0 and unassessed inspection,
  then restart keyless and inspect the same result with zero additional HTTP.
  Capture remains append-only and unchanged. Assert exact fake count/generate
  calls; no real key, user DB, network model service or paid request. Exercise
  the installed CLI parser itself; do not widen the live experiment launcher.
- MR7: Update standalone/API/privacy/changelog docs to distinguish this host
  opt-in from unchanged default/capture/hosted behavior. No manifest version
  bump or release claim. Root runs generic, JSON, strict plugin, full MCP and
  relevant/full core plus installed regression on Node22.16/24 with isolated
  dependencies and documented package-cache preparation. Independent Standards
  and Spec inspect the same final aggregate candidate; all latest-head CI must
  pass. Report parent dependency/merge order clearly, without asking the owner
  to merge merely to continue development.

One bounded Sol/high worker implements host/tests/docs; primary owns namespace
and transport audit, integration and personally rerun gates. Independent reviewers
did not implement either candidate. No new model-quality claim follows from mocks.

## Implementation and acceptance record

One Sol/high worker implemented the MCP CLI/server, SDK and installed-artifact
tests and boundary documentation. Primary inspection required fresh nonexistent
DB paths for invalid configuration, explicit zero-call assertions for rejected
refs, and exact source-only model input. The installed regression invokes the
actual packaged CLI rather than widening the evaluation launcher. Its external
test preload scripts all HTTP and has no network fallback; runtime hashes are
checked against the built archive. Two capture batches and one review use exactly
18 synthetic HTTP callbacks (nine count and nine generation); cold keyless
inspection and missing-model review use zero. These are transport/lifecycle
observations, not natural semantic or host tool-selection results.

Worker targeted SDK/installed checks and the full 73-test MCP suite passed on
Node22.16 and24. Primary combined gates, fixed-candidate independent reviews and
latest-head CI are recorded in the delivery PR. No credentials or paid provider
requests were used in this slice. The parent core change is PR140; merge that
before this dependent host slice. No merge is performed by this delivery.
