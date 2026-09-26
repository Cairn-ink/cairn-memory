# Installed qualified source-pair launch (offline-verified)

The maintainer CLI connects the separately versioned N generation, P scoring,
and G guarded transport to an installed Cairn artifact. This packet is verified
only with synthetic prepared cases, temporary ledgers, local installed cores,
and fake HTTP. It does not authorize a paid run or prove answer quality.

The command is `node evaluation/live/qualified-source-pair-launch-cli.mjs
--plan /absolute/private/plan.json --dry-run` or, only with separately frozen
experiment authority, `--launch`. There is no default mode. Dry-run verifies
the full plan, installed artifact, prepared inputs, parent grant, settled
ledger checkpoint, roster and protocol digests without reading the key,
claiming a grant, sending HTTP or writing files. Launch repeats preflight,
durably creates a private one-shot marker, then reads the key and consumes one
G claim. A changed plan or used marker/claim refuses; the launcher never
resumes or retries a crashed execution.

The exact plan version is `cairn-qualified-source-pair-launch-plan-v1`. Its
required keys are `schemaVersion`, `executionId`, `prepared`, `installed`,
`harness`, `ledger`, `parent`, `checkpoint`, `answerModel`, `limits`,
`judgeTimeoutMs`, `roster`, `phaseCaps`, `outputDirectory`, and `keyFile`.
`referenceSidecar: {path, sha256}` is the sole optional key, required for
non-string reference answers and verified by the existing reference loader.
Unknown keys are rejected. The execution ID is 1–80 safe characters. Private
input/output directories are mode 0700 and files mode 0600; the installed
public runtime may retain normal package permissions.

- `prepared` binds its absolute directory and SHA-256 of manifest, history,
  questions and evaluator files. `roster` must enumerate **all** prepared
  cases in order, with each opaque `questionId`, both `armOrder` values and
  independently computed `protocolDigest`.
- `installed` binds a verified installation receipt path/hash and artifact
  hash. `harness` binds the checkout commit plus a closed set of critical
  source-file hashes, including official scoring and source canonicalization.
- `ledger` is the exact existing configuration. `parent` is the complete
  bound US$100 or chained US$200 monetary grant with common G policy/stages.
  `checkpoint` binds request count, full reserved micro-USD and the canonical
  complete attempt-history digest. The read-only parent inspector requires an
  open, fully settled ledger; it never upgrades or grants a cap.
- `limits` holds positive context-window, output-token, answer-timeout and
  recall limits. The guard's answer and judge deadlines must precede these
  N/P backup timers by at least one second. `phaseCaps` has generation and
  scoring `{requests, reservedMicroUsd}`; both sums must fit remaining global
  headroom before a claim.

The private phase quota checks exact route/stage, guard state and both ceilings
synchronously before each guarded dispatch. It charges one full reservation
even if G later refuses; there is no refund. One G instance owns every Cairn,
answer and judge attempt. Generation for every case precedes scoring for any
case. Each case has two fresh installed SQLite cores, common source-bound-v2
qualification and distinct prefix/indexed source policies. The launcher
passes a separately derived full protocol to P, never the report's self-digest.

An installed core loads a separate copy of its model-call module, whose
deadline signals have private WeakSet provenance. The pair-only guard accepts
an opaque in-process token from the closed installed-deadline loader after the
artifact is verified. The loader checks the installed model-call module and
its four exact dependencies against trusted checkout bytes before import.
G still recognizes genuine checkout deadlines, but foreign-module signals,
ordinary external aborts and spoofed abort reasons remain global failures.
Forged/cloned tokens refuse before a claim. This does not make arbitrary
installed code or an external provider trusted.

The private output tree contains a manifest, per-case generation/scoring
records and a versioned terminal `report.json` when persistence succeeds. The
report keeps fixed-roster denominators, unresolved slots, shadow dispatch
totals **separate** from durable ledger reservations/actual-known/unknown
cost, guard attempts, timeouts, transport diagnostics, latency and storage.
Failures after the marker best-effort write a bounded redacted failure record;
even if that write fails, the marker remains consumed and the CLI exits nonzero.
An interrupted process may leave only marker and ledger evidence.

CLI output contains only allowlisted codes and bounded aggregates, never
source text, answers, evaluator labels, credentials or private paths. A
`completed` orchestration status is **not** a fully resolved roster, a ≥95%
completion rate, an accuracy result, a parity claim or permission for L6 paid
work. Inspect the fixed-roster aggregate and unresolved counts separately.
The local fake-HTTP tests establish plumbing and finite failure accounting,
not semantic relevance or real-provider cancellation/billing.
