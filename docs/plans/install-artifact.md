# Local install artifact and client evidence

Base `f8bf5748edb92811cbcc1ccd831a9ed52b6c6dc8` (MCP PR #18).
This is a dependent branch, not an approved publication or deployment.

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
to that release decision. Hermes integration is the next scoped package; this
one must not advertise it early. Full UI and Moss remain out of scope.

## Implementation evidence and retained failures

The artifact contains an explicit runtime allowlist, a delegating executable,
private manifest, production shrinkwrap and notices. Six offline artifact tests
pass on Node22.16.0 and24.20.0, including installed SDK stdio lifecycle/restart,
same-schema preview.1→preview.2 upgrade and uninstall/database preservation.
Actual archive contents and installed source hashes are inspected.
Actual installed-provider acceptance and final independent
reviews remain pending. No publication or deployment is performed.

The first test run failed installed-file checks because npm walked from an empty
temporary directory up to an existing `/tmp/package.json`. Two attempts installed
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
moved its exact package/bin to recoverable quarantine, retaining manifest backups
at `/tmp/cairn-install-quarantine-K0utwD`. Other dependencies were preserved;
the packaging worker performed no broad temporary-directory cleanup.

The license check also found that tiktoken1.0.22's npm archive declares MIT but
omits a standalone LICENSE. Rather than claiming one exists, this artifact now
includes the upstream license from the registry-reported gitHead; its provenance
is recorded in THIRD_PARTY_NOTICES and covered by the installed notice test.
