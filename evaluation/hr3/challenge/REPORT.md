# HR-3 challenge delivery and verification

Authored only within `evaluation/hr3/challenge/` on branch `experiment/hr3-update-policy`, pinned HEAD `b2513501a6747a163ab1cefb7d37a16744c9621a`. Protocol v0.3.4 was the sole semantic authority. The scorer directory was neither read nor imported. No network, API/model call, credential read, sibling test, package change or commit occurred.

Delivered 1,984 bundles from 736 independent synthetic worlds: 400 pooled, 960 referral candidates, 240 evidence contrasts and 384 representation/distortion bundles. Pooled balance is 200 correct/200 incorrect with 60 C-only, 60 O-only, 60 R-only and 20 all-component negatives. The complete manifest supplies language, style, component, scenario, causal and distortion quotas and SHA-256 hashes.

**Pending:** the 960 referral candidates have the planned quotas but cannot be certified as genuine referrals without observed decisions from the frozen mechanical pipeline (§8). The manifest explicitly records null certification. No calibration gate is claimed passed. The primary also needs to reconcile the shared executable schema and audit external split ancestry. All ambiguities/conventions and their handling are listed in README's “Ambiguities, conventions and pending gates” table; none has been silently treated as a scorer result.

## Files written and inventory checks

The final inventory is **14 regular files**. The validator enumerates them by recursive Node `readdir` and independently by breadth-first `opendir`, diffs the lists, and compares them with 13 manifest artifact entries plus `manifest.json`. An independent Python `pathlib.rglob` enumeration is also diffed against that inventory and verifies byte lengths and SHA-256 hashes with Python `hashlib`. All routes agree on 14 files; no file is excluded other than the manifest's recursive self-hash.

```text
README.md
REPORT.md
answer.schema.json
bundles.mjs
challenge.test.mjs
evidence-contrasts.jsonl
generate.mjs
manifest.json
pooled.jsonl
referral-candidates.jsonl
representation-pairs.jsonl
schema.mjs
validate.mjs
worlds.jsonl
```

This list is derived from directory enumeration and cross-checked, rather than reconstructed from remembered edits. No packaging manifest outside the assigned directory was changed: these are standalone research artifacts, not shipped runtime files; the explicit write-scope instruction takes precedence over the general packaging trap.

## Commands and actual exit codes

Node version: **v22.16.0**. Verification commands were run directly with no stdout-tail pipeline. These are the successful final checks (all scoped to the assigned directory):

| Command | Exit code | Result |
| --- | ---: | --- |
| `node evaluation/hr3/challenge/generate.mjs` | 0 | 1,984 bundles / 736 worlds; deterministic source/data/schema/manifest regeneration |
| `node evaluation/hr3/challenge/validate.mjs` | 0 | Closed schema, labels, complete quotas, uniqueness, provenance, 14-file cross-check and all hashes valid |
| `node --test --experimental-test-isolation=none evaluation/hr3/challenge/challenge.test.mjs` | 0 | 16 tests passed, 0 failed; complete byte-for-byte case/world regeneration verified |
| Python inventory/hash/count/whitespace audit, as described below | 0 | Independent 14-file list, SHA-256 checks, 1,984 case count, 736 world count; 0 whitespace defects |
| `git diff --check -- evaluation/hr3/challenge` | 0 | Tracked whitespace check; untracked artifacts covered separately by the Python audit |

The Python audit recursively enumerates only this directory, sorts and compares its relative paths against `manifest.artifacts + manifest.json`, independently hashes each artifact, checks LF termination/trailing whitespace, and counts JSONL lines against manifest totals. It prints the complete 14-path inventory and counts. This audit is verification only; the implementation remains plain Node ESM with no dependencies.

Earlier failures were retained as findings, not counted as passing runs:

| Command/check | Exit code | Finding and repair |
| --- | ---: | --- |
| Initial directory reconnaissance ending with `ls -ld evaluation/hr3/challenge` | 2 | Assigned directory did not yet exist; created only that directory. |
| Initial validator and isolated focused test run | 1 each | Duplicate bundles exposed an idempotent Text negative mutation. Changed it to a distinct, internally consistent alternate processing policy; no-op and duplicate checks now pass. |
| Validator with child-process `find` cross-check | 1 | Sandbox `spawnSync find EPERM`, despite returned stdout. Removed subprocess use; independent directory-handle enumeration and external Python traversal replace it. No success was inferred from stdout. |
| Initial `node --test …/challenge.test.mjs` / direct test diagnostic | 1 | Direct `node …/challenge.test.mjs` exposed a test matching historical ranges against current claims sharing a timestamp. Restricted transformation checks to their actual current/history sections. |
| First `--experimental-test-isolation=none` attempt | 1 | Test runner supplied a relative argv path; the entrypoint guard incorrectly built a file URL. Changed guards to `path.resolve`, then reran successfully. |

No broad suite was run (TRAPS item 11). No long-running task or unattended process remains.

## Protocol coverage and limits

| Sections | Coverage |
| --- | --- |
| §§1–3 | Erroneous versus formerly adopted history, expiry without fallback, source-claimed intervals, extensional 12-cell scopes, refinement inheritance, scope residuals, multiple requested predecessors and unresolved anchors |
| §6 | All Answer/Value variants and required fields, closed schema, NFKC/whitespace, exact rational units, equivalent UTC/offset instants, set/duplicate handling, citation shape and gold/support isolation |
| §7 | Exact C/O sets/statuses, causal graph alternatives/conjunctions, direct and serial/mediated edges, missing/reversed/shortcut edges, correct-but-uncited support traps, R correctness/support and per-bundle conjunction |
| §8 | All four exact bundle constructions, language/component/style quotas, explicit labels/mutations, fixed candidate order, matched-positive reuse, evidence contrasts and locally supported false extractions; observed referral/calibration gates remain pending |
| §9 | Offline deterministic grammar/AST authoring, calibration-only namespace and variant/world denominators; no research split input was imported |
| §16 | Focused tests with actual exit codes, independent inventory enumeration, full byte/hash manifest and disclosed limitations |

Tests do not implement or import a scorer and do not claim adjudicator calibration, model agreement, product correctness, actual referral coverage or research outcome estimates.
