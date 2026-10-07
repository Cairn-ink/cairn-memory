# Fresh-thirty metadata selector and source reader

Status: contract recorded before implementation; private synthetic source/test
freeze complete, primary acceptance and independent review pending. No authentic selection,
preparation, ledger change or paid execution is authorized by this packet.
Base `b9a4a52a5c21b3fda41ae8dbee17c4f8852acf26`, worktree
`fresh-thirty-source`, branch `test/fresh-thirty-source`.
Author: delegated GPT-6.1 Sol/high. Primary owns integration, actual supplied
exclusions, source selection, future runtime binding and independent reviews.

## Contract

- T1: A metadata-only selector accepts exactly 500 inventory rows with only
  `sourceQuestionId`, `questionType`, and `structurallyEligible`. Fixed quotas
  are `[6,6,0,6,6,6]` in the original six-type order. Preference is not covered.
  Preserve seed `cairn-fresh-six-20261006-tokenfit-v1`, ranking domain
  `cairn.private.fresh-six.source-ranking.v1`, and SHA256 of
  `JSON.stringify([domain, seed, type, id])`. Rank and tie comparisons use JS
  string `<`/`>`, not locale or UTF-8 byte ordering. Return exactly 30 IDs in
  inventory/dataset order, with alternating Cairn/Mem0-first orders (15/15).
  No question, answer, content, replacement seed or arbitrary quota is accepted.
- T2: Reject proxies before reflection, getters without executing them, holes,
  symbols, extra fields, duplicate/invalid inventory IDs, and unsorted,
  duplicate or out-of-inventory exclusions. Use every supplied exclusion;
  never infer or repair a historical exposure union or resample a failed cohort.
- T3: Use separate fresh-thirty v1 selection, eligibility and exposure schemas;
  retain the existing audited-exclusions schema. The reader checks all 30
  selected IDs, opaque mapping, file hashes/sizes/order, source pins, revision,
  quotas, seed/domain, selection hashes and exact supplied-exclusions-plus-
  selected exposure union. Validate every model-facing row, including row 29.
  Retain finite bounds: receipts 1 MiB each, history 128 MiB, questions 2 MiB,
  evaluator metadata 8 MiB, declared original input 512 MiB. Escalate before
  enlarging any bound. Evaluator may be statted but never opened/read/hashed.
- T4: Tests use real public prepared-v2 synthetic fixtures with 30 rows.
  Exercise last-row malformed content, missing/extra/reordered/tampered files
  and records, changed source/policy/selection/exposure pins, and evaluator-read
  traps. Six type names and future native `topK:6` are not cohort constants.
  Previous-six corroboration and launcher/operator behavior are out of scope.
- T5: Canonical runner and `createTestWorkspace` own cleanup on success and
  failure. Exact Node22.16.0 and Node24.15.0 must report actual exits and skips.
  Retain a feature RED: original selector succeeds on valid metadata and returns
  6 while the new acceptance expects 30; import/setup failures do not count.
  Freeze the new private code-only source inventory and SHA256 manifest using
  two independent mechanical filename routes, with actual synthetic suite exits.

## File and caller map

Private root `/tmp/cairn-fresh-thirty-source.CXFeV4Z8`:

| File | Responsibility |
| --- | --- |
| `source-only.mjs` | `selectFreshThirty`, constants, strict prepared-v2 `readSource` |
| `private-io.mjs` | Only bounded read/hash/stat, own-data validation and freezing; no output/controller hooks |
| `synthetic-fixture.mjs` | Owned 500-row synthetic input and public prepared-v2 30-row artifacts/metadata |
| `source.test.mjs` | T1–T5 positive/negative, evaluator traps and cleanup coverage |
| `suite.mjs` | Canonical script entrypoint for private synthetic tests |
| `SOURCE-SHA256.json` | Frozen implementation/test filenames and SHA256, not operational authority |

Public edits are only this plan and a small `docs/limitations.md` appendix.
Original private files remain untouched. No public runtime, dependency,
preparation producer, resource projection, guard, callback, operator, launcher,
supervisor, key, evaluator or ledger implementation changes are permitted.

