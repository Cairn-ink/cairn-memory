# A-6.1 expected-case binding — tests pass; recertification stopped

The interrupted a6e run is discarded as certification evidence. Its verification
record is explicitly marked discarded and is not reused. This new attempt ran
**directly and unlocked**, as authorized. No network, keys, paid calls, new paid
reservations, freeze or commit. No numerical limit, margin, model, call-plan,
price, retry or semantic scoring rule was changed.

## Migration

- `trivia-authority-a6.mjs` constructs the authority from an independently fixed
  generator-freeze pin, then constructs both proof and separate expected-case
  token from trusted family/checkpoint data. Case IDs include family, checkpoint,
  question and query identity; all arms share one observation's identity. Neither
  candidate answers nor support metadata choose the target or authority.
- `inputs.mjs:21` returns `{gold,scoringOptions}` through `scorerCase`. The opaque
  token stays outside gold, answers and delivery schemas. JSON replay rebuilds
  authentication from the original frozen family/support data.
- `runner.mjs` and `integration/mechanical.mjs` pass scoring options explicitly
  into `scoring-a6.mjs`. Its guard requires authenticated proof/expected-target
  correspondence before scoring. Missing, forged, cloned or mismatched tokens,
  replayed proofs, and mismatched actual questions are errors rather than silent
  loss of trivia allowances. Invalid registry authentication also throws before
  building generator gold.
- `integration/adapters.mjs` returns separate scoring options, preserves opaque
  proof identity, and requires independently supplied trusted family/checkpoint
  context for challenge sources carrying trivia. Empty-trivia engineering worlds
  receive a separately registered opaque target that permits only fully protected
  scoring; it cannot authorize any nonempty proof or declared offset. Missing
  options still error. No target is inferred from proof or candidate metadata.
- All production harness/integration score calls enter the shared guard. The only
  direct scorer invocation is inside that guard. The only producer-trivia adapter
  call uses the complete four-argument binding. No declared-offset licensing path
  or legacy three-argument consumer remains.

## Fresh verification and actual exits

`node evaluation/hr3/harness/verify-a6.mjs` exited **1**, status
`FAIL_STOPPED_AT_FIRST_FAILURE`. Artifacts:
`artifacts/a61-case-verification-VGBcOh/`. Commands/log hashes and protected-source
entry bindings are recorded in `reports/a6-verification.json`. Protected inputs
are rechecked after every command; all **139** remain unchanged in this attempt.

| Command | Result | Actual exit |
| --- | --- | ---: |
| strict-schema | PASS | 0 |
| published-schemas | PASS | 0 |
| private-field-inventory | Emitted 217 fields; not a passing complete privacy certificate | 0 |
| inspected-references | PASS | 0 |
| runtime-closure | Both import-closure routes agree | 0 |
| authenticated-consumers | **12 passed / 0 failed / 0 skipped** | **0** |
| context-certificate | **FAIL: `private_label_leak:product-payload`** | **1** |
| Output/input/embedding and later certificates | Not run after first failure | — |
| Generator/scorer/integration/harness full suites | Not run after first failure | — |
| Full 480-answer fake pilot, complete leak scan and bound report | Not run after first failure | — |
| Reconciliation, derived certificate bundle and freeze | Not run after first failure | — |

The primary's 62/100 suite counts were not reproduced by this stopped attempt.
No old numerical certificate, old suite count, partial scan or a6e result is
relabelled as current certification. No certified request/output/embedding maxima
are claimed for the changed runtime.

## First failure: public formatter/private authoring key collision

The new recursive inventory correctly discovers an authoring variable named
`record` at:

```text
private_generator_support.optional_trivia.emission_inputs[].variables.record
```

It classifies that leaf name as private. Existing `product.mjs:18` also uses
`record` as the public formatter's neutral record-alias field (`r1`, etc.).
`public-paths-a4.mjs` has no public formatter allowance for this field.
When `contextConformance` tries the first P admission at `product.mjs:122`,
PrivacyGuard rejects the serialized formatter header in the admission payload.

A read-only, independent payload-shaped diagnostic reproduces exactly:

```json
[
  {"kind":"private_metadata_key","label":"record","path":"$wire"},
  {"kind":"private_metadata_key","label":"record","path":"$/memory/content"}
]
```

This identifies a key-name collision; it is not evidence that the private identity
registry or trivia proof was actually delivered. The guard nevertheless fails,
so certification stops. The formatter, P blocks, evidence, inventory and allowlist
were **not changed after failure**, and the certificate was not retried. The
collision needs resolution under explicit public format/schema/path rules;
no blanket exemption or evidence deletion was introduced.

One initial read-only diagnostic tried importing the P module without installed
resolver configuration and exited 1 with `ERR_MODULE_NOT_FOUND`. The subsequent
payload-shaped PrivacyGuard-only diagnostic exited 0 and reproduced the above
hits. Neither diagnostic dispatches anything or reruns a certificate.

## Regression evidence

All names below are separate tests in `test/trivia-consumers-a6.test.mjs`, and all
passed in the fresh focused run:

1. Harness and integration retain opaque freeze-bound proofs in every language.
2. Candidate offsets and changed source tapes never grant a license.
3. JSON source replay reauthenticates; cloned normalized proofs remain protected.
4. Challenge proof identity survives; declared offsets cannot license omission.
5. Fixed trusted pin and sole complete adapter; no declaration fallback.
6. Private authentication/identity metadata is rejected from visible inputs.
7. Runtime embeddings reject private identity metadata before dispatch.
8. **Real harness scoring path tolerates authenticated final `.` / `。` omission**, with R=J=1 in both languages.
9. **Cross-family replay is denied** under the same pin and trusted question/query; direct coverage grants zero licenses and the harness guard errors.
10. **Checkpoint/query replay is denied**, while arm-independent target bindings agree for the same observation.
11. **Missing, forged and cloned bindings error**, including an attempted fully-protected downgrade.
12. Changed actual question errors despite genuine proof/expected-token objects.

These tests exercise the same verified-input projection and guarded scoring path
used by the runtime. They are mechanical plumbing tests, not new research calls,
calibration data or semantic-quality claims. They add no post-submission repair.

## Accounting, scope and manifest

The preparation record remains primary-supplied and complete. No real ledger,
carry manifest or receipt was changed. Approved arithmetic remains **$38.342656
incremental**, **$42.487733720 cumulative**, including the **$4.145077720** carry;
the $50 cap and existing embedding counters are unchanged. The verifier stopped
before regenerating these reports, so these are unchanged approved values, not a
newly passed certificate from this attempt.

Only `harness/` and `integration/` were edited. Protected source hashes were
checked independently at the end and match all 139 entry files. `git diff
--check` exits 0. The cumulative `reports/a6-changes.json` is regenerated by Git
inventory/Python SHA-256 and an independent Dirent/Node SHA-256 route, followed
by a canonical inventory diff. Its self-entry uses null size/digest. It includes
reports, tests, fixtures, schemas, docs and ignored artifacts; no protected
sibling edits are attributed to this task. The primary still owns the locked
rerun, non-author acceptance and final freeze.
