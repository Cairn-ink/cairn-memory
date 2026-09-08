# Source-to-local preview installer

Base: `02e1a8e302f9a857ba00c81442e814d984d5c7c6` (#29 merged).

## Acceptance

1. `npm run install:preview -- --directory /absolute/new/path --owner ID`
   (optional `--project ID`) builds the existing reviewed artifact and installs
   it in a dedicated new directory, with no hand-copied archive path. Require
   Node >=22.16 and an existing real parent directory. Reject existing targets,
   relative paths, symlink parents, filesystem root and invalid/duplicate/unknown
   arguments before building or writing. Reuse core identifier validation.
2. Keep installation under `app/` and persistent DB location under `data/`, both
   inside the new private target. Do not open/create a DB or start MCP. Never
   mutate ancestor npm projects, client configs, shell profiles or global tools.
3. Use existing `buildArtifact` and sanitized command boundary, explicit npm
   prefix, ignore-scripts/no-audit/no-fund and public registry. No application
   credentials/config inherited by npm. No provider requests, keys in reports,
   new runtime dependencies, core changes, automatic capture or publication.
4. Write a private installation receipt with artifact hash, executable, DB path,
   exact owner/project and a generic stdio command/args (use current Node's
   absolute executable). Output the receipt location and config for user use;
   explicitly distinguish this local path/identity report from secret-free
   `--check-config`. Never output credentials or raw child-process errors.
5. Refuse overwrite/re-run; retain partial installs on failure with a sanitized
   message, no recursive cleanup. Receipt is written only after successful
   installed `--check-config`. Document local process trust, no upgrades and
   that data directories must be retained separately from removing app/.
6. Tests cover invalid args/targets/symlink parent, ancestor protection,
   failed install preservation and actual fresh installation with source and
   artifact identity, config check and SDK lifecycle/restart. Run relevant tests
   on Node22.16 and24 and include new tests in CI via existing artifact test glob.
7. Update README to shortest honest clone/install/configure path. No npm registry
   npx promise, named-client claim, fully-offline semantic recall or human outcome.

## Following stages

After verified delivery: actual named-client + Hermes session evidence where
available and authorized; otherwise retain exact blocking condition and a
repeatable verification path. Commercial provider/counting contract changes
require an explicit design agreement and must not silently change provider or
usage controls. Promotion/demo drafts can proceed without publishing.

## Verification

- Node22.16.0 and24.20.0: `node --test packaging/test/*.test.mjs` — 13/13 each;
  `node --test adapters/mcp/test/*.test.mjs` — 18/18 each. Installer tests use
  actual offline npm installs and actual SDK stdio lifecycle, not a fake engine.
- DRI independently ran the documented network-enabled
  `npm run install:preview -- --directory /tmp/cairn-installer-onboarding-Tm8ezV/installation --owner synthetic-onboarding`
  with sanitized environment: passed. No model requests; only npm public registry.
- Built archive SHA256
  `4db3754fcf44caba56de73fceee67de795c742c18b972008351ce7abef086f0d`
  matches independently installed Node22/24 artifacts.
- DRI ran `node adapters/mcp/walkthrough.mjs --executable /tmp/cairn-installer-onboarding-Tm8ezV/installation/app/node_modules/.bin/cairn-memory`:
  all six model-free stages passed against the new installed artifact.
- `node scripts/validate-json.mjs` and `git diff --check` passed. No TypeScript
  gate is configured in this JavaScript repository. Existing CI artifact glob
  includes all new tests. Core and adapters are byte-unchanged from base.
- Required contributor gates: plugin suite31/31; isolated maintainer marketplace
  and strict plugin validations passed; public metadata cache preparation passed.
  Maintainer tooling initially lacked its native wrapper because dependencies
  were installed with ignore-scripts; after inspecting its local-only installer,
  explicitly placing the pinned binary resolved this tooling setup issue.
