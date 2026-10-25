# P2-1 stripping-variant repair: 123 tests

Read the third non-author recheck first. It accepted the original CLI repair but
found that empty candidate metadata still selected unlicensed scoring without
independent authority. This repair applies the primary's clarified rule to every
supported A-6 gold. Only `scorer/` was edited; no commit, network/paid/model call,
keys, pilot material, sibling edits or sibling test suites.

## Binding rule and exact-target no-trivia authority

The exported scorer now requires authentication unconditionally after structural
gold validation. Empty registries no longer select a fallback. An absent registry
remains a structural authoring error; either way, no score is emitted. The CLI
calls the same guard, including its malformed-reader path. Binding errors throw
`TypeError` with `ERR_HR3_TRIVIA_BINDING`; CLI errors exit 1 and leave previous
output untouched. Licensed calls still require the original proof and independent
`triviaCase` token and preserve final-stop/joining-space tolerance.

A separately pinned no-trivia catalog may authorize empty metadata for one exact
source target. It uses the existing harness authority format:

```text
{
  version: "hr3-independent-slot-no-trivia-a6-v1",
  cases: [{family, caseId, question, sourceSHA256, goldSHA256, trivia: "none"}]
}
```

Both root and records are closed, hashes must be SHA-256, and duplicate target
identities are rejected. `sourceSHA256` hashes the complete original trusted
source target; `caseId` must equal `target.id + "/source/" + sourceSHA256`.
`goldSHA256` hashes complete expected scoring gold. Object hashes use the existing
canonical JSON function, which matches the harness's canonicalization. The
catalog's whole-file pin is supplied independently, never derived from candidate
gold, submission or a candidate-declared digest. No target can append a record at
runtime. A generator freeze cannot act as a no-trivia catalog.

`createUnlicensedTriviaAuthority(bytes,primaryPinnedSHA256)` validates the pin and
stores an immutable detached catalog privately. Then
`createUnlicensedTriviaCase({authority,target:expectedSourceTarget,gold})` requires
an exact reviewed record, source/case/question equality and complete gold hash.
It binds an opaque token to the exact gold object and record. Every score checks
both object identities, the question and current hash. Other families/cases,
cloned tokens/gold, changed source targets and mutated gold fail. Registering a
JSON-loaded gold object again requires the original independent expected target
and catalog. A gold object cannot be retargeted after capability issuance.

Pass the resulting token separately as `{unlicensedCase}`. Supplying both modes
is an error. Successful no-trivia authentication reports
`supportAuthentication.status:"authenticated_unlicensed"`, authority digest and
opaque case hash. It grants zero optional positions: protected punctuation,
semantic coverage, C/O, factual-negative R and referrals retain their existing
behavior. No authentication failure is converted into R=0.

## Exact harness and CLI interfaces

Licensed harness/integration callers need no new input and continue passing
`{triviaCase}`. Their own guards can remain. No-trivia callers must replace or
translate their harness-only opaque exemption token with a scorer-issued token:

```js
import { createUnlicensedTriviaAuthority, createUnlicensedTriviaCase }
  from '../scorer/support.mjs';

// Independent reviewed catalog bytes/pin, not candidate-derived values:
const authority = createUnlicensedTriviaAuthority(catalogBytes, primaryPinnedSHA256);
const unlicensedCase = createUnlicensedTriviaCase({
  authority, target: trustedOriginalWorld, gold,
});
const result = score(gold, submission, {unlicensedCase});
```

The existing harness `UNLICENSED_AUTHORITY_A6` record format is consumable without
changing records. If serialized from its fixed module, pin the chosen exact bytes
independently; do not compute the expected pin dynamically from a candidate.
The harness helper may store the scorer-issued token in its own WeakMap as well,
retaining its additional checks and returning the same token through its existing
`unlicensedCase` option. Bind the exact gold object that will reach scorer; cloning
it after registration fails. No harness files were edited or tests run here.

