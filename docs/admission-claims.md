# Guarded inferred admission — package 1a

The public core now provides durable claims and atomic inferred-memory commits.
It is still not an automatic extractor: an application must validate/redact input,
claim the event, perform any extraction outside the database, validate evidence
against the original input and construct trustworthy source receipts itself.
Package 1b supplies that orchestration. Do not pass raw model output to finish.

## Claim, then finish or abandon

`claimAdmission({namespace,client,eventId,payloadDigest,leaseMs})` uses an exact
namespace/client/event key. `payloadDigest` is a lowercase SHA-256 hex digest of
the complete validated/redacted payload; the caller defines its canonical form.
`leaseMs` is an integer from 1 to 125000. Normal envelope values are:

- `{token}`: this caller owns a fresh lease.
- `{processing:true}`: a live owner exists; retry later, do not start extraction.
- `{duplicate:true,memoryIds,suppressedCount}`: completed event; do not extract again.

Changing the digest for an existing key fails `event_payload_conflict`, even
after abandonment or expiry. An expired claimant may be replaced with a new
token; the former token can no longer commit. Lease timing uses the machine's
wall clock. An application must not infer distributed exactly-once model calls
from this mechanism: a slow old model call can overlap a takeover, but its stale
result cannot write. Timeouts, abandonment and idempotent commits remain separate.

`finishAdmission({namespace,client,eventId,payloadDigest,token,items})` admits
zero to five trusted items. Each item has content, kind, confidence, one
to four source receipts and optional [conflictHints](conflicts.md).
Content is normalized/redacted, at most 600 UTF-16 units;
confidence is a finite number in 0..1. Core assigns inferred origin and identity.
Namespace, assigned memory IDs and arbitrary origin cannot come from items.
Conflict hint targets are trusted orchestration references, not extractor output.

The live lease, all memory/source changes and recorded completion are checked/
committed atomically. A failed batch writes nothing and does not consume its
claim. Missing, replaced, expired or completed claims fail `stale_admission`.
Exact same-batch memory matches coalesce to unique IDs with final revisions.
Inferred matches cannot overwrite explicit metadata; new receipts may still
advance revision and invalidate old MOC filing. No-op retries retain filing.

Successful finish returns `{duplicate:false,memories:[{id,revision}],
suppressedCount,indexRevision}`. A valid empty extraction completes normally.
Suppressed items count individually and are not restored, while other valid
items can commit. An invalid item rejects the entire batch, not just itself.

`abandonAdmission({namespace,client,eventId,payloadDigest,token})` expires only a
matching live owner. A stale attempt returns `{abandoned:false}` and cannot
cancel a successor. A successful abandon permits a fresh same-digest claim.

## Retention, trust and boundaries

Completed outcomes retain only identifiers/counts and key/digest state, not a
cached memory body or transcript. Reclaim after correction or forgetting returns
the recorded IDs; those IDs can now identify forgotten records. It never returns
forgotten content. A new event key cannot bypass fingerprint suppression.

Opaque keys and hashes are not encryption. Digest/key/outcome records persist;
there is no admission-ledger pruning policy in this slice. Lease tokens are
internal coordination capabilities, not network authentication. The embedding
host selects namespace and enforces caller authorization. Existing local file
trust, redaction and [retention limitations](local-store.md) still apply.

Claim and abandon do not modify the namespace memory epoch, so an in-progress
capture alone does not invalidate map/list/fetch cursors. Material memory commits
use the same per-admission epoch rules as the existing store. A multi-item batch
can advance the epoch more than once within its one atomic transaction.

## Upgrade and verification

Opening v1/v3/v4/v5/v6 databases atomically upgrades to schema v7. Existing memory,
source IDs, suppression, MOC membership, epochs and cursor identity are retained.
Old v1/v3/v4/v5/v6 binaries cannot open v7; draft v2 and unknown databases remain
unsupported. Back up meaningful files with writers closed before upgrading;
there is no downgrade tool or production migration in this change.

Run `npm run demo:admission` from a checkout on Node >=22.16. It uses only
synthetic data and no model. Tests exercise process races, stale owners, replay,
rollback and migration. These prove storage coordination, not extraction quality.
The [acceptance spec](plans/admission-claims.md) and
[delivery roadmap](plans/delivery-roadmap.md) define the next steps.
