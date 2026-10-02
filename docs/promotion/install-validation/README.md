# Fresh local-preview installation verification

Three of three clean installs and model-free walkthroughs passed on Linux x64.
They were run on 2026-10-02 at 17:14 UTC (2026-10-03 in Asia/Taipei), against
source commit `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`.

The operator was one independent **AI agent**, previously assigned to review the
documentation, with no contribution to the runtime implementation. It read both
the README and implementation contracts during preparation. These are agent-run
engineering checks, not human onboarding observations. The promotion plan's
unfamiliar-human installation check remains pending, so these results alone do
not pass the complete P2 gate.

| Attempt | Node / npm | Install | SDK install | Walkthrough | Outcome |
| --- | --- | --- | --- | --- | --- |
| [01](attempt-01-node22/result.json) | 22.16.0 / 10.9.2 | 4.453 s | 2.710 s | 2.000 s | Passed, 6/6 stages |
| [02](attempt-02-node24/result.json) | 24.15.0 / 11.12.1 | 7.719 s | 4.227 s | 2.381 s | Passed, 6/6 stages |
| [03](attempt-03-node22/result.json) | 22.16.0 / 10.9.2 | 3.950 s | 2.700 s | 1.789 s | Passed, 6/6 stages |

All three counted attempts were started once. There were no failed, interrupted
or replacement installation attempts. Attempts 02 and 03 overlapped; timings
describe these runs and are not installation-speed claims. They exclude manual
setup time and a network Git clone. [summary.json](summary.json) records the
complete denominator and remaining gates.

## What was run

Each attempt extracted its own `git archive HEAD` into a fresh temporary source
directory, without existing `node_modules`, and installed into a previously
nonexistent target. No working-tree runtime changes were copied. The source was
obtained from the local Git object database; the public Git clone step was not
retested. The commands follow the working-tree README's local installation path:

```sh
npm run install:preview -- --directory /absolute/new/cairn-local --owner local-user
npm ci --prefix adapters/mcp
node adapters/mcp/walkthrough.mjs --executable /absolute/new/cairn-local/app/node_modules/.bin/cairn-memory
```

Every attempt began with its own empty npm cache and temporary directory. A
small npm executable shim selected the stated Node/npm version and supplied
`--cache` to all npm calls, including the installer's nested calls. This isolated
dependencies and logs without changing the installer, SDK client or runtime.
Only public package downloads and the SDK install's npm audit were networked.
No account tokens, provider keys or other inherited credential environment were
forwarded. `--with-recall` was never supplied.

The installer did not open its configured database. The standard walkthrough
created a separate synthetic database and checked all six stages:

1. Discovery of the five explicit MCP tools.
2. Save and inspect a matching source receipt.
3. Restart the MCP process and inspect the unchanged memory and receipts.
4. Correct the memory, advance its revision and reject a stale correction.
5. Receive `model_not_configured` from recall without a provider key.
6. Forget the memory and observe an empty active list and a missing memory ID.

Each attempt also ran the existing `adapters/mcp/demo-transcript.mjs` against its
installed executable. This is a **separate synthetic loop** from the assertion
walkthrough. It preserves actual tool arguments, responses, IDs, revisions,
receipt excerpts and timestamps for a tabs-to-spaces preference correction:
[01 transcript](attempt-01-node22/tool-transcript.stdout.txt),
[02 transcript](attempt-02-node24/tool-transcript.stdout.txt), and
[03 transcript](attempt-03-node22/tool-transcript.stdout.txt).
The assertion walkthrough uses the separate Harbor Tuesday-to-Friday fixture.
Neither transcript is evidence of semantic recall: recall deliberately returns
`model_not_configured`.

## Artifact identity and evidence

All three independent builds produced `cairn-memory-local-preview@0.0.0-preview.1`
with archive SHA-256:

```text
ce2851621a9c7361523f3c7083998200b95665637c6b52c3fa20f269ff523646
```

The archive matched its installation receipt, and all 93 packaged runtime files
matched the recorded source hashes in every attempt. The three clean source tar
archives also shared SHA-256:

```text
938e1ba8d01d59081802266319aa579808420d848a4756ebd12fd9d1b58a8ba1
```

Each attempt directory retains step stdout/stderr, timing and exit codes, the
walkthrough JSON, the additional tool transcript, and a sanitized installation
receipt with source hashes. Absolute temporary, repository and Node installation
paths are replaced by explicit placeholders; synthetic IDs and timestamps remain
unchanged. Original receipts, installed files, temporary databases and raw logs
remain in the task's temporary directories. This page does not publish the
original private installation receipts.

[run-attempt-recorded.py](run-attempt-recorded.py) preserves the exact runner
used for the three recorded attempts. Its SHA-256 matches `runnerSha256` in the
unchanged [summary](summary.json). That version recorded both integrity checks;
all three attempts have matching archive and installed-file hashes.

The current [run-attempt.py](run-attempt.py) additionally fails the attempt on
either hash mismatch, before SDK installation or the walkthrough. A
[controlled fixture check](runner-integrity-check.json) verified both rejection
paths without another install or network requests. These fixtures are not
additional onboarding attempts and do not change the original denominator.

Use the current runner with an explicit local Node executable and a new attempt
name. It does not install Node:

```sh
python3 docs/promotion/install-validation/run-attempt.py \
  --attempt your-new-attempt --node /absolute/node-install/bin/node
```

## Remaining verification

- **Completed:** three fresh source installs, Node 22.16 and Node 24 coverage,
  all 18 model-free lifecycle stages, installed/source hash checks, and retained
  actual synthetic tool transcripts.
- **Pending:** an unfamiliar human following only the onboarding documentation,
  and the separate five-person README comprehension study.
- **Outside these checks:** GitHub clone availability, named chat-client setup,
  semantic extraction/recall, fully local model processing, other operating
  systems, human usefulness and broad-promotion readiness.

See the [promotion plan](../../plans/github-promotion.md#p2-入門與-demo-驗證) for
the complete gate and [known limitations](../../limitations.md) for the existing
quality failures. No runtime or client settings were changed by this verification.