CLI flag names are unchanged. All supported A-6 inputs require:

```sh
node evaluation/hr3/scorer/cli.mjs --gold GOLD --answers ANSWERS --out OUTPUT \
  --trivia-binding BINDING --trivia-freeze FREEZE --trivia-freeze-sha256 PIN
```

For licensed targets, `BINDING` remains exactly
`{family,caseId,question,registry}` and `FREEZE` is the generator freeze. For
unlicensed targets, `BINDING` is exactly `{mode:"unlicensed",target}` and `FREEZE`
is the no-trivia catalog above. `PIN` is independently supplied in both cases.
Selection comes from this trusted separate file, never from gold metadata.

## Version policy and retained coverage

The published schema already admits only explicit `hr3-support-a6-v3`. Before
this repair it rejected all unversioned, unknown and downgraded support versions.
The historical pre-A-6 gold envelope in HEAD was unversioned, and no explicit
legacy support-version interface is registered. That rejection behavior is
preserved: no guessed A-4 version or shape-based legacy mode is introduced.
Relabeling A-6 gold with a legacy-looking string fails even when trivia metadata
is also removed. Missing `supportTrivia` is still a gold-schema error, including
with a binding. This closes downgrade paths without inventing legacy semantics.

Scorer/seed and dependence keys advance to `hr3-scorer-a6-v7` and
`hr3-a6-slot-explanation-keys-v7`; wire/schema versions remain support/trivia v3.
The new no-trivia status, authority and exact-case hashes enter existing key
provenance. Judge projections, resolver, coverage arithmetic and schema files
are byte-identical to entry.

All **110 existing test names, files and relative order** remain; no removal,
rename, merge, replacement, skip or todo. Existing no-trivia test authors now
provide their independent test-author catalogs and tokens. Their exact factual,
citation, referral and negative-R cases are retained. Test-only snapshot helpers
create a fresh authored target for each intentional gold revision; production
never signs candidate gold or downgrades authentication. The historical
`rejectedThenProtected` helper first asserts original-call rejection and zero
licenses as before; its separate explicitly unlicensed coverage witness now also
has a reviewed test-author record. One status assertion advances from protected
to authenticated_unlicensed for that authorized witness. Original malformed
proof/target inputs remain rejected. The accepted coverage audit is unchanged.

Thirteen tests are added: nine in `test/unlicensed.test.mjs` and four appended to
`test/trivia-cli.test.mjs`. They cover English/Chinese stripping through API and
CLI, absent metadata, exact frozen no-trivia positives, protected final stops,
factual-negative R, other-family and same-family/different-source replay,
cloned/mutated gold and tokens, bad pins/catalog records, generator authority
misuse, legacy-version relabeling and conflicting bindings. Genuine licensed
answers still give R=1; stripping them now errors rather than yielding R=0.

## Verification and changed files

- Initial five-file focused run: actual exit **1**, **55/61 passed**. Six fixture
  failures attempted to bind changed gold to an already issued object capability.
  Test-author snapshots were corrected; production retarget rejection remains.
- Repeated focused run on `unlicensed`, `trivia-cli`, `scorer`, `contract` and
  `schema-cli` test files: actual exit **0**, **61 passed**, no failures/skips.
- First full scorer run: actual exit **1**, **122/123 passed**. The remaining old
  status assertion expected protected for the helper's newly authorized witness;
  it now asserts authenticated_unlicensed. Original input rejection/zero grants
  are still separately asserted.
- Final full scorer command:
  `node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs`:
  actual exit **0**, **123 passed, 0 failed, 0 skipped** (ten test files).
- All **21** scorer JavaScript files: `node --check FILE`, each actual exit **0**.
- `git diff --check -- evaluation/hr3/scorer`: actual exit **0**.
- Test inventory compared against entry: all 110 existing name/file/order entries
  retained, 13 additions, actual exit **0**.
