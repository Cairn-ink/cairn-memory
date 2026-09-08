# Source-faithful extraction instructions

Base `6727859df803e162b98b891eb1a2049e92773d07` (PR #20).
Frozen rerun at `a6c093b59f07643dddf22c59c6f6e596551c9901` completed 36/36,
but independent agent review rejected two captured claims in C02 repetition 2:
source "Harbor uses Go" / "Juniper uses Python" became software "implemented
using" those languages. Usage does not establish implementation. Retain this
failure even though recall was 45/45; supported-source acceptance is mandatory.

## Ranked hypotheses

1. The concise-standalone-memory instruction permits plausible specificity:
   explicit relation/modality preservation should reduce these unsupported claims.
2. Storage normalization rewrites relationships: inspect the actual admission
   path and a scripted capture roundtrip; if strings survive except documented
   normalization/redaction, the strengthening originates before storage.
3. The pinned model may strengthen statements despite clear instructions:
   retain failures, and do not claim general source entailment from a small run.

## Acceptance F01–F07

- F01: Preserve observed failed evidence and unchanged frozen corpus/rubric.
  Add a deterministic regression at the actual extraction port before changing
  instructions. It must fail on the missing relation-preservation policy and
  test a faithful scripted capture/receipt roundtrip, not pretend to grade a model.
- F02: Clarify preservation of original relationship, negation, modality,
  attribution and uncertainty. Do not expand uses into implementation, proposal
  into adoption, or adoption into completed deployment absent evidence. Avoid
  corpus-specific names/answers; paraphrases remain permitted when entailed.
- F03: Do not invent entity type/role or inferred exclusivity to make a memory
  standalone. Omit unsupported additions instead of assigning high confidence.
  Empty extraction and the existing source-index authority remain unchanged.
- F04: Prompt-only behavior change; no core storage rewrite, additional model
  call, model switch, schema change, retry or budget/rubric relaxation.
- F05: DRI performs a bounded synthetic actual extraction/capture probe and
  independently inspects its evidence. Then rerun the unchanged 36-case suite
  separately. Neither prompt-contract tests nor the minimized probe proves
  general entailment; every paid attempt remains in the ledger.
- F06: Relevant regressions, complete core/adapter tests and demos pass on
  Node22.16/24; plugin/JSON/strict plugin gates stay green. No CI paid calls.
- F07: Independent Standards/Spec review exact candidate before a dependent PR.
  No self GitHub merge, publication, deployment, production or private env copy.

## Budget before this change

Previous total US$0.960768 plus unchanged-suite rerun US$0.987456 =
US$1.948224 reserved, leaving US$3.051776 of the authorized US$5.
DRI alone controls paid calls. Failed runs are not refunded or dropped.

## Verification evidence

- RED before instruction edits: `node --test core/test/extraction-prompt.test.mjs`
  failed the actual delivered-system assertion `/preserve[^\n]*relationship/i`;
  the separate faithful scripted capture/receipt roundtrip already passed.
  After the prompt-only change both tests passed. These test instruction delivery
  and storage contracts, not semantic model quality.
- Storage inspection: `core/capture-input.mjs:39` normalizes extracted content
  with `boundedText`; `core/validation.mjs:37` applies NFKC, secret redaction,
  whitespace normalization and bounds, not relationship rewriting.
  `core/runtime.mjs:158` persists the admitted content directly. The scripted
  roundtrip retains usage, possibility, attributed proposal and non-adoption,
  together with their original trusted receipts. This does not demonstrate that
  storage detects unsupported statements supplied by a model.
- DRI minimized actual probe: four HTTP responses, all 200; both usage memories
  retained their separate source receipts and were filed. DRI's narrow predicate
  and manual source inspection passed; neither claim became implemented software.
  Private local evidence: `/tmp/cairn-extraction-probe-EGaEiA/evidence.json`.
  An earlier import failure occurred before credential read/network (zero HTTP);
  after installing the isolated dependency, the DRI executed one paid probe.
  Probe reservation US$0.017792; reported usage 1,529 input / 161 output tokens,
  estimated cost US$0.0008692. Cumulative reservation US$1.966016, remaining
  US$3.033984. This is only minimized-probe acceptance, not the unchanged
  36-run semantic evaluation or general source entailment.
- Independent fixed-candidate reviews and the unchanged-suite rerun remain
  separate DRI gates; the earlier failed evidence above is not superseded by
  this probe.
- Offline gates passed on Node 22.16.0 and 24.20.0: combined complete
  `core/test/*.test.mjs`, `adapters/openai/test/*.test.mjs`, and
  `plugins/cairn-memory/test/*.test.mjs` suites; all nine store/MOC/recall/
  admission/capture/conflicts/rebuild/continuation/offline-provider demos.
  JSON/version validation, marketplace validation and strict plugin validation
  also passed. Initial combined runs failed because this fresh worktree lacked
  `tiktoken`; installing locked isolated dependencies and rerunning produced
  exit 0 on both runtimes. No offline check made a paid request.
