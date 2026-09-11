# Installed capture-to-MCP experiment

This maintainer harness checks a different path from explicit MCP `remember_memory`:
an installed programmatic `core.capture` producer closes its database, then fresh
stdio consumers recall, correct, recall again, forget and verify absence.
It does not add a public capture command or automatic transcript ingestion.

`evaluation/live/installed-capture-loop.mjs` exports `runInstalledCaptureLoop`.
Its inputs pin a local archive and installed executable, select a Node executable,
provide an empty private temporary directory and inject a guarded session exposing
`request(path, body, {signal})` and `getState()`. The primary private operator owns
provider authorization and budgets; this module never loads environment keys.
Children receive only a temporary authenticated loopback capability.

The archive hash and installed runtime bytes are checked before capture. The
fixture and acceptance are frozen in [the plan](plans/installed-capture-loop.md).
Every stage retains its actual observations. Mechanical completion still requires
independent semantic review: a Friday keyword and an authentic receipt do not
prove the stored claim follows from that receipt. Paraphrases may be valid even
when receipt text differs from memory text.

## Offline verification

Install the isolated adapter dependencies, then run the ordinary model-free suite:

```sh
npm ci --prefix adapters/openai
npm ci --prefix adapters/mcp
npm run test:live-evidence-offline
```

The installed integration tests additionally require explicit fixture selectors:
`CAIRN_NODE`, `CAIRN_EXECUTABLE`, `CAIRN_ARTIFACT`, `CAIRN_ARTIFACT_SHA256`.
Use an inspected artifact built and installed by the existing
[local artifact workflow](install-artifact.md). Run
`node --test evaluation/live/test/installed-capture-loop.test.mjs` with those
selectors on Node22.16 and24. The tests inject scripted HTTP and synthetic fresh
stores; they never require a provider key or authorize a paid experiment.
Missing selectors produce explicit integration skips, not installed evidence.

Real-provider execution requires the already reviewed private operator, frozen
intent, original cumulative ledger and separately scoped allowance. There is no
public live CLI here. Passing a small synthetic lifecycle is not proof of human
usefulness, autonomous Hermes tool choice, long-history scale or general model
reliability, and never changes the default model.
