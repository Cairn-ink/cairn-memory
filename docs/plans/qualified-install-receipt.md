# Source-qualified install receipt (S8)
Use isolated dependent worktree after S7 verification. Same shared engine.

- I1: installPreview strictly accepts optional --capture-qualification with
  existing source-bound-v1/source-bound-v2 only. Absent preserves current
  five-tool behavior and old receipt/check-config shape. Invalid values,
  duplicate flags or unknown options reject before install/writes/network.
- I2: Generated stdio.args and syntax check both carry exactly selected mode.
  Receipt may record selected mode but no secrets/env credentials. Preserve
  fresh-directory, no-symlink, external DB, partial-install retention and
  no-client-config/no-global-install rules.
- I3: Actual installed MCP must be started directly with generated receipt
  settings, no hand-added mode flags. Selected v2 discovers six tools, captures
  explicitly submitted synthetic messages, recalls full qualifications, cold
  inspects and duplicate replays with zero model HTTP. Unconfigured remains five.
- I4: Document source-checkout command, private receipt/config handling,
  dedicated client key setup, explicit capture/recall usage, source inspection,
  fixed800-unit retained windows, costs and unverified attribution. No passive
  hook, published npx, ChatGPT remote connector or native-Hermes support claim.
- I5: Both Node22.16/24 install/artifact/MCP/generic/JSON/plugin gates, independent
  new tests and root installed exercise, exact-head Standards/Spec review.
  No provider calls/package publication/client-config writes/deployment.
Native Hermes mode forwarding, capture-only key forwarding and bounded capture
timeout are next; do not claim installation alone wires native provider.

Fixed base: `39f2b2e740659fd4a62d52e330601d820bdbdd74`.
The source-evidence context from S7 is explicitly selected on recall tool calls,
not a new installer/runtime default. Document that usage in the walkthrough.
Selected mode must match the installed check-config report before a receipt is
written; absence preserves old receipt shape. No model key is read by installer.

## Verification

Root ran `npm test` (31), `npm run validate`,
`npm run validate --prefix tools/plugin-validation`, `npm run test:mcp` (53),
and `npm run test:artifact` (54): all passed on Node 22.16.0 and 24.15.0.
There is no TypeScript gate in this JavaScript repository.
Root separately ran both new qualified-install test files (7 passed).
Independent test authors also ran the new tests on both runtimes.

The installed SDK lifecycle consumes the receipt command/args unchanged. A
test-only fetch preload redirects the actual adapter to a local fake provider:
six capture HTTP requests, four source-only recall requests, four qualified
recall requests, then zero-HTTP cold inspection/replay, including keyless replay.
Default installation discovers five tools. No real model request or credential
was used. This verifies wiring and source separation, not interpretation quality.
