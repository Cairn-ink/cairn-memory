# Explicit offline base-layout upgrade

A host can import `upgradeLayoutBase` directly from
`core/layout-base-upgrade.mjs` to upgrade an existing legacy base-18 store to
legacy base 33. The function accepts only `path`, `backupPath`, `expected` and
`quiescence`. `expected` must contain the store's `storeId`, `fromBase: 18` and
`toBase: 33`.

Before calling, close admissions, stop writers, drain readers and close all old
handles. Assert all four conditions with `admissionsClosed`, `writersStopped`,
`readersDrained` and `oldHandlesClosed` set to `true` in `quiescence`. SQLite cannot
revoke other processes' idle handles. Keep admissions closed throughout maintenance
and after any failure.

Both paths must identify distinct, private regular files without SQLite companion
files. The source must use DELETE journal mode, have the expected application and
store identities, and be at version 18 without a content-safety cell. Supply an
offline backup with the same complete logical inventory. The operation opens the
source in noncreating read/write mode and verifies its identity, backup inventory,
integrity and foreign keys before installing anything.

One write transaction installs the same schema chain as the full optional-feature
opener, validates the result and checks integrity, foreign keys and every preexisting
table's row count. Failure rolls back the complete transaction. Success returns
`Object.freeze({ storeId, fromBase: 18, toBase: 33, counts })`; `counts` is a frozen
object mapping every preexisting table name to its unchanged row count. Errors
contain only `invalid_input`, `unsafe_database_file`, `unsupported_database` or
`storage_busy`.

To install receipt event time and the base-33 content-safety cell afterward, take a
fresh offline backup of the upgraded store and separately call
`migrateReceiptEventTime` with `expected: { storeId, base: 33 }` and the same
quiescence assertions. That operation reaches physical layout 53.

Without episode mode, the default facade's `setCapturePaused` and `setProjectCapture` return `episode_mode_required` on physical layout 51 and succeed on Raw-capable physical layout 53; a host uses a separate episode-mode request core for these setters.

## Non-goals

This operation is never called on open and is absent from `core/index.mjs`. It
does not enable Raw or any other feature, perform data migration of any kind, or
change existing stores beyond the schema and its layout version. It does not
install content safety, restore a backup, grant capture authority or change host
options. A host must explicitly select any subsequent maintenance or feature use.
