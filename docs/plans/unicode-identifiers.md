# Unicode identifier boundary — coordination history

The following sections retain the two original acceptance records. Their
private holds describe historical status, not an active publication prohibition:
the authorized minimum patch was merged through PR #69 at
`ee1ba832dbe9bdf2f23b120b5a6ba2eb42c29c68` and advisory
[GHSA-42p4-q4pr-vpwf](https://github.com/Cairn-ink/cairn-memory/security/advisories/GHSA-42p4-q4pr-vpwf)
was published on 2026-09-13. No package release, deployment or data repair occurred.

## Original qualification integration record

Security patch source: `28f946d6fe3ba757f542c74b6d188123ca69a613`
(independent base `3512719a3c43c14354f76c31064d8d62666e97bf`).
Integrated qualification base: `539d91e4b40b0743246e0c14f20b6982f0274757`.
This integration applies the source's minimal identifier guard, core regression
tests and installed-artifact probe, preserving the qualification lifecycle probe.
It introduces no additional migration or identifier normalization.

Root completed the combined offline gates on both Node 22.16 and 24. Each runtime
passed generic 31, core 351, OpenAI 152, MCP 25 and artifact 16 tests;
live-evidence-offline passed 61 with 27 skipped. JSON/plugin validation and the
store, MOC, capture, conflicts, history, rebuild, recall and continuation demos
all exited 0. These runs used synthetic sources and offline adapters; no model
calls were made. They verify this integration, not merely the source patch.
Independent Standards/Spec review of the frozen integrated commit remains
required before clearing the local qualification isolation gate.

SECURITY.md requires private coordination for namespace boundary vulnerabilities.
Keep this candidate and its reproducer local: do not push to a public remote,
open a public issue/PR, merge, publish an advisory or deploy without appropriate
coordinated authorization. Clearing a local verification gate does not release
this public disclosure hold. No user or production data is in scope.

### Acceptance

- U1: shared identifier validation rejects unpaired UTF-16 surrogates before
  SQLite, covering owner/project IDs, record IDs, receipt identifiers, admission
  event identifiers and legacy namespaces. Valid identifiers remain unchanged.
- U2: actual temporary SQLite tests reject malformed owner/project aliases with
  existing invalid_input/invalid_identifier errors and no stored-state mutation.
- U3: valid astral Unicode, U+FFFD and canonically distinct strings retain exact
  namespace identities across a full cold reopen.
- U4: retain the qualification regressions and both installed-core probes; run
  combined supported Node22.16/24 contributor, core, adapter and artifact gates,
  followed by independent review of the same frozen integrated commit.
- U5: do not normalize, delete or reconstruct previously coerced identifiers.
  The patch cannot recover invalid historical input; ambiguous existing data
  requires a separately scoped audit.

This concerns caller-supplied local core identities. Synthetic reproduction is
not evidence of deployed-service exploitation; hosted authentication and upstream
identity validation are separate boundaries.
## Original minimum-patch coordination record

Fixed base: `194e2a6ef3387a8d87ea0736b722eaf31e83c6f7`.
Local-only candidate. SECURITY.md requires private coordination for namespace
boundary vulnerabilities. Do not push this branch or its reproducer to a public
remote, open a public PR/issue, merge, publish an advisory or deploy without the
appropriate coordinated authorization. No user/production data is in scope.

### Acceptance

- U1: shared core identifier validation rejects unpaired UTF-16 surrogates before
  those identifiers reach SQLite, covering owner/project IDs, record IDs, receipt identifiers,
  admission event identifiers and legacy namespace access. Do not normalize valid
  identifiers or conflate malformed strings with U+FFFD.
- U2: actual temporary SQLite tests demonstrate malformed owner/project aliases
  cannot admit or read through the core/legacy boundary. Reject with existing
  invalid_input/invalid_identifier semantics, with no mutation of any stored row.
- U3: valid astral Unicode, replacement-character and canonically distinct valid
  strings preserve exact identities; namespace isolation and cold reopen work.
- U4: retain supported Node22.16/24 core, generic/JSON/plugin, relevant demos,
  OpenAI/MCP offline and installed artifact gates. Independently review the same
  fixed candidate before any authorized private delivery.
- U5: no migration, normalization, deletion or attempted reconstruction of
  previously coerced identifiers. Existing ambiguous data would require an
  explicitly scoped audit; this patch cannot recover the original invalid input.

The observed issue concerns caller-supplied identities in the local core. A
synthetic reproduction is not evidence of deployed-service exploitation: hosted
authentication and upstream identity validation are separate boundaries.
