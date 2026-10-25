Case binding: all generator scoring now returns a separate opaque expected-case
token alongside gold. Mechanical scoring passes it to the shared harness guard.
Any source carrying trivia must authenticate against independently supplied
family/checkpoint/query data; declared or replayed proof metadata cannot create
that target. Explicitly empty-trivia engineering worlds use fully protected
scoring, and sources carrying trivia require a separate trusted target.

Authenticated trivia update: generator adaptation now uses the independently pinned
freeze authority in `../harness/trivia-authority-a6.mjs` and reauthenticates source
data on replay. Challenge adaptation preserves opaque proof identity; serialized
or declared offsets grant no licenses. Current verification is recorded in the
harness A-6.1 authentication recertification report.

# A-6 integration

`adapters.mjs` now consumes the closed own-name/reference extraction wire and
producer-authenticated private optional-trivia registry. Every source object is
retained behind a hash-checked audit/restore boundary. No graph-answer fallback
is provided. Source names authorize identity resolution only, never retrieval
of overwritten or forgotten O/P content.

`node evaluation/hr3/integration/reconcile-a6.mjs` checks all 120 generator
checkpoints and 240 extraction batches, independently enumerates field paths,
and republishes the complete field and delivery manifests. The integration
suite also compares the hash-pinned pre-A-6 reducers against equivalent fully
resolved streams, tests actual public P operations and loss, and checks both
bilingual preservation/no-preservation pairs. Its 26 tests pass.

See [the A-6 migration report](../harness/REPORT-A6-MIGRATION.md). These are
engineering checks; input ceilings, A-6.1, final recertification and primary/
non-author execution approvals remain pending. The legacy challenge bank and
mechanical results below are historical, not calibration-v2 evidence.

# HR-3 A-4 integration

The active adapters accept closed slot answers and selected explanation quotations. Generator slot gold is joined to private causal nodes and exact UTF-16 support spans. No graph-answer conversion or fallback is implemented. Requested predecessor identities, slot states, scope and intervals survive the projection. Audit sidecars retain original metadata with hash-verified restoration; scoring and referral bundles receive closed projections only.

`node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs` runs all pilot checkpoints, independent A-4 adapter and admitted-input/P-operation witnesses, and gate arithmetic tests. The synthetic gate tests use historical label strata only to check arithmetic; they do not certify calibration v2. Independent adapter tests retain genuine support referrals when extra delivery context is outside mechanically recognized causal licenses.

`adaptChallenge` requires an A-4 candidate, `gold.answer`, `gold.private_causal.reason.nodes`, private accepted graph topology, explicit `world.row_support` delivery addresses and `world.edge_support` plans. Modified delivered text receives a distinct origin. The superseded challenge bank is rejected until its owner supplies calibration v2; the legacy mechanical CLI cannot certify that bank under A-4. No generator/scorer gold or tests are changed.

`goldWitness` is a diagnostic source-span witness. It delivers only the causal licensed spans and selects a complete first path/union. It is never used by the live reader, extraction, policy or P agent. Every one of the 120 frozen pilot checkpoints earns full witnessed credit under this restricted diagnostic delivery.

Historical integration documentation follows; its old challenge/calibration artifacts are not A-4 certification.

# HR-3 integration

Offline Node >=22.16 ESM, built-ins only. The scorer schema is canonical. Authority:
`../protocol/protocol-v0.3.4.md` §§2, 6–8, with errata E-1/E-2. No model runner,
network client, credentials, or external service is used.

```sh
node evaluation/hr3/integration/cli.mjs mechanical --out evaluation/hr3/integration/artifacts/NEW_RUN
node --test --experimental-test-isolation=none evaluation/hr3/integration/test/integration.test.mjs
node evaluation/hr3/integration/cli.mjs gate \
  --index evaluation/hr3/integration/artifacts/NEW_RUN/private-index.json \
  --judgments evaluation/hr3/integration/artifacts/judgments.jsonl --out evaluation/hr3/integration/artifacts/new-gate.json
```

`mechanical` requires a new directory and exits 0 when all source records were
adapted/validated/scored; 1 denotes execution/validation failure. It reports
calibration failures as data, so exit 0 does **not** mean calibration passed.
`gate` exits 0 for pass, 1 for fail (including an already impossible quota),
2 for pending with no failed gate. Output files must not already exist.
Only the integration test file is run; no broad or sibling suites.

`reproduce.mjs` invokes the generator's actual pilot CLI in the configured temporary directory. Because the
challenge CLI hardcodes its output directory, it copies exactly the frozen
challenge sources to the configured temporary directory and invokes that CLI there. It verifies regenerated
pilot bytes against `generator/freeze.json` (including the pilot manifest), all
13 challenge artifacts against `challenge/manifest.json`, original source
hashes, and both protocol hashes: 43 checks. It records actual child exit codes.
The source protocol and all sibling files are read-only. Only pilot is rendered;
no held-out splits are generated. Runtime, errata, integration/scorer hashes and
canonicalized command records identify the observed pipeline. Temporary path
names never affect emitted artifacts or keys.

