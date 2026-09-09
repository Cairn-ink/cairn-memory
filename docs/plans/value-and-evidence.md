# Paired product value and reliability delivery

Base: `d6cdf36107641f990a04c7c54aeac64d1cda8db6` (public PR30–32 merged).
The product goal is a professional lightweight MCP-first memory layer whose
public engine is also the commercial consumer's engine. Value demonstration and
evaluation run in parallel; neither replaces the other. No private application,
Stripe, provider default, production route, release or outreach changes here.

## Product promise and success measures

A developer can explicitly save a project decision or preference, use it in a
fresh conversation without restating it, inspect its source, correct it and
forget it. Local MCP does not automatically capture transcripts. Native Hermes
uses profile-personal memory: a project name in the text is not project-scope
isolation. Generic MCP project binding is a separate setup and must not be
silently equated with the native profile's owner/database.

Measure installation success, first cross-session success and voluntary repeat
use before stars. No new telemetry is implied. A fresh-context agent is an
onboarding probe, not a human user study. Scripted host tests are plumbing
evidence, not evidence of real-model tool choice or useful autonomous behavior.

## Track A: first-use readiness acceptance V01–V06

- V01: A fresh-context verifier follows checked-in instructions in a new private
  temporary install with synthetic data, sanitized environment and no key. Keep
  exact commands, runtime, artifact hash, passed/failed stages and obstacles.
  Primary personally repeats the important observed path; do not recycle prior
  verification as a new run. Preserve all user worktrees/profiles/databases.
- V02: Fix concrete onboarding blockers within a focused documentation or
  diagnostic change. No client-account setup, broad installer rewrite, new
  protocol, automatic capture, telemetry or supported-client expansion.
- V03: Publish a runnable no-key first-use path and a separately labeled real
  chat acceptance protocol. Describe agent model credentials versus the native
  Cairn recall credential, profile/database boundaries, and partial/failed
  outcomes. Never mark unavailable model-backed steps as passed.
- V04: Freeze the real-chat task and evidence requirements before paid runs:
  synthetic project decision, fresh sessions for recall/correction/forgetting,
  actual tool results and source support, no answer text in fresh-session prompts,
  no resumed history or other memory channel as a substitute. A separate
  no-memory control distinguishes recalled knowledge from guessing.
- V05: Block paid execution until an explicit new budget and a combined guard
  covering agent completion and Cairn count/generation requests are approved
  and tested, including failure/retry/unknown outcomes. Historical US$5 authority
  is not refilled. This package may prepare the protocol but cannot claim a live
  full-chat outcome from the prior MemoryManager or scripted-agent reports.
- V06: Required contributor gates and independent Standards/Spec reviews on
  the final candidate. Record worker/primary evidence and honest remaining gates.

## Track B: evaluation acceptance and sequencing

1. Offline LongMemEval-S preparation: pin provenance, strip answer annotations
   from model-facing history/questions, preserve source mapping and full history,
   validate malformed input and capture-size compatibility without truncation.
2. Reliability regression: source faithfulness, correction/currentness,
   forgetting/suppression, owner/project isolation and fault behavior. Safety
   violations are release blockers, never averaged away by a QA score.
3. After budget approval, fixed stratified pilot comparing Cairn, a simple
   retrieval baseline and no memory with the same answering model and context
   allowance. Separate retrieval evidence coverage from final answer correctness.
4. Full pinned dataset evaluation with fixed scorer/judge and published failures,
   denominators, cost, latency, RSS and storage. Pilot results are not full scores.

The preparation work is an independent PR from the same base; it neither changes
core/model defaults nor claims to run a benchmark. Dataset redistribution and
HaluMem usage are excluded pending license/source review. Demo material and
scored test data stay separate. Fixing a benchmark failure changes the product
in a reviewed implementation slice, not by editing held-out answers or dropping
failed cases. Freeze held-out test IDs before tuning and preserve all attempts.

## Delivery order and stop conditions

Parallel first batch: first-use probe/readiness improvements and offline
benchmark preparation. Then ingestion/scoring plus the protected real-chat run
path, followed by budget-approved live probes, repairs, full evaluation and a
developer-preview release candidate. Public trial need not wait for private
commercial cutover or a ten-person alpha, but known safety failures must be
handled and quality limitations remain visible. Owner approves merges,
publication and deployment. No paid run or release is authorized by this plan.