- Independent Python recursive SHA-256 inventory and Node directory-walk/crypto
  inventory agree on **13 changed files** and match the report list exactly.
  Both include tracked and untracked files: 26 at entry, 28 final. All 28 files
  pass the recursive whitespace and absolute-local-path scan, actual exit **0**.

Changed files this repair, relative to `scorer/`:

- `README.md`
- `REPORT.md`
- `cli.mjs`
- `scorer.mjs`
- `support.mjs`
- `test/contract.test.mjs`
- `test/schema-cli.test.mjs`
- `test/scorer.test.mjs`
- `test/trivia-cli.test.mjs`
- `test/trivia-fixtures.mjs`
- `test/trivia-target.test.mjs`
- `test/unlicensed-fixtures.mjs` (new)
- `test/unlicensed.test.mjs` (new)

This implements the primary's explicit A-6 binding decision, retains A-6 §5
coverage and provenance restrictions, and versions the prospective scorer/keys
under §7. No automatic punctuation license or unsupported legacy interpretation
was added. Independent re-review remains the primary's process.

---

# P2-1 public scoring authentication guard: 110 tests

Read the second trivia recheck first. It closes the replay P1 and identifies
that the standalone CLI bypassed the caller guard, silently converting serialized
trivia-bearing gold to fully protected coverage and an R zero. This repair is
restricted to `scorer/`. No commit, network/paid call, keys, pilot material or
sibling-directory edits; no harness, integration or generator suites were run.
The separate harness unlicensed-exemption finding is outside this write scope.

## Public behavior and trusted CLI input

The exported `score(gold,submission,options)` now enforces authentication itself.
Trivia-bearing gold, failed in-process adapters (including their empty output),
and any explicitly supplied target token must compile as authenticated. Otherwise
it throws `TypeError`, code `ERR_HR3_TRIVIA_BINDING`, before reader validation.
Malformed/exhausted reader output cannot hide the authoring error. The CLI uses
this guarded function on both its normal and malformed-reader paths. There is
no other exported scorer verdict function in this directory. Bundle/schema and
coverage utilities do not emit scores; the low-level compiler continues to return
an all-protected diagnostic predicate on authentication failure.

For serialized gold the CLI accepts three additional, separate trusted inputs:

```sh
node evaluation/hr3/scorer/cli.mjs --gold GOLD --answers ANSWERS --out OUTPUT \
  --trivia-binding BINDING --trivia-freeze FREEZE --trivia-freeze-sha256 PIN
```

`BINDING` has exactly `{family,caseId,question,registry}`: independently expected
complete family/case/question from trusted dispatch plus the generator's original
private emission registry. `FREEZE` holds the per-family handles. `PIN` must be
the primary's independent exact-byte SHA-256, supplied as a CLI argument, never
derived from gold, submission or the binding file. All three flags are required
together. Input/output paths must differ. The CLI loads the exact generator rule
file and uses the existing authority, target-token, adapter and verifier APIs.
It verifies the actual gold question/source spans, and requires the hydrated
normalized proof to exactly equal serialized gold metadata before scoring.
It never repairs gold by substituting another registry or stripping licenses.
Missing/forged/mismatched authentication exits 1 and leaves output untouched;
malformed trusted JSON is an error, not malformed reader output. With a valid
binding, punctuation-only omission of licensed stops/joining spaces still passes.

No-trivia gold (explicit null producer and empty rules/positions) keeps its prior
behavior without a binding. Supplying any target/binding still requires valid
authentication. The caller remains responsible for supplying expected dispatch
identity independently; neither the answer nor gold can establish authority.
Existing trusted programmatic callers need no new option: continue passing the
opaque `{triviaCase}` separately. They now get an error instead of a protected
score if proof or target identity is lost. No sibling callers were changed.