## Adapters and audit boundary

`adapters.mjs` exports:

- `adaptGenerator(family, goldRow, supportRow, batch)` → `{gold, submission:null, audit}`.
- `adaptChallenge(row, authoredWorld)` → `{gold, submission, audit}`.
- `goldWitness(gold)` → an explicit synthetic submission delivering authored spans
  and citing one complete accepted graph, for gold self-scoring only.
- `restore(adapted)` → exact original inputs after verifying the sidecar hash.

A closed scorer object cannot hold family IDs, ASTs, labels or provenance. The
**audit envelope** is lossless; the scorer-only projection cannot be lossless
for those fields, and reports them as defects. Every observed leaf pattern has
a field mapping, count and disposition in `reconciliation-fields.json`.
Metadata is preserved in the private audit, never silently dropped or inserted
into the scorer schema. Nonempty gold citations, incorrect source slices,
unsupported offset units, mismatched topology, and incompatible Answer fields
are errors. New source metadata stays in the audit and is reported as unmapped.
No paraphrase dictionary or causal license is added to the scorer.

Challenge origins are local identities of the supplied final source units.
Historical addresses come from `world.claims_support`, independent of the
candidate; remaining units use the challenge's authored current intent. No
alias is invented. Final text is mapped with `normalize:false,truncate:null`:
normalization/truncation already happened upstream in this fixture. Its missing
product/raw ancestry is a reported provenance defect, not fabricated evidence.
Changed/new representation units get distinct local origins. All original
source units are context spans, while only `world.edge_support` licenses edges.
This preserves negation referrals and never substitutes a different citation.

Generated output under `artifacts/frozen-v1/` includes:

| File | Audience |
| --- | --- |
| `summary.json`, `field-counts.json`, `pilot.json`, `failures.jsonl` | Primary/reviewers; reconciliation, validation and calibration observations |
| `observations.jsonl` | Primary only; per-case decisions, labels and references |
| `audit-private.jsonl` | Primary only; exact sources, hashes, conventions and defects |
| `private-index.json` | Primary only; truth, mechanical state, key applications and expected payload hashes |
| `judge-input/<opaque-key>.json` | The sole payload for ONE fresh isolated pass session |
| `gate-no-judgments.json` | Demonstration that absent judgments cannot pass |
| `artifact-manifest.json` | Readback SHA-256/bytes inventory, excluding itself |

Never send the private index, summary, directory listing, other bundle, or audit
to an adjudicator. Each judge-input file contains exactly the scorer's one
anonymized original answer and pass-specific rubric/context. Correctness gets
quotation-free `G_correct`; support gets actual delivered text without gold.
Opaque filenames are contextual keys, not arm identities. No arm field exists
in these challenge records; synthetic subject/update tokens preserve evidence.
The primary arranges the §8 fresh sessions and transports structured outputs.
No model invocation is implemented here.

## Judgment interchange

One JSONL row per key/pass/judge. `judge` is 1 or 2, or 3 for an independent
resolution session. Obtain `payloadHash` from the **primary-only** index; attach
transport metadata outside the judge-visible payload. Never expose index labels
to the session. Every session ID must be globally unique across records.

```json
{
  "key": "opaque filename without .json",
  "payloadHash": "SHA-256 from private-index.json",
  "pass": "correctness",
  "judge": 1,
  "verdict": {"C": true, "O": true, "R": null},
  "findings": [],
  "citations": [],
  "rationale": "Concise pass-specific explanation.",
  "execution": {
    "requestedModel": "gpt-6.1-sol",
    "observedModel": "gpt-6.1-sol",
    "effort": "xhigh",
    "command": "codex exec -m gpt-6.1-sol -c model_reasoning_effort=\"xhigh\" --ignore-user-config --disable hooks",
    "session": "unique fresh session ID",
    "nonAuthor": true,
    "isolated": true,
    "noPriorJudgments": true
  }
}
```

Correctness verdicts contain C, O, R (R means causal content only). Support
verdicts contain only R (submitted causal support). Values are true/false/null;
null remains unresolved. Findings/citations are structured arrays; rationale
must be nonempty. Execution fields are mandatory attestations whose external
truth the primary must verify. Third sessions see the same original pass
payload and no previous judgments. Matching non-null first-two vectors resolve;
otherwise an independent third is required. Unnecessary thirds are rejected.
Every exported referral needs resolution, even when mechanical J is forced zero.

The gate combines factual C/O with `R=causalCorrectness AND support`, then J per
observation. It preserves forced zeros and unresolved components. It evaluates
all §8 observed threshold rows, including actual designated referral quotas,
per-style referral errors, evidence support panel and final R, matched-style
error spread, first-two component-vector agreement before resolution, and no
unresolved verdicts. It reports pass-specific errors, κ, descriptive rates,
independent-world/key denominators and Wilson 95% intervals. A world-level
error means at least one erroneous variant; variants are not independent trials.
Matched positives are reused across C/O/R and disclosed. No generalized mappings
are propagated. External non-author/ancestry/resource/continuation gates remain
outside this calculator; passing it alone cannot authorize paid work.
