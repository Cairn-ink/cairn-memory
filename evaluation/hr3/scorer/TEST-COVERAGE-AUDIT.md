# Scorer test-coverage audit: 74 → 69 → 91

The 74-test baseline reported by the harness consisted of 52 unchanged tests
plus 22 trivia tests. During P1-1 I replaced the whole 22-test trivia file with
17 authentication tests: 52 + 17 = 69. This was not merely five tests removed,
and the lower count was not justified. Several exact negative cases were lost.

All **22 old test names** and their explicit negative vectors are now restored
individually in `test/trivia-regression.test.mjs`. The 17 P1 authentication tests
in `test/trivia.test.mjs` remain unchanged. The other 52 tests remain unchanged.
The final count is **52 + 22 + 17 = 91**, across seven test files. No runtime
implementation was changed for this coverage restoration.

## Complete old-to-new ledger

Every old test below originally lived in
`evaluation/hr3/scorer/test/trivia.test.mjs`. “P1 replacement” refers to the
69-test state, before this restoration. N-codes resolve to exact P1 test names
in the next table. “None” means the exact assertion did not survive, even if a
related category was still tested. Every row now has a separate restored test
with the **same old name** at the linked location; none remains merged away.

| # | Old name (original file above) | P1 replacement / assertion coverage before restoration | Restored test |
|---|---|---|---|
| 1 | A-6 schema/key versions are explicit; missing/stale private licenses fail closed | N1: Missing supportVersion and stale trivia version: **none** of the old rejection assertions survived. | [same name](test/trivia-regression.test.mjs#L68) |
| 2 | positive/negative pair: punctuation omission passes, missing causal words fails | N2, N3: Merged conceptually; the exact Ice/cobalt punctuation-versus-caused pair was not retained together. | [same name](test/trivia-regression.test.mjs#L79) |
| 3 | interior literal comma/whitespace omission uses source-position unions, not string deletion | N8: Altered-quote class remained, but exact Icetogether… concatenation and interior separator arithmetic: **none**. | [same name](test/trivia-regression.test.mjs#L86) |
| 4 | conjunction language stays protected while separators can be omitted | N3: Joint-production conjunctions remained; exact and/together/only when both omissions: **none**. | [same name](test/trivia-regression.test.mjs#L96) |
| 5 | every serial intermediate and required edge survives punctuation coverage | N3: Merged into one combined source span; the old two-record intermediate/edge omission assertions were absent. | [same name](test/trivia-regression.test.mjs#L104) |
| 6 | OR-of-AND graph/support alternatives retain complete requirements | None in the 17 new trivia tests: The unchanged scorer OR-of-AND test covered the category, but not this authenticated omission/alternative pair. | [same name](test/trivia-regression.test.mjs#L111) |
| 7 | focal-change association cannot be omitted, and a different change never auto-passes | None: Exact omitted cobalt association and amber-handoff selection were lost. | [same name](test/trivia-regression.test.mjs#L119) |
| 8 | extra clauses and even punctuation outside licensed support remain referrals | N5: Merged; exact Dust clause, Chinese comma and whitespace extra-selection cases were absent. | [same name](test/trivia-regression.test.mjs#L129) |
| 9 | an extra punctuation-only citation cannot be discarded even with a provenance rule elsewhere | N5: Extra punctuation remained, but the added private other-source optional-position attempt was absent. | [same name](test/trivia-regression.test.mjs#L138) |
| 10 | positive/negative pairs protect decimal points, dotted identifiers and operators | N6: Merged; exact 7.25, Record gx.delta, and 7/8 omission cases were absent. | [same name](test/trivia-regression.test.mjs#L149) |
| 11 | question/exclamation/quotation/apostrophe/hyphen/parenthesis punctuation is protected | N6: Merged; exact closing quote, closing parenthesis, plus and colon cases were absent. | [same name](test/trivia-regression.test.mjs#L160) |
| 12 | whitespace is optional only when predeclared as a template separator | None: Exact leading/trailing space-newline-space case and empty-license negative were lost. | [same name](test/trivia-regression.test.mjs#L168) |
| 13 | Unicode source maps preserve protected words, values, and indivisible normalization groups | N7: Merged; exact Chinese causal-word omission and fullwidth identifier-dot omission were lost. | [same name](test/trivia-regression.test.mjs#L178) |
| 14 | truncation may omit a licensed final separator, never a protected character or half a surrogate | N7: Final/word truncation remained; the exact half-surrogate emoji case was lost. | [same name](test/trivia-regression.test.mjs#L196) |
| 15 | complete protected-word coverage never bypasses unknown delivered context | N5: Unknown context remained; exact This was merely a guess text and support-only assertion were absent. | [same name](test/trivia-regression.test.mjs#L207) |
| 16 | invalid addresses/altered quotes/absent occurrences cannot enter trivia coverage | N8: Same invalid-address/unit/source/occurrence and altered-comma assertions remained under a new name. | [same name](test/trivia-regression.test.mjs#L216) |
| 17 | trivia is private: absent from both adjudication bundles; support keys distinguish licensing | N16: Projection/key category remained; exact reviewed-v2 production mutation was absent. | [same name](test/trivia-regression.test.mjs#L223) |
| 18 | bad licenses fail closed, including protected letters, forbidden punctuation, and source substitution | N9–N11, N14: Authentication attacks remained; the seven exact old normalized-metadata mutations were absent. | [same name](test/trivia-regression.test.mjs#L240) |
| 19 | coverage retains exact source content and origin, even at optional positions; empty trivia cannot prove a cause | N17: Source substitution/empty-content checks remained; exact wrong-origin and explicit resolved-range checks were absent. | [same name](test/trivia-regression.test.mjs#L250) |
| 20 | generator private wire adapter checks digest, literals/interpolations and paired coverage | N2, N6: Source authentication category remained; exact Frost/潮汐 6.25 and gx.delta wire fixtures were absent. | [same name](test/trivia-regression.test.mjs#L260) |
| 21 | generator consumer rejects drift and attempts to mark interpolated dots or add unsupported positions | N10, N14: Some drift classes remained; exact offset 7, added position 2, missing source list and duplicate-origin variants were absent. | [same name](test/trivia-regression.test.mjs#L269) |
| 22 | published generator rule declaration is compatible with the independent bilingual wire fixture | None as a distinct test: Generator rules are loaded by the new suite, but this exact bilingual live-declaration test was removed. | [same name](test/trivia-regression.test.mjs#L283) |

## Exact P1 replacement names

These 17 tests were added in the authentication repair and have not been removed,
merged or renamed during this restoration. Their original/current file is
`evaluation/hr3/scorer/test/trivia.test.mjs`.

| Code | Exact test name |
|---|---|
| N1 | support schema/keys announce authenticated versions |
| N2 | genuine final periods and source-production joining spaces may be omitted, English and Chinese |
| N3 | missing causal words, conjunctions and intermediate clauses stay protected |
| N4 | punctuation-only support spans and selections cannot establish a cause |
| N5 | unknown delivered context and extra punctuation citations remain referrals |
| N6 | decimals, dotted IDs, signs, operators and punctuation within interpolations remain protected |
| N7 | Unicode normalization and truncation keep protected character groups intact |
| N8 | invalid addresses, altered quotes, and absent occurrences cannot enter authenticated coverage |
| N9 | missing authority or handle protects the whole span; no fallback to declarations |
| N10 | forged handles/digests and mutable candidate changes cannot replace the independent freeze pin |
| N11 | serialized/cloned/manual normalized licenses and producer hashes are never proof |
| N12 | review P1-1: forged English/Chinese edge/fact boundaries grant no decimal license |
| N13 | review P1-2: a valid alternative parse of identical English/Chinese text is not its original emission |
| N14 | literal/template/variable substitution and recomputed candidate hashes grant no license |
| N15 | source mismatch cannot apply a verified family license to another span |
| N16 | proofs stay out of judge bundles and affect support dependence keys |
| N17 | optional punctuation cannot license changed content; wholly optional spans still score zero |

## Explicit expectation changes required by the security repair

The restoration does not re-enable unauthenticated punctuation credit.

- Old tests 3, 12 and the Chinese-separator portion of 13 used independent local
  declarations to grant R=1. The P1 fix intentionally removed that trust path.
  Their exact strings and declared literal-offset arithmetic are retained in
  coverage-predicate unit assertions, but `score()` must now return R=0 without
  authenticated generator provenance. The old failing cases remain explicit:
  the concatenated altered quote, empty license list, missing Chinese causal
  word, partial normalized ligature and omitted fullwidth identifier dot.
- Old tests 18 and 21 expected exceptions while validating malformed declared
  licenses. The repaired API instead grants no licenses and protects every
  source position. All seven metadata mutations, all seven wire mutations,
  changed rule-file bytes and missing source list are explicitly asserted to
  receive no license. Partial-support scorer assertions return R=0. An exception
  is not used as a substitute for exercising protected-span scoring.
- Old tests 20 and 22 now supply the independently frozen handle required by the
  v2 producer. Their exact bilingual source strings and decimal omissions are
  retained. The obsolete three-argument adapter is also explicitly checked to
  grant none; v1 declarations cannot be treated as authenticated v2 provenance.
- Old test 17 keeps the exact production-name mutation and the same-answer /
  same-delivery key comparison. It cites the final punctuation for that key
  comparison so both untrusted metadata contexts reach referral. The exact
  partial quote without punctuation is separately asserted R=0 after mutation.
  The independent authenticated-versus-untrusted proof/key test N16 is retained.

The restored suite asserts exact negative source strings for 7.25, gx.delta,
7/8, every original protected-punctuation variant, cobalt omission, the wrong
amber handoff, the Chinese missing-cause case, fullwidth-dot omission and the
half-surrogate truncation. Existing authenticated positives still use genuine
final stops and joining spaces; no whitelist-only license is introduced.

## Verification

- First restoration-only run: exit **1**, 21 passed / 1 failed. An added check
  accidentally included unknown context in its selected quotation and expected
  zero; that context correctly produced a referral. The quotation was corrected
  to the exact original partial causal quote. No runtime behavior was changed.
- Corrected `node evaluation/hr3/scorer/test/trivia-regression.test.mjs`:
  exit **0**, 22 passed / 0 failed / 0 skipped.
- `node --test --experimental-test-isolation=none evaluation/hr3/scorer/test/*.test.mjs`: exit **0**, **91 passed / 0 failed / 0 skipped**, seven files.

No commits; all writes remain within `evaluation/hr3/scorer/`.