The selector is pure. Reader paths and pins are explicit caller input, never
defaults. Synthetic fixture calls public `prepareLongMemEval` only for synthetic
test artifacts; this packet has no authentic preparation entrypoint.
Strict model-facing shape validation does not duplicate public capture planning
or certify semantic eligibility. No supplied 500-row inventory or historical
union is authenticated by these helpers. Hashes are integrity metadata, not
signatures; same-UID hostile mutation is not an isolation claim.

## Verification evidence

The actual feature RED used only the old pure selector on valid generated
500-row metadata. It first asserted the returned count was six, then failed the
new thirty-count assertion: Node24 chunk `e08063`, actual exit 1, one genuine
assertion failure, no skips. The test was subsequently replaced by the green
fresh-thirty suite; no old operator or old synthetic fixture was executed.

Initial new-suite Node24 `4e0471` exited 1 (8/9): the test expected the wrong
finite category for a malformed descriptor hash. After correcting that
expectation, Node22 `0c8d73` and Node24 `a398c2` each exited 1 (8/9):
appending a byte exercised a size mismatch before the intended hash fence.
The test now corrupts a same-size byte; reader validation was not relaxed.
Expanded final coverage includes coherent rehashing of eligibility/exclusions,
malformed row 29 and mapping, namespace/getter/file-mode/symlink failures,
UTF-8/newline faults, receipt/declared size caps, evaluator open/read traps and
success/failure cleanup. Same-size synthetic evaluator corruption remains
deliberately unverified: the reader never opens it.

Final canonical command (replace both Node24 path occurrences with Node22.16.0
for that version):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --script /tmp/cairn-fresh-thirty-source.CXFeV4Z8/suite.mjs
```

Node22.16.0 `b0a53c`: 12/12, zero skips, actual exit 0 (500.100312 ms).
Node24.15.0 `d65eef`: 12/12, zero skips, actual exit 0 (457.777674 ms).
No adapter dependencies, native installation, provider or authentic data were
needed. Registered fixture teardown and explicit cleanup assertions passed.
No public runtime file changed; generic/contributor acceptance remains
primary-owned, and these helper tests do not replace future integration gates.

Private source/test pins:

| Owned file | SHA256 |
| --- | --- |
| `source-only.mjs` | `010a005c6da090c77608a21da934fd89af56f1c16b4df7c5f16b0e57c5e79ca9` |
| `private-io.mjs` | `74a8d58e6d1d72238ea614dcf2f8bf1a28b6fcb78a0d1da350d8291c81be0709` |
| `synthetic-fixture.mjs` | `ad68f599d6b7364f01bd5a4cd1b20e6f1a08db2495a5d83cf84a225d68e86037` |
| `source.test.mjs` | `81a8a7e35aec476adc567128bd563b5cc528c56bb25abd4324e655c183b57186` |
| `suite.mjs` | `d9a77f335e5ed07a80fa31f19e1fb61b4d65be4a79b4dd6c4d0fdfed8e1957e6` |

Original read-only reuse inputs under
`/tmp/cairn-six-tokenfit-operator.kuCzNA24` retained the exact same hashes before
and after implementation:

| Original file | SHA256 |
| --- | --- |
| `source-only.mjs` | `a4bc555723b38b144e862bff8204ed0d466738091469ca6bed66373bd3c82556` |
| `private-io.mjs` | `2a418fcc92814ac4c1b0942a0550f5772c0d187c45445ce56ee8bbb40dac0338` |
| `source.test.mjs` | `78b46fc8f56ead656ef8bc073320d66f6e3158cdaadcee85b0035a8fd608b429` |
| `synthetic-fixture.mjs` | `5468280273c42b6af93c9b6fde65994a5a7c65bf6efb12a28ba9f9b73fd79e05` |

Freeze inventory is five private source/test files plus this contract and the
limitations appendix (seven records). `SOURCE-SHA256.json` excludes itself:
eight delivered files total, six private and two public documents. Two
mechanical enumeration routes must agree and every record hash must verify.
This is a helper-source freeze, not a full future launch inventory or authority
to read actual sources, select a cohort, write a ledger or run a comparison.
