# Local setup diagnostics

Base: `93719d746c081cf9a1cad99fab6a52ad19596b2e`.

First onboarding slice: make the installed local MCP understandable before it
starts. This is not the entire onboarding milestone.

## Acceptance

1. Source and installed executable support standalone `--help` without a DB,
   SDK initialization, model key, network request or persistent write.
2. `--check-config` plus normal startup arguments returns a JSON configuration
   report and exits. Validate argument syntax and namespace identifiers using
   the core validator. Reject duplicate/unknown flags, invalid identifiers and
   malformed configured keys, without echoing input or secrets.
3. Check mode does not open/create the database or contact any provider. Report
   key presence, configured recall model and cloud-processing boundaries, not
   key validity, model availability or database readiness. Explicitly mark those
   unverified. Missing key is a valid model-free setup, not an error.
4. Normal startup remains stdout-protocol-only, with the same five tools,
   namespace binding, default model and lifecycle behavior. No core changes,
   capture tool, model switch, generated client configuration or publishing.
5. README and packaged instructions explain help/check/start, stdio waiting,
   explicit memory versus model extraction, and programmatic-only experimental
   extraction. Do not imply extraction scores certify the MCP recall path.
6. Verify source subprocesses and the freshly installed artifact, no-key
   persistence/revision/forgetting regression, and adapter/core tests on Node
   22.16 and 24. Existing CI globs must include new tests. No paid calls needed.

## Deferred

One-command installation, named-client interactive sessions, provider contract
changes, commercial integration, publication and real-user outcome measurement.
The MCP directly admits explicit memories; its tools do not use extraction, so
an extraction-only CLI switch would not improve this onboarding flow.

## Verification

- Node 22.16.0 and 24.20.0: `node --test adapters/mcp/test/*.test.mjs
  packaging/test/*.test.mjs core/test/*.test.mjs adapters/openai/test/*.test.mjs`
  — 289/289 each. Configuration tests rerun with a fatal provider-fetch tripwire:
  3/3 each. These are offline model tests, not new semantic-quality evidence.
- Node 22.16.0: `node --test plugins/cairn-memory/test/*.test.mjs` — 31/31;
  `node scripts/validate-json.mjs` — valid JSON and consistent versions.
- Built archive SHA-256:
  `ecdaf60bebeb35070aed9be5f0f861f6cf1cf28b570cbb724a48b09c0c033d79`.
  Both runtimes independently built and installed the identical archive.
- `node adapters/mcp/walkthrough.mjs --executable
  /tmp/cairn-installed-preview-VCPhYH/node_modules/.bin/cairn-memory` — all six
  no-model stages passed against the installed artifact and fresh synthetic DB.
- `git diff --check` passed. `core/` and `adapters/openai/` unchanged from base.
  This JavaScript repository has no TypeScript/typecheck configuration; no
  private application files changed. New tests run under existing CI globs.
- No live model calls, production access, publication or deployment.
