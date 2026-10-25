# A-4 scorer implementation report

Scope: `evaluation/hr3/scorer/` only, on `experiment/hr3-update-policy`,
starting HEAD `e5555ee3`. Authority: protocol v0.3.4 plus errata A-4, especially
§§4–5. Read the supplied TRAPS; ran only scorer tests. No commit, network,
API/model invocation, credential read, held-out rendering or paid execution.
The concurrently published generator contract was read, never modified.

## Clauses covered

- **A-4 §2:** text-derived slot/public-label/legacy-field and naming-alias
  interfaces; a consumer adapter for the published slot array and bilingual
  alias tables; literal routes absent an explicit naming alias; exact rational
  declared-unit conversion; 12-cell scopes and Taipei/source-claimed intervals.
  Actual delivered body/receipt addresses, zero-based item/source, one-based
  occurrence, explicit delivered aliases and verbatim delivered quotations.
- **§4:** closed required slot answer schema; typed value/null states;
  not_specified versus missing evidence; scope partition equivalence and
  duplicate collapse; contradictory extras; exact public predecessor turns and
  historical labels; no-active/expired-history semantics; reason evidence
  selections replace model-authored graphs and dangling causal endpoints.
- **§5 C/O/J:** exact statuses, complete slot assertions, scope, validity and
  requested predecessor sets; factual C/O independent of citation quality;
  original citation diagnostics retained; conjunction computed per observation.
- **§5 R items 1–5:** resolved submitted provenance, complete accepted graph
  with OR-of-AND edge support, no skipped serial intermediates/conjunctions,
  complete sufficient alternatives and accepted unions; broad/unfamiliar,
  negated/speculative/wrong-change selections cannot mechanically pass;
  unfamiliar delivery context refers separately. No uncited substitute support.
- **§5 negative R:** factual matching not_stated with empty support can pass
  empty delivery; stated R cannot. Negative support is `not_applicable`.
  Every attempted observation retains gold-status stratum, denominator 1 and
  deterministic no-evidence baseline R, including malformed attempts.
- **§5 referral correction:** public canonicalization and atomic slot
  projection precede matching. Unknown unit/scope/time correspondence refers
  affected C/O; representation-dependent count/type differences do not force
  zero. Independent contradictions/omissions can determine zero. C/O referrals
  remain separate from R even when J is forced zero.
- **§5 validity/boundaries:** schema-malformed whole answers score zero;
  invalid reason selections or citation semantics leave valid C/O intact.
  Impossible scopes/intervals retain existing malformed-answer semantics.
  Correctness sees original slot answer plus support-registry-free G_correct;
  support sees original answer plus actual delivery and no gold/findings.
  Versioned component dependence keys include contract/dictionary and contextual
  inputs; parent rules separate C, O, R correspondence and R support.

## Interface decisions and ambiguities

A-4 does not prescribe the private gold/envelope wire format. The existing
scorer interchange now uses citation-free slot rows for C/O and retains its
private causal nodes, accepted graphs and exact source-span registry for R.
The compatibility helpers compare legacy bundled/decomposed fields without
expanding the closed reader answer. Unknown field/type correspondence returns
null, not a representation-dependent zero. They are not full Claim scorers or
an adapter from any worker's private gold archive.

The public contract's language-indexed wire table initially differed from the
text-derived local interface. That mismatch was reported by the consumer;
`contractProjection` now adapts it without changing the declared meanings.
The final published executable slot/alias/unit/status/scope projection validates
with **no remaining mismatch**. Each score reports the consumed version/hash;
missing contract is explicit, mismatch is an input error, and no publication is
cached across calls. The final version observed during verification was `hr3-public-contract-a4-v1`, hash
`61c12011183d82c2a9fcba3c3e666bbc65da96125a6436de3e96019801ae8a23`.

A-4's verbatim-delivery rule and the contract's independent fullwidth example
resolve the old resolver's quote-normalization issue: raw-source fullwidth
quotes cannot match normalized ASCII delivery. Normalization provenance and
citation diagnostics remain intact. The existing decimal schema escape defect
was also corrected; malformed numeric spellings are structurally rejected.

Unfamiliar entailment, negation, broad citations and unknown correspondences
remain referrals, not invented licenses or finalized judgments. Reader overlap
ambiguity is explicitly retained by A-4, while the contract also describes
successive overlapping start positions: cases where interpretations differ
remain referred. Nonexistent/ambiguous Taipei midnight likewise remains a
referral. Private span entailment still requires independent authoring audit.
No new execution, calibration, complete-request/cap certificate or analysis
acceptance is claimed; those remain the relevant owners' freeze obligations.

## Verification and actual exit codes

Node `v22.16.0`. Every exit was captured from the actual process; no test
success was inferred from a pipe's final command or from a stdout tail.

| Command | Actual exit | Result |
|---|---:|---|
| `node evaluation/hr3/scorer/test/canonical.test.mjs` | 0 | 7 tests |
| `node evaluation/hr3/scorer/test/citations.test.mjs` | 0 | 7 tests |
| `node evaluation/hr3/scorer/test/contract.test.mjs` | 0 | 5 tests |
| `node evaluation/hr3/scorer/test/schema-cli.test.mjs` | 0 | 7 tests |
| `node evaluation/hr3/scorer/test/scorer.test.mjs` | 0 | 26 tests |
| `node --test evaluation/hr3/scorer/test/*.test.mjs` | 0 | 5 test files |
| `node --check FILE` for every scorer `.mjs` | 0 each | 13 files |
| Public contract consumer validation | 0 | no semantic projection mismatches |
| `git diff --check -- evaluation/hr3/scorer` | 0 | no tracked whitespace errors |
| Recursive filesystem whitespace/path scan | 0 | includes untracked files |
| Independent changed-file enumeration/diff | 0 | 15 files, 0 differences |

There are **52 individual tests** across five scorer test files. Negative
coverage includes bilingual aliases, bundled/decomposed fields and unknown
type correspondence, representation-dependent partition counts, wrong
unit/source/occurrence and dangling delivered addresses, dangling private
graph/span references, obsolete answer endpoints, conjunctive/serial omission,
partial alternative splicing, unrelated over-citation, absent evidence,
not_stated/unavailable confusion, schema closure, pass isolation and keys.
The CLI's expected usage/authoring/I/O failures assert exit 1 explicitly.

An intermediate combined run and direct diagnostic runs exited 1 when the
concurrently published contract first appeared in its different wire shape.
After adding the semantic projection adapter, focused tests passed. This was
an interface mismatch, not a hidden successful test run. No broad repository
suite was run and no process remains unattended.

## Changed files, independently cross-checked

Route A: scoped `git diff --name-only -z` plus
`git ls-files --others --exclude-standard -z`.
Route B: independent `find` enumeration, comparing each file's bytes to
`git show HEAD:path` (and accounting for deleted tracked files).
The sorted lists were diffed: **15 versus 15, zero differences**. The final
filesystem scan covers all 18 scorer files, including untracked additions.
Paths below are relative to this directory and mechanically enumerated:

- `README.md`
- `REPORT.md`
- `answer.schema.json`
- `citations.mjs`
- `contract.mjs`
- `gold.schema.json`
- `schema.mjs`
- `scorer.mjs`
- `slots.mjs`
- `submission.schema.json`
- `test/citations.test.mjs`
- `test/contract.test.mjs`
- `test/fixtures.mjs`
- `test/schema-cli.test.mjs`
- `test/scorer.test.mjs`
