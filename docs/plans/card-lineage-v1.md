# Installed shared Card lineage v1

The implementation of the S2c contract in
[context-read-b3s-safety-layout.md](context-read-b3s-safety-layout.md) is a complete
opt-in package for authored Cards. It adds one durable authority, all authored
writers and grant producers, canonical read decisions and final publication
checks. It does not install engine Documents or automatic engine reads.

Accepted tuples are `(52,23,1,1,e)` and `(53,33,1,1,e)`, where the fields are
physical family, base, suppression revision, lineage revision and receipt-time
bit, and `e` is 0 or 1. There is no engine column. Base 18 and reserved physical
rows 49/50 cannot select lineage. The private attested lineage accessor does not
expose a serving flag on a copyable public layout object.

`card-lineage-schema.mjs` contains the frozen 17 lineage CREATE statements.
The Memory invalidation delta changes only the UPDATE assignment list to retain
the invalidated draft/confirmed body. Complete attestation compares the entire
inherited base, suppression and lineage schema, including the receipt-time
column/trigger alternative and the invalidation trigger. The inherited base
declarations are generated from pristine synthetic stores by
`scripts/generate-card-lineage-base-schema.mjs`; they do not open a serving file.

The explicit offline `migrateCardLineage` API uses the existing independent
backup, identity, quiescence and exclusive-transaction checks. It runs canonical
legacy observation/classification, preserves suppression facts, counters,
reservations and domain, installs the complete package, seeds unknown headers
and positive edges, then verifies all commitments, pointers, foreign keys and
integrity before committing. It does not infer authorship or completeness from
legacy receipts or surviving bindings. The installer legacy-policy gate remains
held; this API is not wired into installer or CLI selection.

`card-lineage.mjs` is the single append/seal and load authority. Commitments use
strictly decoded, round-tripping, canonical stored UTF-8 bytes and the specified
JSON/domain-separated HMAC-SHA256 tuples. Receipt/note/Raw commitments retain
their original base64url encoding under a separate hex S2 wrapper. Sources grow
monotonically within a body. All required ancestry and the cumulative set are
revalidated before sealing and delivery. Unknown cannot become complete within
the same body. Human own-writing authorization is a distinct audited authority;
operation-only claims never certify it.

The native changeset guard allows only causally proven revision/time
invalidation of retained draft/confirmed Cards during source privacy. It checks
unchanged content, body identity, bindings and immutable authority rows without
requiring denied sources or siblings to become readable. Ordinary serving keeps
the complete canonical denial predicate. Disguised edits, forged effects and real
SQLite failures roll the transaction back.

Authored read checks cover direct/list metadata, MOC title/member endpoints,
embedded/service raw text getters, scoped-empty semantic dispatch, zero-fact
hybrid filtering, metadata peeks, exact source/history, prepared/cache/fallback,
dates, role evidence and method attachments. A closed import/static gate audits
the private capability consumers and every read-decision group. Prepared and
publication fences include the latest body/provenance identity; zero suppression
facts and unchanged general epochs do not confer a Card read grant.

[SEAM.md](../../SEAM.md) enumerates the affected host surfaces. Unmigrated stores
retain the existing grammar, outputs and statement sequence. A frozen baseline
and direct Git-baseline differential check serialized outputs, executed SQL and
every canonical table population. Existing path-cost and receipt-time fixtures
are retained; receipt-time metadata pin changes are limited to tuple/schema/
migration implementation and the evidence generation's lineage fence.
