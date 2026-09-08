# Local install artifact and client evidence

Base `f8bf5748edb92811cbcc1ccd831a9ed52b6c6dc8` (MCP PR #18).
This is a dependent branch, not an approved publication or deployment.
The install candidate also incorporates reviewed provider-reference and
source-relationship fixes from PRs #20 and #22 in the same public engine.

## Acceptance I01–I08

- I01: Produce a locally installable npm tarball from the single checked-in public
  core and thin MCP host. A generated staging directory is acceptable; a second
  maintained copy of the engine is not. No registry publication, account or
  project environment file is needed. Retain a private package flag until a
  separate release decision, and report exact artifact version/hash.
- I02: Explicit file allowlist excludes tests, synthetic databases, reports,
  credentials, local configuration, node_modules and private application code.
  Include runtime prompts, source dependencies and license/notices. Inspect
  actual archive contents, not merely package.json intentions.
- I03: Pin production dependencies and record the lock/resolution strategy.
  Fresh installation in a synthetic temporary directory must work outside any
  source checkout. No postinstall network download/script or global install.
  Clear Node >=22.16 requirement; do not change existing hosted plugin behavior.
- I04: Installed executable supports the existing explicit db/owner/project
  binding and five MCP tools through the same host. Use the actual SDK client
  against the installed subprocess; store, inspect, restart, inspect, correct,
  forget, and reject stale/foreign parameters. No model key gives the same
  explicit recall error, never a substitute retrieval algorithm.
- I05: Record a separately budgeted actual-model installed-host new-session
  recall test with synthetic data. This cannot be replaced by an SDK-only mock.
  DRI alone may use the already authorized key and remaining global US$5 allowance;
  never package or log the key. If unavailable, clearly retain this as a blocker.
- I06: Compatibility matrix distinguishes exact tested SDK/OS/Node/stdio from
  untested named clients and remote connectors. No ChatGPT/Claude/Codex/Hermes
  support badge without actual host evidence. MCP is not automatic capture.
- I07: Document install/start/inspection/deletion/upgrade/backup/uninstall and
  troubleshooting. Uninstall never silently deletes the memory database; upgrade
  must reuse the selected path and preserve synthetic memory under same schema.
- I08: Offline artifact tests, core/adapter/MCP regressions and repository gates
  pass on Node 22.16 and 24. Final committed diff receives independent Standards
  and Spec reviews before a scoped dependent PR. Semantic quality remains a
  separate release gate. No self merge, registry publish or remote deployment.

## Scope decisions

A local npm archive is the verification artifact, not a claim that a published
`npx` package exists. Package naming/version for a public release remains subject
to that release decision. Hermes native memory-provider integration is the next
scoped package; the narrowly observed MCP discovery below is not that integration.
Full UI and Moss remain out of scope.

## Implementation evidence and retained failures

The artifact contains an explicit runtime allowlist, a delegating executable,
private manifest, production shrinkwrap and notices. Six offline artifact tests
pass on Node22.16.0 and24.20.0, including installed SDK stdio lifecycle/restart,
same-schema preview.1→preview.2 upgrade and uninstall/database preservation.
Actual archive contents and installed source hashes are inspected.
Actual installed-provider acceptance has now passed as described below. Final
independent reviews remain pending. No publication or deployment is performed.

The first test run failed installed-file checks because npm walked from an empty
temporary directory up to an existing ancestor package.json. Two attempts installed
the preview dependency there instead of in their intended temporary projects.
The affected package was the synthetic local preview; its installed lifecycle
checks had not succeeded. That failure is retained, not counted as installation
success. The corrected fixture first
initializes a private package.json, explicitly passes `--prefix` for install and
uninstall, and asserts npm's resolved prefix before proceeding. User instructions
also initialize the dedicated directory and retain `--prefix .`. A dedicated
synthetic-ancestor regression verifies its manifest and dependency directory
remain untouched while the child install receives the artifact. The DRI removed
only the introduced preview entries from the temporary root manifests/locks and
moved its exact package/bin to recoverable quarantine, retaining manifest backups.
Other dependencies were preserved;
the packaging worker performed no broad temporary-directory cleanup.

The license check also found that tiktoken1.0.22's npm archive declares MIT but
omits a standalone LICENSE. Rather than claiming one exists, this artifact now
includes the upstream license from the registry-reported gitHead; its provenance
is recorded in THIRD_PARTY_NOTICES and covered by the installed notice test.

## Installed-provider and client evidence

On 2026-09-09 (Asia/Taipei), the DRI exercised
`cairn-memory-local-preview@0.0.0-preview.1` with archive SHA-256
`708a72b597d2958bd5c37340c4b28559ba707829e6e7a65d69858e20bb976020`.
The official SDK client used actual stdio against the installed executable:
remember a synthetic fact, stop and restart the process, recall with the real
model and verify its exact source receipt, forget, then verify model recall
returns no memory. All stages passed. Unlike the earlier in-memory host probe,
this exercises the installed executable and fresh-process persistence together.

The installed-provider run made six HTTP requests, all status200, reserving
US$0.026688. Generation reported 1150 input and 87 output tokens, estimated
US$0.0005992. These are run-local usage estimates, not an invoice. The DRI's
cumulative shared authorization ledger is US$2.980160 reserved of US$5, leaving
US$2.019840; the total includes earlier retained failed/probe/evaluation runs.
No worker used credentials or repeated this paid run.

Hermes 0.21.1 at commit `c8aa5608c24e3636e77c267650c0f1f52e44adb0`
also connected to this installed artifact using `hermes mcp test cairn` on
Linux x64 with Node 22.16.0. The initial probe reported five tools in 852 ms;
an independent discovery-only repeat reported `Connected` and the same five
tools in 759 ms. The model key was explicitly blank. This is real Hermes MCP
connection/discovery evidence only: no chat tool-use, automatic lifecycle hooks,
native memory-provider selection or catalog inclusion has been verified.

I05's narrow installed lifecycle is satisfied. It does not establish general
memory quality: the frozen full semantic suite still fails its source-support
gate. Named-client tool-use and native Hermes integration remain separate work;
there is no universal-client or launch-readiness claim.

## Final candidate verification

The integrated runtime passed 181 core tests and all nine documented offline
demos on each of Node22.16.0 and24.20.0. Six installed-artifact tests passed on
both runtimes and reproduced the archive SHA-256 above. The DRI also verified
the integrated MCP/adapter tests on both runtimes. The 31 plugin tests, repository
JSON/version checks and isolated pinned Claude marketplace/plugin validation
passed. These are offline engineering gates, not semantic-quality approval.
The candidate is ready to be committed for independent Standards and Spec
review; those reviews and a scoped PR remain separate delivery steps.

## PR24 clean-cache regression

CI exposed a prerequisite hidden by the maintainer's warm npm cache: `npm ci`
populates dependency tarballs but not package metadata used when npm installs
the archive's nested shrinkwrap. A fresh isolated cache reproduced the exact
installation failure (`ENOTCACHED`, metadata for `@modelcontextprotocol/server`).
Preparing only the four pinned production packages' public metadata made the
same archive/cache/runtime install successfully offline.

Additional acceptance: the network-enabled `packaging/verify-clean-cache.mjs`
must create its own cache/config and synthetic adapter installs, record whether
the preparation-free install succeeds, then verify the same install succeeds after
explicit metadata preparation. Both supported runtimes must pass this regression
and ordinary offline artifact tests. Ambient application credentials and npm
cache/registry/config overrides must not enter child commands. No runtime source,
archive bytes, model calls or I05/semantic-quality acceptance changes are allowed.
The recorded original failure is diagnostic evidence, not a requirement that
future npm versions must continue failing before preparation.

The CI prerequisite is `node packaging/prepare-cache.mjs`; its public registry
requests are explicit and separate from ordinary offline artifact tests.
The fix still requires independent review and a green remote CI rerun.