Scorer/seed advances to `hr3-scorer-a6-v6`, dependence keys to
`hr3-a6-slot-explanation-keys-v6`. The unchanged support wire/schema remains
`hr3-support-a6-v3` / `hr3-trivia-a6-v3`. Successful coverage arithmetic, exact
citation resolution, C/O semantics, factual-negative R, referrals and private
judge projections remain unchanged.

## Test retention and focused additions

All **100 previous test names, files and order** are mechanically retained; none
was removed, renamed, merged, skipped or replaced. Ten tests are added in
`test/trivia-cli.test.mjs`, covering:

1. English/Chinese serialized trivia gold without a binding: error, no output.
2. Forged freeze pin/handle, family, question, emission registry and token file.
3. Valid English/Chinese bindings: licensed final stops/joining spaces, R=1.
4. No-trivia scoring and malformed-reader behavior unchanged.
5. Partial binding flags and attempts to supply a self-declared pin in JSON.
6. Altered/stripped normalized gold metadata and mismatched source origins.
7. Malformed reader/binding JSON cannot hide authentication errors.
8. Valid binding with malformed reader JSON: attempted zero observation.
9. Programmatic missing/cloned/failed/replayed proof/target: error before scoring.
10. Public no-trivia behavior and rejection of explicitly invalid target tokens.

Existing adversarial cases are preserved exactly. Their original unauthorized
scoring calls now assert `ERR_HR3_TRIVIA_BINDING`. A clearly named test-only
`rejectedThenProtected` helper then creates an explicit no-trivia copy, keeping
the exact source/answer/delivery inputs to retain their earlier R/C/O, referral,
and invalid-citation assertions. It also checks that every original span position
has zero license. This fallback exists only in test code; production never clears
metadata or catches authentication errors to emit zero. Valid authenticated cases
continue calling the public scorer directly.

One historical assertion compared keys produced by two different unauthenticated
manual rule strings. Such public keys must no longer exist: both original inputs
are now asserted errors. Their explicit no-trivia copies share a key, as they
have identical licensed context. Authenticated-versus-unlicensed key separation
and exact case-bound key differences remain asserted by the existing key tests.
The accepted `TEST-COVERAGE-AUDIT.md` is byte-identical to the at-entry snapshot.

## Verification

- First focused run: actual exit **1**, **53/58 passed**. Five new stderr-message
  checks failed because sandbox child pipes returned empty streams/EPERM. The
  tests now use direct file descriptors for child stdout/stderr, and assert that
  subprocess creation itself has no error. Production error handling was not
  weakened to accommodate the environment.
- Repeated focused command, four trivia files including the new CLI file:
  `node --test --experimental-test-isolation=none` with those four explicit paths:
  actual exit **0**, **58 passed, 0 failed, 0 skipped**.
- Full scorer suite:
  `node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs`:
  actual exit **0**, **110 passed, 0 failed, 0 skipped** (nine files).
- All **19** scorer JavaScript files: `node --check FILE`, actual exit **0** each.
- `git diff --check -- evaluation/hr3/scorer`: actual exit **0**.
- Two independent baseline/final inventories (Python recursive paths/SHA-256 and
  Node explicit directory walk/crypto hashes) agree on **10 changed files**, no
  missing or extra paths. Both include tracked and untracked files. Original
  inventory: 25 files; final: 26. A recursive whitespace/local-path scan checks
  all 26, including untracked files.

Changed files this repair, relative to `scorer/`:

- `README.md`
- `REPORT.md`
- `cli.mjs`
- `scorer.mjs`
- `support.mjs`
- `test/trivia-cli.test.mjs` (new)
- `test/trivia-fixtures.mjs`
- `test/trivia-regression.test.mjs`
- `test/trivia-target.test.mjs`
- `test/trivia.test.mjs`

The implementation follows A-6 §5's authenticated provenance requirement and
§7's prospective versioning. The independent recheck specifically requires
configuration errors for trivia-bearing scoring rather than silent protected
zeros; low-level zero-license diagnostics are retained. No protocol ambiguity
was resolved by adding a license or changing semantic coverage.

