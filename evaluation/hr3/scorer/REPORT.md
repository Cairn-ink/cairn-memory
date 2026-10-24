# HR-3 scorer implementation report

Implemented inside `evaluation/hr3/scorer/` on `experiment/hr3-update-policy`,
whose checked HEAD is the pinned product
`b2513501a6747a163ab1cefb7d37a16744c9621a`. No commit was made.
The sole specification read was `../protocol/protocol-v0.3.4.md`; the concurrent
generator and other workers' implementation files were not consulted.

## Coverage

- §6: closed typed Answer/Gold/submission schemas; required fields; NFKC and
  whitespace normalization; frozen bilingual/alias dictionaries; exact rational
  units; UTC instants and half-open/unbounded intervals; unordered sets and
  extensional audience cells; duplicate collapse with contradictions retained.
- §6: citation resolution against actual delivered units/aliases; maps across
  normalization, UTF-16 truncation and elision; distinct gold-free support and
  evidence-free correctness referral bundles. C/O remain factual measures;
  citation resolution is reported separately.
- §7: OR accepted graphs, AND required directed edges, OR-of-AND supporting
  spans, supported unions, endpoint/shortcut rejection, exact C/O/R and
  observation-level J; malformed/exhausted attempted answers score zero.
- §8 interface: unresolved equivalence/support referrals, deterministic keys,
  pass-specific rubric/bundles and preserved mechanically forced J=0. No
  adjudication, mapping propagation, calibration or independent bilingual
  challenge-set construction was performed.
- §2 dependencies: the 12-cell domain, empty-scope rejection, Taipei date
  boundaries and requested predecessor semantics.

## Interface decisions and unresolved ambiguities

See [README.md](README.md#canonicalization-and-protocol-ambiguities) for the
complete eight-item integration record: Value tags/decimal strings; Gold graph
and span encoding; dictionary contents; equivalent scope partitions; time
representations; overlapping occurrence ambiguity; trusted delivery/failure
envelope; and unrecognized semantic entailment/context. Representational
choices are explicit in the JSON schemas. Unknown semantics are referred,
never self-adjudicated. Overlapping-occurrence and daylight-saving gap/fold
conventions remain unresolved by the protocol and receive no mechanical
credit. In particular, an arbitrary unlicensed context containing a negation
cannot silently receive support from an otherwise matching quotation.

The generator must conform to this derived interchange or explicitly reconcile
representation differences before artifact freeze. Runtime dictionaries and
map provenance still require the protocol's independent audit/calibration.
No packaging manifest was edited: this is a research scorer, and the user's
write scope prohibits changes outside this directory.

## Verification commands and actual exit codes

Node: `v22.16.0`. Only this directory's test files were run (TRAPS item 11).

| Command | Actual exit | Result |
|---|---:|---|
| `node evaluation/hr3/scorer/test/canonical.test.mjs` | 0 | 7 tests passed |
| `node evaluation/hr3/scorer/test/citations.test.mjs` | 0 | 7 tests passed |
| `node evaluation/hr3/scorer/test/schema-cli.test.mjs` | 0 | 7 tests passed |
| `node evaluation/hr3/scorer/test/scorer.test.mjs` | 0 | 32 tests passed |
| `node --test evaluation/hr3/scorer/test/*.test.mjs` | 0 | All 4 test files passed |

The 53 individual tests include schema closure/required fields, every Value
variant, current qualifications/scope/time/status, all historical labels,
requested predecessor sets, expiry, OR/AND graphs/support, unions, direction,
shortcuts, missing edges, endpoint-only/uncited evidence, truncation, source
substitution, external negation referral, aliases, Unicode maps, equivalent
dates/partitions, bilingual values, unknown paraphrases and pass isolation.
CLI tests exercise deterministic atomic output, malformed reader JSON, failure
zeros, and expected exit-1 usage/authoring/I/O errors. Test-created temporary
files are cleaned; the final tests keep temporary files in this directory.

One intermediate combined test run and its focused diagnostic exited **1**:
a new historical-date test assumed 1979-07-01 had a Taipei midnight. It is a
daylight-saving gap. The fixture was corrected to expect referral on that date
and to test the +09:00 offset on 1979-07-02. Subsequent focused/combined runs
exited **0**, as reported above. No failing tests were hidden by a pipeline.

The early read-only parent-directory discovery command was interrupted with
exit **130**; subsequent instruction discovery used explicit ancestor paths.
No long-running process was left unattended. No network/API/model calls were
made, no credentials were read, and no broad repository suite was run.

## Syntax, whitespace and file cross-check

All 10 JavaScript files passed individual `node --check FILE` commands with
actual exit **0**. A recursive filesystem whitespace scan checked all 15 files
(including untracked files) and returned **0** errors, exit **0**.
`git diff --check -- evaluation/hr3/scorer` exited **0**; its tracked-only
coverage is supplemented by that filesystem scan.

File enumeration route A combines scoped `git diff --name-only -z` with
`git ls-files --others --exclude-standard -z`; route B independently runs
`find evaluation/hr3/scorer -type f -print0`. Each command exited **0**.
The sorted lists were diffed in both directions: **15 files** on each
route, **0** differences. The lists were re-derived after this report update.

Files written (paths relative to this scorer directory):

- `README.md`
- `REPORT.md`
- `answer.schema.json`
- `canonical.mjs`
- `citations.mjs`
- `cli.mjs`
- `gold.schema.json`
- `schema.mjs`
- `scorer.mjs`
- `submission.schema.json`
- `test/canonical.test.mjs`
- `test/citations.test.mjs`
- `test/fixtures.mjs`
- `test/schema-cli.test.mjs`
- `test/scorer.test.mjs`
