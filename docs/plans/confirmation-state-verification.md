# CF-1 verification record

Synthetic evidence only, no network model calls. All tests and demos used
`TMPDIR` inside this worktree; scratch is removed before handoff.

Base/main: `c558593bd7dc4700a09235aeb8ebbd93184a0ea4`.
Standalone appendix commit: `101f08d31de28341f9e15c18a6f0ab6c98e4e1ed`.
The separate implementation commit is reported in the worker handoff.

## Decisions and limitations

- Opt-in `decisionReview: 'required-v1'`; review state is independent of currentness
  and filing. Explicit admit/remember retain explicit provenance.
- Automatic extraction cannot distinguish direct decisions from inferred ones.
  The [appendix](confirmation-state.md) retains the limitation for chichi's
  decision. The opt-in implementation conservatively awaits every newly captured
  inferred decision; this is not semantic provenance verification.
- Person-facing review reads are explicit. Normal readers exclude awaiting
  content with either opener configuration. Confirmation preserves inferred origin
  and source receipts; rejection forgets with fingerprint suppression.
- One unresolved decision hides its whole session episode and any episode borrowing
  its passages. Confirmation restores context; rejection restores an invalidated
  timeline shell with no prose or passages. The proportion of typical sessions
  affected is unmeasured; synthetic fixtures cannot establish a real-world rate.
- Eager additive schema v18; transactional rollback and actual older-opener refusal.
  Main-baseline parity is frozen from the real recorded base using existing scripted
  capture fixtures; only generated UUIDs and clocks are normalized, as in the
  existing parity convention. Additive storage metadata is excluded from legacy
  column comparisons; DTO and model request/output bytes are compared unchanged.

## Checks

| Check | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test` | exit 0; 131 passed | exit 0; 131 passed |
| `npm run validate` | exit 0 | exit 0 |
| New confirmation tests (both files) | exit 0; 21 passed | exit 0; 21 passed |
| `npm run test:core` | exit 0; 1022 passed | exit 0; 1022 passed |
| Required core demos | exit 0, all 11 | exit 0, all 11 |

Demos: store, history, moc, recall, admission, capture, conflicts, rebuild,
continuation, episodes, session-context.

`git diff --check` and the staged diff check: exit 0.
The 113-test migration/rationale/staging/classification regression run passed.
The first full core run exposed 22 legacy schema fixture mismatches; the fixture
assertions were updated for additive v18 metadata and the synthetic downgrade
fixture now removes v18 objects before replaying old migrations.

Offline artifact pack and staged-core import smoke passed with the two new modules.
The packaging helper's first pack attempt returned `artifact_command_failed`
(exit 1); repeating the offline pack with a worktree-local npm cache and checking
the staged core import passed (exit 0). No dependency installation or full artifact-install suite was run.

## Changed files by purpose

### Runtime and schema

- `core/admission-storage.mjs`
- `core/automatic-rationale.mjs`
- `core/capture.mjs`
- `core/classification-journal-storage.mjs`
- `core/confirmation-schema.mjs`
- `core/confirmation-storage.mjs`
- `core/conflict-storage.mjs`
- `core/contract.mjs`
- `core/database.mjs`
- `core/episode-reads.mjs`
- `core/episode-storage.mjs`
- `core/index-schema.mjs`
- `core/index-storage.mjs`
- `core/moc-storage.mjs`
- `core/ordered-capture-storage.mjs`
- `core/runtime.mjs`
- `core/session-context.mjs`

### Tests and frozen evidence

- `core/test/admission-migration.test.mjs`
- `core/test/capture-classification-journal.test.mjs`
- `core/test/capture-qualification-v2.test.mjs`
- `core/test/claim-qualification-migration.test.mjs`
- `core/test/claim-qualification-storage.test.mjs`
- `core/test/confirmation-migration.test.mjs`
- `core/test/confirmation-state.test.mjs`
- `core/test/conflict-migration.test.mjs`
- `core/test/episode-migration.test.mjs`
- `core/test/episode-mode-parity.test.mjs`
- `core/test/index-migration.test.mjs`
- `core/test/migration.test.mjs`
- `core/test/moc-migration.test.mjs`
- `core/test/ordered-capture-migration.test.mjs`
- `core/test/procedural-storage.test.mjs`
- `core/test/qualified-transition-migration.test.mjs`
- `core/test/rationale.test.mjs`
- `core/test/staged-capture-evidence.test.mjs`
- `core/test/supersession-migration.test.mjs`
- `core/testing/confirmation-parity.mjs`
- `core/testing/confirmation-v17-database.mjs`
- `core/testing/confirmation-v17-parity.json`
- `core/testing/episode-parity.mjs`
- `core/testing/generate-confirmation-v17-fixture.mjs`

### Documentation

- `CHANGELOG.md`
- `docs/local-store.md`
- `docs/plans/confirmation-state-verification.md`
- `docs/plans/confirmation-state.md`
- `docs/plans/session-episodes.md`
- `docs/storage-contract.md`

### Packaging

- `packaging/artifact-files.json`

## Changed files by Git status

Relative to the recorded base; `A` means added, `M` means modified.

```text
M	CHANGELOG.md
M	core/admission-storage.mjs
M	core/automatic-rationale.mjs
M	core/capture.mjs
M	core/classification-journal-storage.mjs
A	core/confirmation-schema.mjs
A	core/confirmation-storage.mjs
M	core/conflict-storage.mjs
M	core/contract.mjs
M	core/database.mjs
M	core/episode-reads.mjs
M	core/episode-storage.mjs
M	core/index-schema.mjs
M	core/index-storage.mjs
M	core/moc-storage.mjs
M	core/ordered-capture-storage.mjs
M	core/runtime.mjs
M	core/session-context.mjs
M	core/test/admission-migration.test.mjs
M	core/test/capture-classification-journal.test.mjs
M	core/test/capture-qualification-v2.test.mjs
M	core/test/claim-qualification-migration.test.mjs
M	core/test/claim-qualification-storage.test.mjs
A	core/test/confirmation-migration.test.mjs
A	core/test/confirmation-state.test.mjs
M	core/test/conflict-migration.test.mjs
M	core/test/episode-migration.test.mjs
M	core/test/episode-mode-parity.test.mjs
M	core/test/index-migration.test.mjs
M	core/test/migration.test.mjs
M	core/test/moc-migration.test.mjs
M	core/test/ordered-capture-migration.test.mjs
M	core/test/procedural-storage.test.mjs
M	core/test/qualified-transition-migration.test.mjs
M	core/test/rationale.test.mjs
M	core/test/staged-capture-evidence.test.mjs
M	core/test/supersession-migration.test.mjs
A	core/testing/confirmation-parity.mjs
A	core/testing/confirmation-v17-database.mjs
A	core/testing/confirmation-v17-parity.json
M	core/testing/episode-parity.mjs
A	core/testing/generate-confirmation-v17-fixture.mjs
M	docs/local-store.md
A	docs/plans/confirmation-state-verification.md
A	docs/plans/confirmation-state.md
M	docs/plans/session-episodes.md
M	docs/storage-contract.md
M	packaging/artifact-files.json
```
