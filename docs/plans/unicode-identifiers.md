# Unicode identifier boundary — private coordination hold

Fixed base: `194e2a6ef3387a8d87ea0736b722eaf31e83c6f7`.
Local-only candidate. SECURITY.md requires private coordination for namespace
boundary vulnerabilities. Do not push this branch or its reproducer to a public
remote, open a public PR/issue, merge, publish an advisory or deploy without the
appropriate coordinated authorization. No user/production data is in scope.

## Acceptance

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