---

# Target-case proof binding repair: 100 tests

The re-review was read first. It accepted the original P1-1/P1-2 repairs and
the restored-test audit, but found authentic cross-family proof replay: source
bytes and local origin positions alone did not establish the target case. This
repair changes only `scorer/`; no harness, integration, generator or protocol
files were edited. No commit, network/paid call, key read, pilot replay or world
generation. The independent engineering renderer fixtures remain source-only.

## Target binding

`createTriviaCase({family,authority,caseId,question})` creates a separate opaque,
immutable token from trusted dispatch/checkpoint data. It snapshots the expected
complete family and resolves its exact handle from the expected pinned authority;
family, lineage, seed, namespace and source hashes must agree with that handle.
The expected target is not inferred from a candidate proof or producer metadata.

Proof registration now requires the same caseId and question in addition to
family/authority. `score(gold,submission,{triviaCase})` passes that independently
supplied token and the actual gold question into compilation. Compilation
requires exact expected/proof family, handle, freeze pin, case ID and question
agreement, then re-runs the generator verifier against the **expected** family
and handle. Missing/mismatched/forged/cloned target tokens grant no license.
Source maps qualify origins by family; license keys qualify them by family,
handle hash, case hash, local origin and position. Wire citation addresses and
local origin strings are unchanged. Another family's identical bytes cannot
supply a license to the target family.

Different checkpoints/queries in one family need distinct case IDs; the same
observation shares one ID across arms. Another case's proof is denied even with
the same family, handle, question and source bytes. A changed question is also
denied, including when a caller accidentally reuses a case ID. Actual scorer
output reports only opaque binding hashes/status, never private target IDs or
handles in judge bundles. Support keys include the expected case hash.

## Exact harness/integration interface change

From trusted dispatch data, independently of the proof:

```js
const caseId = `${family.family_id}/batch/${checkpoint.batch}`;
const question = checkpoint.question;
const binding = {family, authority, caseId, question};
const triviaCase = createTriviaCase(binding);
gold.supportTrivia = adaptGeneratorTrivia(
  supportRow.optional_trivia, exactRulesBytes, originalSourceTurns, binding,
);
const result = score(gold, {answer, delivered}, {triviaCase});
```

`authority` is still created through `createTriviaAuthority` from the independently
pinned freeze. Add a query discriminator to caseId if one checkpoint asks more
than one question. The factory resolves the expected handle itself; do not copy
one from the proof. The target token belongs only in score's third argument,
alongside existing options such as contractPath. It does not belong in Answer,
gold metadata or delivery schemas.

The current harness `authenticatedGeneratorTrivia(family,registry)` helper must
accept caseId/question, pass the complete binding to the adapter, and return or
retain the separate triviaCase token. Integration must preserve proof/token
identity in-process and runner must pass `{triviaCase}` to score. Rebuild both
after loading JSON; serialized/cloned tokens or proofs grant none. Direct
compiler callers use `compileTrivia(registry,spanMap,triviaCase,actualQuestion)`.
Until migrated, callers without expected target data get fully protected spans.
These downstream callers were read to document the migration, not edited or
included in tests.

## Versions, regression protection and new tests

Support schema and normalized registry advance to `hr3-support-a6-v3` and
`hr3-trivia-a6-v3`. Scorer/seed and dependence keys advance to
`hr3-scorer-a6-v5` and `hr3-a6-slot-explanation-keys-v5`. The producer's approved
v2 registry and authentication verifier are unchanged. C/O, factual-negative R,
exact citation resolution, semantic coverage and existing referrals are retained.

Every one of the **91 existing tests** remains in its original file, with its
exact name and order. None was removed, renamed, merged or replaced. Existing
trivia test setup now supplies the independent target; one hard-coded version
assertion advances with the versioned schema. Direct positive compiler calls
supply target/question, and older invalid-authentication setups include their
valid case fields so the original adversarial condition remains exercised.
The accepted TEST-COVERAGE-AUDIT is unchanged.

