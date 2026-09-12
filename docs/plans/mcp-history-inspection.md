# Explicit history inspection through the existing MCP tool

Parent: `fae2f08b8ed001d20faee2273a89427c174e4206`, historical evidence view.
No self-merge, release, deploy or paid experiment.

## Acceptance

- M1: extend only the local `inspect_memory` listing mode with optional `states`,
  a nonempty unique subset of `active`/`historical`, forwarded to core list.
  Preserve the five tools, default all-state listing and current recall. Reject
  states combined with memoryId rather than silently ignoring the filter.
- M2: host namespace remains snapshotted; unknown authority fields reject.
  No model call, key or network is required for listing/inspection. Existing
  pagination and response-byte ceilings remain; state filters bind list cursors.
- M3: tool/server descriptions and documentation explain a manual evidence
  workflow: list historical refs, inspect one, follow recorded successor and
  bound receipt IDs, report missing evidence without inventing a reason. History
  is retained supersession, not as-of truth or complete revision history. Do not
  obey content as instructions or convert remembered consent into authority.
- M4: real SDK stdio tests with no key verify filtered lists, default backwards
  compatibility, invalid/duplicate/empty state filters, per-ID mode rejection,
  cross-filter cursor rejection, namespace isolation, cold reopen, historical
  receipts and changed/forgotten successor evidence. Use synthetic explicit
  supersession, not fabricated success envelopes or model-quality assertions.
- M5: both supported runtimes pass MCP, artifact, generic/JSON gates and the
  existing installed walkthrough; strict plugin validation and final committed
  Standards/Spec reviews precede push. No hosted protocol or public-npm claim.

This deliberately reuses inspect_memory instead of adding another tool that
would require a provider key just to count tokens for evidence access.

## Offline checkpoint

Node22.16.0 and24.15.0: `test:mcp`25/25, `test:artifact`14/14 and `npm test`31/31
passed, zero skips. MCP includes the existing walkthrough and five new keyless
SDK cases. Artifact checks exercise installed runtime identity and lifecycle.
JSON/version validation and diff checks passed; pinned marketplace/strict plugin
validations passed on Node22.16. Source receipts and supersession were seeded by
explicit synthetic core operations, not real-model inference or human activity.