Primary owns architecture, shared acceptance and integration. First-use probe
uses Luna max; benchmark preparation uses Sol high for filesystem/data-boundary
safety. Independent reviewers do not implement the candidate they inspect.
Each dependent stage waits for primary verification and both review axes.

## First-batch observed evidence

Fresh-context Luna max verifier followed the existing installer and SDK
walkthrough without prior project context: Node 22.16.0/npm 10.9.2, installation
1.42 seconds, SDK dependency installation 0.63 seconds, six-stage walkthrough
0.78 seconds. These are single-run observations on this prepared machine, not
cold-cache performance claims, user benchmarks or service guarantees.
Artifact SHA-256: `4db3754fcf44caba56de73fceee67de795c742c18b972008351ce7abef086f0d`.

The primary independently installed again into a different fresh temporary
directory, obtained the same artifact hash and passed all six no-key stages.
Commands used the documented installer and walkthrough under sanitized Node
22.16 environment; no key, paid option or existing data was used. Plugin tests
31/31 and JSON/version validation passed. No TypeScript gate exists here.

The probe found no installation failure. Remaining first-use obstacles were
external pinned Hermes/Python/SDK prerequisites, manual profile-sensitive setup,
and the unverified paid chat boundary. The new first-value guide addresses the
credential and storage ambiguity and freezes the next experiment; it does not
pretend to install Hermes or remove the paid-execution blocker. No production
or private application change is part of this batch.

### Commands and stage ledger

Both installs ran from this repository root with `env -i`, Node 22.16.0/npm
10.9.2 and only their runtime/system directories in PATH. Machine-specific Node
installation prefixes are intentionally omitted; the following are the exact
program arguments and synthetic target paths, not user profile locations.

Fresh-context worker:

```sh
npm run install:preview -- --directory /tmp/cairn-first-use-jVWcNA/cairn-local --owner local-user
npm ci --prefix adapters/mcp
node adapters/mcp/walkthrough.mjs --executable /tmp/cairn-first-use-jVWcNA/cairn-local/app/node_modules/.bin/cairn-memory
```

Primary, separate install:

```sh
npm run install:preview -- --directory /tmp/cairn-value-primary-SVmjJX/cairn-local --owner local-user
node adapters/mcp/walkthrough.mjs --executable /tmp/cairn-value-primary-SVmjJX/cairn-local/app/node_modules/.bin/cairn-memory
```

Each parent directory was created with `mktemp -d` before its respective install;
use a newly generated parent to reproduce, not an existing recorded target.
The primary reused the worker's locked source SDK installation but used a new
installed app and synthetic database. No receipt/user database was shared.

| Stage | Fresh-context worker | Primary |
| --- | --- | --- |
| five_tools | passed | passed |
| remember_and_inspect | passed | passed |
| restart_and_inspect | passed (memory content) | passed (memory content) |
| correct_and_reject_stale | passed | passed |
| model_disabled | passed: model_not_configured | passed: model_not_configured |
| forget_and_empty_inspect | passed | passed |

Spec review identified that the original restart stage compared only content,
not the previously inspected Source Receipts. The diagnostic now compares the
full receipt array after reopening. The earlier passes above remain historical
content checks; final corrected-run verification is recorded separately below.

Final corrected-run verification: the independent worker reran the same
walkthrough command against its installed artifact under Node 22.16.0; all six
stages passed (0.65 seconds), now including full receipt-array equality after
restart. Primary reran the documented walkthrough command against its own
installed artifact on Node 22.16.0 and 24.20.0: all six stages passed on both,
including the new assertion. Core/artifact source files and hash were unchanged.
Primary `npm run test:mcp` passed 18/18 on each runtime, and reran plugin tests
31/31 and JSON/version validation successfully. An initial Node 24 command
could not locate npm in its sanitized PATH; adding the known npm binary directory
fixed the invocation before the successful gate. This was not a test failure.
Pinned Claude 2.1.260 marketplace and strict plugin validation also passed.