Nine tests are added in `test/trivia-target.test.mjs`:

1. English reviewer cross-family replay under one shared freeze authority.
2. Chinese counterpart under that same-pin arrangement.
3. English same-family/different-case replay with identical question/handle.
4. Chinese same-family/different-case counterpart.
5. Same-family/different-handle replay with identical bytes and case ID.
6. Registered proof versus expected/actual question mismatch.
7. Missing, forged and cloned expected-case tokens; no proof-owned fallback.
8. Exact expected family snapshot and immutable token/caller-mutation checks.
9. Case-bound support keys with identical answer/delivery and no judge leakage.

For the reviewer pair, A's single emission yields R=0; B's genuine two-edge
emission yields R=1 in B. Swapping B's genuine object into A now yields R=0 and
zero licenses in both languages, with C=O=1. B's legitimate score remains 1.

## Verification and file cross-check

- `node evaluation/hr3/scorer/test/trivia-target.test.mjs`: actual exit **0**,
  nine passed, none failed/skipped.
- `node --test --experimental-test-isolation=none` with both existing trivia
  test files: actual exit **0**, all 39 existing trivia tests passed.
- `node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs`:
  actual exit **0**, **100 passed, 0 failed, 0 skipped**, eight files.
- Name/file/order comparison against the at-entry snapshot: exit **0**, all
  91 prior tests retained; nine additions. No failing test run occurred.
- `node --check FILE`: actual exit **0** for each of 18 scorer JavaScript files.
- `git diff --check -- evaluation/hr3/scorer`: actual exit **0**.
- Recursive whitespace/absolute-local-path scan: exit **0**, all 25 scorer files,
  including untracked files, no errors. Inventories run after tests finish.

Changed files are measured against this turn's at-entry bytes, not attributed
from the cumulative dirty worktree. Independent Python rglob/hashlib and Node
manual readdir/crypto snapshots each captured 24 files at entry. Their final
snapshots identify **11 changed files**, with zero differences; the
list below is mechanically enumerated and rechecked after report generation.
No processes remain running. Re-review and downstream recertification remain
external gates; this does not authorize paid execution.

- `README.md`
- `REPORT.md`
- `gold.schema.json`
- `schema.mjs`
- `scorer.mjs`
- `support.mjs`
- `support.schema.json`
- `test/trivia-fixtures.mjs`
- `test/trivia-regression.test.mjs`
- `test/trivia-target.test.mjs`
- `test/trivia.test.mjs`

---

Earlier reports, retained as historical records:

# Coverage-restoration follow-up: 91 tests

The P1 repair replaced all 22 prior trivia tests with 17 authentication tests;
the other 52 tests did not change. That caused the documented 74 → 69 drop,
and it lost several exact negative cases. The complete old-name/file to
replacement ledger, including missing assertions and changed security
preconditions, is in [TEST-COVERAGE-AUDIT.md](TEST-COVERAGE-AUDIT.md).

All 22 old test names and their explicit failure vectors are restored separately
in `test/trivia-regression.test.mjs`. All 17 authentication tests and all other
52 tests are byte-identical to the P1 delivery. No runtime implementation,
existing test, generator, harness or protocol file was changed in this follow-up.
The count is now **52 + 22 + 17 = 91**. Unsafe declaration-only positive R=1
expectations were not re-enabled; the audit explains those necessary expectation
changes, retains their coverage-arithmetic assertions, and asserts R=0 without
proof. Exact malformed quotes, protected-content omissions, metadata/wire drift,
fullwidth dots and half-surrogate truncations remain explicit failures.

