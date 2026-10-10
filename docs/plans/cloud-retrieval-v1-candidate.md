# Packet A: offline complementary source retention

Fixed public base: `52640f2278291d42e79597e542e2f039ccf6b29f` (#389).
Branch: `experiment/cloud-retrieval-v1-candidate`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/cloud-retrieval-v1-candidate`.
Contract: Shared seam v1 / Packet A in the primary plan at `8c1688c`.
Author runtime selected by primary: actual GPT-6.1 Sol, High. Author model
selection is separate from any future evaluated model. Author token usage,
account allowance and monetary cost are unavailable; no paid API calls occurred.

Local exact-base readiness was accepted by primary. Cloud M1 remains FAIL;
this local experiment does not pass or waive it. This candidate is opt-in,
evaluation-only navigation, with no production/default change or QA claim.
Independent Packet B acceptance, combined primary gates and nonauthor review
remain primary-owned. These public author controls are development evidence,
not an independent acceptance set or blind holdout.

## Chosen policy

`seed-preserving-rare-lexical-bridges-v1` uses only the supplied query and
receipt excerpts. Namespace indexes constrain navigation. Memory IDs,
revisions, receipt IDs, roles and stored currentness are preserved as supplied,
but never score candidates. Generated memory content is ignored.

Every validated rank seed is copied first in its original order. An empty
rank stays empty; a full limit stays unchanged. Additions can come only from
namespaces containing an original seed. If the original pool has at most six
cards and the entire seeded-namespace pool fits the limit, preserve that pool
in original candidate order after the seeds. This retains compatible small
pool behavior without retaining the old linked fallback's seed displacement.

Larger or capacity-limited pools use one bounded lexical strategy:

1. Lowercase and tokenize letter/mark/number/underscore sequences with optional
   internal hyphens. Keep terms of length at least four containing letters,
   or ASCII letter-number codes; discard an explicit English function-word
   list and calendar-like codes. No stemming, embedding or semantic labels.
2. Count per-card term occurrence separately within each seeded namespace.
   A shared term is eligible only when its document frequency is at most
   `max(3, floor(namespace pool size / 4))`. This removes repeated topic terms
   in the author long-history distractors, including shared ingestion metadata.
3. A link requires two eligible shared terms, or one eligible code, or one
   eligible term at least five characters long absent from the query. This
   intentionally allows a distinctive source detail to bridge beyond query
   words without retaining every card that repeats the query.
4. At each addition, score possible links from selected cards with depth below
   two. Score is the sum of `log2(1 + namespace size / document frequency)`
   for shared eligible terms, plus `0.25 * query-term overlap`, minus
   `0.5 * parent depth`. Append the highest-scoring candidate; ties retain
   original candidate order. Parent ties follow deterministic input order.
   Stop at the unchanged limit, no eligible link, or two hops from seeds.

Diagnostics record the strategy, reason, exact added refs and the selected
lexical paths; `semanticCoverage` is always `unassessed`. They are deeply
immutable, detached JSON data. Paths are lexical navigation suggestions,
not source identity, support, truth, adoption, authorization or applicability.

## Seam and caller trace

New exports are `assembleComplementarySourceSet(input, rankOutput)` (pure,
synchronous) and `createComplementarySourceSetModel(model)` (frozen existing
model-port shape). The existing source-linked module's validation/factory
helpers are private. This experiment duplicates those guards locally, keeping
typed errors, descriptor-safe snapshots, 3 MiB / 100,000 nodes / depth 32,
original request fields, token guards and post-counter output revalidation.
This is experimental duplication to consolidate before any production promotion,
not a second product engine. No shared API was changed.

The factory captures and binds the original rank/token ports, preserves all
other ports, and invokes the underlying rank exactly once with the original
`system`, detached immutable source-only `input`, `maxOutputTokens: 1024`, and
original `signal`. It counts the serialized request with the supplied token
port against 6,000 tokens and both raw/compiled outputs against 1,024 tokens;
context window remains at least 8,192 and output encoding at most 40,000
characters. Cancellation is checked before and after each callback stage.
Repeated descriptor-safe snapshots reject raw-output mutation during either
token count. Compiler refs retain exact namespace/memory/revision identity.

The only importer in this branch is the new author control test. Its integration
path is `openMemoryCore` -> existing bounded-keyset source candidate policy ->
existing `recallMemories` selection/fetch/packing -> wrapped rank -> authoritative
core final read -> `verifiedRoleEvidence` -> unchanged `packMixedAnswer`.
The factory introduces no store or fetch port. No browser/user flow, production
caller, transport, capture path, default, dependency, budget or CI changes.
Primary owns the later independent integration and caller checks.

## Cost and observed source coverage

For `N <= 36`, limit `L <= 12`, maximum distinct terms per card `U`, and total
source text length `T`, lexical work is bounded by
`O(T + L * N * min(N, L) * U)` with in-memory term storage `O(T + N * U)`
and at most `L` paths. The unchanged snapshot has its own byte/node/depth bounds.
No external read, extra model call or persistent storage is added. Existing core
fetch/finalization and answer packing still govern actual sources and freshness.
Retention can increase packed answer input; no answer budget is enlarged.

Author pure control: 18 supplied cards, one raw seed, two lexical additions,
three retained refs; 15 repeated historical distractors remain unselected.
The corresponding real-core control uses 12 cards because existing selection
allows at most 12 refs per namespace per round. Both arms copy one closed cold
SQLite snapshot so IDs, ordering and original rank request are identical.
Actual authoritative role-packed evidence increases from one to three units,
restoring two distinct source passages. The test-only `ceil(chars/4)` mechanical
counter measures packed answer request 187 -> 323 units (delta 136). These are
not provider tokenizer counts, model spend, answer correctness or measured QA
accuracy. Submitted user/assistant roles and original session provenance survive.

## Controls, gates and retained failures

The 12 author controls cover long-history restoration, two-hop termination,
query/source-only scoring, deterministic ties, deep immutability, small pools,
lexical collision, seed order, limit exhaustion, empty seeds, seeded namespaces,
foreign/stale/duplicate/extra refs, malformed input, getters/JSON hooks,
byte/node/depth limits, captured ports, mutation/TOCTOU, provider failures,
inclusive input/raw/compiled token ceilings, cancellation at five stages, and
actual core/role-evidence/answer packing. The compiler never replaces core
freshness checks. Existing targeted architecture tests also exercise actual
correction/forget and final freshness rejection.

Normal command, run before generic gates on both pinned runtimes:

```sh
node tools/testing/run.mjs evaluation/experiments/cloud-retrieval-v1/candidate.control.test.mjs
```

Red control, each runtime exits 1 with one real failed restoration assertion:

```sh
CAIRN_COMPLEMENTARY_CONTROL_DISABLED=1 node tools/testing/run.mjs --test-name-pattern=red-capable evaluation/experiments/cloud-retrieval-v1/candidate.control.test.mjs
```

The disabled path uses the original validated rank directly, making the same
contact-preservation assertion fail. It does not shim a missing candidate,
change existing expectations, or report an expected failure as a passing test.

Initial author integration runs exited 1 (11/12 passing): selecting 18 refs
violated the existing per-namespace selection cap; after fixing that fixture,
the next run on both Nodes exposed an expected-source mismatch because indexed
ingestion wraps text with session metadata. After deriving expected text from
the ingestion plan, both runs reached the final request-equivalence assertion
and exposed independently admitted stores' random IDs/order. A closed shared
capture snapshot corrected that fixture. These were three distinct test setup
errors, with concrete failure evidence, not candidate algorithm corrections.
The final normal controls pass on both Nodes, 12/12; fail/skip/cancel/todo 0.
The intentional red controls fail 1/1 on both, with skip/cancel/todo 0.

Locked offline installs were isolated real directories (not symlinks), inspected
before install: `npm ci --offline --prefix adapters/openai`, `adapters/mcp`,
`tools/plugin-validation`, each exit 0. No lock or dependency change. The public
fixed base has no `scripts/README.md`; only specified package validation gates
were run, no operational script or production action.

Pinned executables are `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node`
and `/home/chichieh/.nvm/versions/node/v24.15.0/bin/node`; actual versions
`v22.16.0` and `v24.15.0`. Each gate prepends its matching bin directory to PATH.
Logs and actual process exits/counts/timings/resources are retained at
`/tmp/cairn-packet-a-gates.mk4j22/report.json` and sibling named logs. Every
invocation has a fresh owned parent scratch directory and
`NODE_DISABLE_COMPILE_CACHE=1`; residue is inspected before removing the empty
parent. SQLite closes before workspace cleanup. Historical scratch is untouched.

Both runtimes completed: `npm test` (669/669), `npm run validate`,
`NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle` (25/25),
`node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs`
(30/30), `npm run validate --prefix tools/plugin-validation`,
`npm run test:longmemeval` (210/210), and the ingestion/comparison/public demos,
all actual exit 0. Test fail/skip/cancel/todo counts are all zero. These are
existing regression gates, separate from the 12 new author controls.

| Command / result | Node 22.16.0 seconds | Node 24.15.0 seconds |
| --- | ---: | ---: |
| Author controls: exit 0, 12/12 | 0.610 | 0.609 |
| Disabled targeted control: exit 1, one expected failure | 0.092 | 0.110 |
| `npm test`: exit 0, 669/669 | 277.349 | 311.676 |
| `npm run validate`: exit 0 | 0.104 | 0.104 |
| Workspace lifecycle: exit 0, 25/25 | 18.355 | 17.604 |
| Targeted architecture: exit 0, 30/30 | 3.227 | 3.032 |
| Plugin validation: exit 0 | 1.623 | 1.587 |
| LongMemEval: exit 0, 210/210 | 11.127 | 10.256 |
| Ingestion demo: exit 0 | 0.369 | 0.355 |
| Comparison demo: exit 0 | 0.365 | 0.393 |
| Public demo: exit 0 | 0.453 | 0.489 |

All ordinary suites have fail/skip/cancel/todo 0. The targeted red control has
one fail and pass/skip/cancel/todo 0, intentionally. Summed command wall time is
313.674 / 346.215 seconds. The main suite took 34.327 seconds longer on Node 24;
these successful command timings are observations, not a controlled performance
comparison. `/usr/bin/time` reports maximum RSS 302,332 / 415,204 KiB across each
runtime's gates (both maxima are existing LongMemEval); the candidate controls
report 81,216 / 97,796 KiB. These are command/process maximum RSS measurements,
not aggregate simultaneous descendant memory. CPU usage, whole-tree peak RAM,
peak disk usage and cloud resource fit remain unknown.

The first outer gate harness exited 1 after the successful ingestion command
because its blanket empty-parent check treated the demo's intentionally retained
SQLite artifact as unexpected residue. `demo.mjs` and `comparison-demo.mjs`
explicitly retain synthetic databases and close the core in `finally`.
This is consistent with `CONTRIBUTING.md`'s public demo retention contract.
The remaining commands continued once, with those named demo artifacts reported
and retained. Passed commands were not retried; test-runner invocations still
require an empty parent. The public demo cleans up its own workspace.
At completion, filesystem `find` and independent demo-log path extraction agree:
four retained synthetic databases, 2,244,608 bytes total; no other test scratch
remains. The databases stay under the owned gate log root, with their exact paths
recorded in the named demo logs. No historical cleanup occurred.

The scoped file manifest was derived with staged `git diff --name-only` and
independently with filesystem `find`, then compared: 3 files, exact match
(this plan, `candidate.mjs`, `candidate.control.test.mjs`). All four locally
copied validation helpers match the frozen base after comment/whitespace
normalization; `git diff --cached --check` exits 0.
The code and control file were unchanged during these final gates. Their SHA-256
digests are respectively
`43fe41af5d2eff91e7bd1c76dd868af86e6b698f5f34d70e62a4bfd4a011c7f1`
and `b0d39c61083047e7ee042d1ddf59d9edb65574e7bac4edec4e3d82667fbf8f63`.

## Limitations and next step

The lexical policy misses paraphrases, pronouns and sources without shared
eligible tokens, cannot reconstruct sources excluded upstream, and can mistake
a repeated name/code or unrelated rare term for a link. English stopwords and
unsegmented multilingual text bias coverage. Case folding conflates case-sensitive
codes; repeated critical terms above the frequency cap lose their links.
Two hops and greedy capacity can stop before necessary evidence. The algorithm
does not remove a bad seed or infer which conflicting, proposed, dated or
instruction-bearing source is safe/current. Small-pool preservation still exposes
unrelated supplied siblings. A lexical-collision control explicitly retains an
unrelated source and leaves coverage unassessed. Source receipts establish
provenance, not semantic truth or authenticated authorization.

Recommendation: freeze this one bounded offline candidate for primary's
independent Packet B challenge and reviews. Any severe new safety case or unknown
resource result blocks advancement. Later measured comparison needs its own
frozen protocol, same-batch comparator, original advancement gates, independent
judging and primary-controlled budget preflight. No QA score, paid-run permission,
Hermes installed-host readiness or production promotion follows these controls.
