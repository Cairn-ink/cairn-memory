# Fresh reliability development smoke

This maintainer-only wrapper freezes six new LongMemEval cases, one per existing
question type, then delegates to the reviewed public-pilot CLI. It measures the
embedded shared core's default capture and recall with the unchanged three
arms and answer-template v2. It does not enable native v2 qualification,
explicit recovery or `captureDeadlineMs`. The [frozen contract](plans/fresh-reliability-smoke.md)
governs scope; this is a development plumbing smoke, not a held-out benchmark
or evidence of semantic improvement.

## Private inputs and plan

The operator prepares a new 0700 directory outside the repository. The source
file is the already retained 500-case JSON array, and the exclusion file is a
JSON array of all 82 previously reserved or used source question IDs. Both and
all prepared/sidecar/ledger configuration/plan files must be regular 0600
files without symlinked ancestors. The previously authorized local key file is
read only at launch through a bounded, no-follow descriptor; its existing mode
is not changed. No source or key is copied into the repository.

Selection ranks each remaining ID inside its question type by the bytewise
SHA-256 hex digest of `cairn-s1-fresh-smoke-2026-09-25:` plus that ID, using
bytewise ID order to break ties. It takes one per type, then executes in source
dataset order. Selection reads only ID and type for ranking. Prepare those six
with `prepareLongMemEval`, then create the evaluator-only reference sidecar with
the existing Python renderer. Freeze every raw file digest and both selection
digests before any provider call. A selected case is never replaced.

`launch-plan.json` is a private 0600 JSON file with exactly this shape; all
paths are absolute, and `outputDirectory` is a new direct child of the plan's
0700 parent. Fill IDs, hashes, checkpoint and projection from the frozen
private evidence. The two selection hashes are SHA-256 of JSON arrays: sorted
selected source IDs for `membershipSha256`, and selected IDs in source dataset
order for `preparedOrderSha256`. The checkpoint digest is SHA-256 of sorted-key
JSON for the ordered existing ledger attempts, projected to the five fields
`attemptId`, `channel`, `reservedMicroUsd`, `outcome`, `actualMicroUsd`.

```json
{
  "version": "cairn-fresh-reliability-smoke-launch-v1",
  "source": { "path": "/private/source.json", "sha256": "<64 lowercase hex>" },
  "exclusions": { "path": "/private/exclusions.json", "sha256": "<64 lowercase hex>" },
  "prepared": {
    "directory": "/private/prepared",
    "manifestSha256": "<64 lowercase hex>",
    "historySha256": "<64 lowercase hex>",
    "questionsSha256": "<64 lowercase hex>",
    "evaluatorSha256": "<64 lowercase hex>"
  },
  "sidecar": { "path": "/private/reference-sidecar.json", "sha256": "<64 lowercase hex>" },
  "ledger": { "path": "/private/ledger-config.json", "sha256": "<64 lowercase hex>" },
  "selection": {
    "membershipSha256": "<64 lowercase hex>",
    "preparedOrderSha256": "<64 lowercase hex>"
  },
  "runtimeCommit": "<40 lowercase hex>",
  "authorizations": {
    "benchmark": "<existing ID>",
    "requestAllowance": "<existing ID>",
    "budgetExtension": "<existing ID>",
    "case": "<new ID>",
    "execution": "<new ID>"
  },
  "checkpoint": {
    "requestCount": 0,
    "reservedMicroUsd": 0,
    "attemptsSha256": "<64 lowercase hex>"
  },
  "projection": { "requests": 0, "reservedMicroUsd": 0 },
  "outputDirectory": "/private/new-run",
  "keyFile": "/private/previously-authorized.env"
}
```

The example zeroes are placeholders, not a runnable launch. The wrapper
requires an exact clean checkout at `runtimeCommit`, exact source/prepared/
sidecar/selection bytes, the existing benchmark → request allowance → budget
extension chain, an open settled ledger at the frozen checkpoint, and absent
new output/capability/claim/launch-marker identities. It does not create a new
ledger, grant, allowance or budget extension.

## Preflight and one-shot launch

Run the wrapper's `--dry-run` without a provider key. It recomputes the six-case
projection from prepared history, enforces at most US$12 and 2,000 requests,
then calls the public-pilot CLI's keyless dry-run with the existing grant
loaders, answer-v2 and a phase cap equal to the full frozen projection. It
compares the delegate's projection and the ledger plus all authority binding
bytes before and after. This path supplies no case-deadline flags, because the
existing delegate could provision a missing capability if it received them.
The dry-run therefore does not prove capability issuance.

```sh
node evaluation/live/reliability-smoke-cli.mjs --plan /private/launch-plan.json --dry-run
```

After the final independent review and an unchanged checkpoint, the primary
operator may call `--launch` once. The wrapper recomputes all preflight checks,
durably creates a 0600 launch-attempt marker before reading the authorized key
or importing the delegate CLI, then supplies the complete `case-deadline-v1`
identity and `bounded-v1` transport diagnostics. A failed launch is terminal;
the marker and any claim are never removed or reused. The delegate retains all
case artifacts in its 0700 output directory. The wrapper prints only counts
and fixed status codes, not question IDs, answers, private paths or credentials.

```sh
node evaluation/live/reliability-smoke-cli.mjs --plan /private/launch-plan.json --launch
```

For `b` planned capture batches, the unchanged default path calls at most one
extract and one initial classify model method per batch, two select methods
and one rank method per recall, three answer requests and three judge requests.
Each Cairn model method makes at most one count and one generation HTTP request
without retries. The bound is `4b + 12` requests and
`(4b + 6) × 5,000 + 3 × 50,820 + 3 × 10,400` micro-USD in reservations per
case. The public runner checks this before each case and scoring phase; the
shared ledger also enforces its cumulative ceiling. These are reservation
bounds, not actual invoices. Failed and unknown attempts remain charged.

## Reading a result

Use the private `report.json`, `aggregate.json`, and per-case generation,
scoring, accounting, truncation and diagnostic files. For each of the three
arms, report fixed `N=6`, completed answers, judged answers, correct, wrong
and unresolved separately. Also report generation/scoring failures, blocked
reasons, reserved and known/unknown cost, request count, receipt truncation,
and candidate versus answer-packed counts. Keep every selected case in the
denominator. Completion of at least 95% means 6/6 in each arm; it is a
plumbing checkpoint, not an accuracy target. A failed checkpoint blocks
scale-up, while read-only diagnosis can continue. Do not tune on or rerun this
roster, compare unlike historical cohorts as if matched, or claim superiority
from six cases.

`npm run test:live-evidence-offline` exercises this wrapper on synthetic
prepared files and ledgers with fake HTTP only, including actual delegated
CLI execution, read-only dry-run, one-shot launch, deadline isolation and
global halt. It needs no provider key or paid call.