Final command:
`node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs`.
Actual exit **0**: **91 passed, 0 failed, 0 skipped**, seven files.
The corrected restored-file run passed 22/22, exit 0. Its first diagnostic run
was 21/22, exit 1: an added check accidentally selected unknown context; it was
corrected to quote the original partial causal text, without changing runtime
behavior. Full details are in the audit.

Files changed in this follow-up, measured against the completed P1 snapshot:

- `REPORT.md`
- `TEST-COVERAGE-AUDIT.md`
- `test/trivia-regression.test.mjs`

Independent Python rglob/hashlib and Node readdir/crypto enumeration routes
agree on **3 files**, with zero differences. All 24 scorer files, including new
files, passed the whitespace/absolute-local-path scan; `git diff --check` exited
0. All 17 scorer JavaScript files passed `node --check` with actual exits 0.
No commit, network call or paid call. The prior repair report follows as a
historical record; its 69-test result is superseded by this follow-up.

---

# P1-1 authenticated trivia repair

Read the supplied non-author review first. Its verdict was “no”: the previous
scorer authenticated declared separator offsets/roles, not the actual production
emission. Forged boundaries could therefore turn a protected decimal point into
optional punctuation. This report covers this repair relative to the at-entry
snapshot, including pre-existing uncommitted A-6 files without attributing all
those earlier changes to this turn.

Edits are confined to `evaluation/hr3/scorer/`. No generator, harness, protocol
or sibling files were edited. No network/paid/model calls, keys, commits, pilot
replay or unattended processes. Generator verifier/renderer functions are used
only for authentication and independently authored engineering fixtures; no
research worlds are generated and no sibling test suite is run.

## Repair and trust boundary

- `createTriviaAuthority(freezeBytes, expectedSha256)` requires the primary's
  independently pinned freeze digest. It verifies that digest, producer/auth
  versions, rule digest and canonical family-handle-map digest, then privately
  retains a frozen detached handle map. Candidate-provided handles or hashes,
  copied authority fields, and lookalike objects are not authority.
- `adaptGeneratorTrivia(..., {family, authority})` looks up the freeze-bound
  family handle and calls the generator's `verifyFamilyTrivia` before deriving
  any licenses. The verifier authenticates the original tape and replays trusted
  templates/variables. The scorer compiles only the immutable returned registry,
  never declared candidate offsets, separator roles or a plausible alternative
  parse. The former three-argument adapter grants no licenses.
- Authentication is opaque private process state. Normalized producer fields,
  serialized metadata and cloned declarations are not proofs. The authenticated
  result is immutable; every compilation re-runs the generator verifier against
  the frozen handle and checks support spans against the authenticated source.
- Missing, forged or mismatched handles/authority/digests, literal substitutions,
  changed emission inputs, source mismatches and alternative parses grant zero
  licenses. The source span becomes fully protected; existing complete-support,
  contradiction and referral rules then determine R. Authentication failure does
  not erase independently valid C/O or factual negative-R observations.
- Score artifacts report `supportAuthentication` status and opaque binding
  hashes. Neither judge bundle receives the freeze, handles, original source
  tape or licenses. Keys include authentication provenance, preventing the same
  answer/delivery with different proof contexts from sharing a support key.

The externally trusted freeze remains the trust root, not a self-declared hash.
The primary/integration owner must verify frozen artifacts and pass the expected
pin independently of candidate submissions. The caller must authenticate again
when loading persisted JSON, preserving the returned authenticated object through
scoring. The current CLI has no authority input and therefore grants no trivia
licenses; trusted programmatic integration uses the documented four-argument
adapter. This fail-closed migration is intentional and documented in README.
There is no direct normalized-rule exemption for challenges.

## Versions and preservation

- Producer registry: `hr3-optional-trivia-a6-v2`; authentication handles:
  `hr3-trivia-auth-a6-v1`, consumed through the generator verifier.
- Scorer support schema: `hr3-support-a6-v2`; normalized registry:
  `hr3-trivia-a6-v2` with freeze/handle binding hashes.
- Scorer/seed: `hr3-scorer-a6-v4`; dependence keys:
  `hr3-a6-slot-explanation-keys-v4`.

These are prospective A-6 §7 identities. No earlier result was rescored or
pooled. The exact citation resolver, provenance maps, trivia-aware coverage
predicate, C/O canonicalization, answer/submission shapes, citation diagnostics
and factual-negative-R branches were preserved. Independently authenticated
provenance still uses the same completeness and extra-content checks and never
bypasses unknown-context referrals. Authentication does not itself establish
semantic correctness or independent license review.

## Adversarial and positive tests

The reviewer’s `Gauge 1.5 caused alarm.` case and its Chinese counterpart select
exact quotations omitting the protected decimal and final separator. Genuine
provenance yields R=0. The forged `edge`/`fact` boundaries now yield no licenses
and R=0 with C=O=1, without an unnecessary referral. English and Chinese valid
alternative parses of identical source bytes likewise receive no licenses under
the original pinned handle.

The tests also reject missing handles/authorities, forged/recomputed hashes,
wrong family/seed/namespace/source, changed rule bytes, literal/template/variable
substitution, changed positions, cloned proofs and direct normalized-license
injection. Mutation after verification cannot change the verifier's detached
snapshot. Exact-byte source mismatches cannot reuse another family's license.

Genuine pinned provenance still allows final `.`/`。` and source-production
joining spaces to be omitted. Punctuation-only spans score zero; missing causal
words, conjunction/sufficiency language and intermediate clauses score zero.
Unknown context and extra punctuation citations remain referrals. Decimal/dotted
identifier punctuation, signs/operators, Unicode normalization clusters and
truncated protected characters stay protected. Invalid address/quote/occurrence
semantics remain R-only failures. No pilot examples were copied; reviewer
counterexamples were reproduced as explicitly requested.

## Commands and actual exit codes

Node `v22.16.0`. Every exit was captured from the actual process, without a pipe
or a stdout-tail success inference. The user explicitly requested the scorer
suite; no repository-wide or sibling suite was run.

| Command/check | Actual exit | Result |
|---|---:|---|
| `node evaluation/hr3/scorer/test/trivia.test.mjs` | 0 | 17 authentication/coverage tests |
| `node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs` | 0 | 69 passed, 0 failed, 0 skipped, six files |
| `node --check FILE` for scorer `.mjs` files | 0 each | 16 files |
| At-entry file hashes and HEAD branch comparisons | 0 | retained semantics listed above |
| `git diff --check -- evaluation/hr3/scorer` | 0 | no tracked whitespace errors |
| Independent file inventories and recursive whitespace/path scan | 0 | counts below |

No failing test run occurred during this repair. No EROFS limitation was
observed: the complete scorer suite, including temporary-fixture CLI tests,
actually passed. Inventory checks run after tests finish, avoiding temporary
fixture races. Independent re-review/downstream recertification remains the
owner's next gate; this report does not authorize paid execution.

## Files changed this turn, independently cross-checked

At entry, two independent routes recorded scorer files: Python `Path.rglob`
with `hashlib.sha256`, and Node manual `readdir` traversal with `crypto` SHA-256.
Each captured **21 files**. Final snapshots are independently re-derived by
those routes, then diffed against their own baselines and against each other.
They identify **9 changed files**, zero differences. The final
scorer directory contains **22 files**, all included in the whitespace and
absolute-local-path scan, including untracked files. A separate scoped git
listing is retained only as cumulative worktree context; pre-existing A-6 and
sibling work is not mislabeled as this repair.

Mechanically enumerated paths, relative to this directory:

- `README.md`
- `REPORT.md`
- `gold.schema.json`
- `schema.mjs`
- `scorer.mjs`
- `support.mjs`
- `support.schema.json`
- `test/trivia-fixtures.mjs`
- `test/trivia.test.mjs`
