# Ingestion design comparison — stage 1

Fixed base: `9b007534df4e74c63bf8d544f3bf5fa3b29bcab2`.
Question: is a separate qualification model call worth its complexity, or can
source-backed interpretation be produced with extraction at lower bounded cost?
Product goal remains lightweight, reliable shared memory usable through MCP and
Hermes. Qualification means attributed scope/commitment and evidence, not truth.

## Delivery slices and decision gates

This first slice is a small **offline engineering decision experiment**, not a
semantic evaluation, replacement engine, production wire change or paid launch.
Use existing serializers, token counting, source handling and validators where
possible. Do not build a second general-purpose benchmark runner. A subsequent
real-model experiment is needed before choosing a product implementation.

1. Offline feasibility: compare legacy extraction, current two-stage whole-batch
   qualification, current bounded-partition qualification, and an evaluation-only
   combined extraction/qualification prototype. Preserve explicit differences in
   source exposure; never imply like-for-like semantics where inputs differ.
2. Fresh synthetic real-model comparison: freeze source-only cases, blinded
   semantic rubric, model/configuration, repetitions and resource projection
   before calls. Compare interpretation correctness, mechanical completion,
   source attribution, cost and latency. Reuse the cumulative US$200 budget and
   existing accounting, never reset it or rerun consumed benchmark questions.
3. Only an evidence-backed winner receives a separate integration contract and
   installed MCP/Hermes verification. No default changes follow this slice.
4. Then fresh six-type feasibility, fixed 30-case comparative scoring, targeted
   MOC corrections and ordinary-user acceptance follow the agreed product plan.

## Offline acceptance (D1–D8)

- D1: Freeze deterministic synthetic fixtures before measurements: short fact,
  uncertain cause, proposal versus adoption, attributed assistant suggestion,
  decision reason and later challenge, older event imported later, distinct
  multi-source long batches, repeated source text, and Unicode boundaries.
  Expected interpretations are evaluator/test data, never extraction or combined
  request/schema inputs. A downstream qualifier necessarily receives the
  scripted extractor's cards as normal pipeline input: these are explicitly
  output-conditioned mechanics, not a blind end-to-end semantic evaluation.
  Include one/five-item and a genuinely unfit input. Record exact exposed text
  and limits. No user data, downloaded corpus, credentials or operational ledger.
- D2: Trace real extraction and qualification entrypoints and their source
  retention differences. Measure the unchanged whole-batch and bounded-partition
  paths through existing adapter/core capabilities; clearly label reconstructed
  versus actually captured fake-HTTP bodies. Legacy extraction is a resource
  control, not a qualified/reliability-equivalent solution. Count extraction AND
  qualification; exclude classification only if uniformly disclosed.
- D3: Combined prototype must be confined to `evaluation/ingestion-design/`.
  Inputs contain source text/roles and stable request-local evidence candidates,
  not gold cards, expected labels or evaluator answers. Output proposes card
  content/kind plus qualification and citations. References must resolve to
  exact core-owned canonical source text; no model-authored offsets, quotes,
  dedup/repair, fallback evidence or identity/currentness/authorization claims.
  Reuse core validation when compatible; document any unavoidable contract or
  source-exposure difference. No production import of the prototype.
- D4: Measure full serialized request/schema/input and output sizes with the
  existing tokenizer and fixed 6,000 local/7,024 provider/1,024 output ceilings.
  Local modeled counts are NOT observed provider acceptance. Report refusal,
  number of count/generation pairs and total input/output work, not only a
  smaller prompt. No silent source truncation, raised cap or after-failure retry.
  Since extraction outputs vary, scripted output-conditioned measurements are
  explicitly conditional, not workload expectations or a measured dollar bill.
- D5: Tests must reject foreign/cross-source citations, missing evidence for
  known fields, malformed/missing/extra output, and capacity violations.
  Invalid outputs produce no admitted result; prototypes have no persistence.
  Preserve uncertainty/scope/attribution in scripted fixtures but label that
  result plumbing, not semantic accuracy. A plausible-but-wrong interpretation
  with valid evidence must demonstrate why structural validation is insufficient.
- D6: Report includes each arm's capabilities and omissions, fixture denominator,
  prompts/schema digests, measurement provenance, refusal reasons, calls and
  resource totals. Repeat report twice on Node 22.16 and 24.15 with identical
  deterministic output. Decide reject/revise/eligible-for-live-test, NEVER adopt
  based only on scripted outputs. If no advantage, do not force a replacement.
- D7: Allowed implementation paths: `evaluation/ingestion-design/`, one test
  entrypoint `adapters/openai/test/ingestion-design.test.mjs`, this plan,
  bounded evidence append in `docs/limitations.md` and status pointer in ROADMAP.
  No core/adapter/runtime/package/CI/guard changes, installations or releases.
  Dependency installation uses existing isolated locks only. Do not read env keys.
- D8: Run focused tests, report twice, generic tests, JSON/version validation and
  strict plugin validation on Node 22.16/24.15; run full existing OpenAI offline
  suites on both for imported adapter assumptions. Primary inspects combined
  diff, reruns key cases and confirms production files unchanged. Freeze one
  candidate and obtain independent Standards/Spec reviews before PR delivery;
  all latest-head CI must pass. No TypeScript gate exists in this JS repo.

CI routing note: the discovered test belongs to the existing OpenAI suite,
which installs the tokenizer dependency on Node 22/24. Generic Node 20/22 CI
does not install that dependency; do not make the generic suite import it.

## Ownership and evidence

Primary owns contract, comparison fairness, direct acceptance and delivery.
One bounded GPT-6 Sol/high worker owns implementation (user requested model 6;
this overrides older model names in routing). Two independent reviewers inspect
the same final base/head. Record results, corrections and exact commands here or
in the PR. Token/spend metrics are unknown unless actually exposed.

This is a reproducible evaluation module with tests, not a UI/state walkthrough;
the UI-oriented throwaway prototype skill is not the owning workflow.

## Stage 1 offline result

The [bounded evaluator report](../../evaluation/ingestion-design/README.md)
compares 12 frozen synthetic cases. Completed scripted paths: legacy 11/12,
whole-batch qualified 10/12, bounded-partition qualified 11/12, combined 10/12.
Both qualified arms use the same inline/catalog fit capability; only the
bounded arm executes unchanged core singleton planning. Combined and qualified
extraction use the same retained source prefixes; later qualification sees
selected receipts while combined sees all retained sources before card selection.
Legacy is an unqualified resource control with different exposure.

All fitting combined cases compile to the same exact source bindings and
scripted qualifications as the actual adapter/core bounded path. The medium
20-source case completes six current extraction/qualification pairs, while
whole-batch refuses after extraction and combined refuses before dispatch.
The genuinely unfit case refuses in every arm. Failure work is retained in
totals. Selected legal-long outputs exceed the output ceiling in both designs;
these are selected cases, not universal token upper bounds.

Decision: **revise before live test**, with no default or implementation adoption.
The short case's modeled generation input is 2,249 tokens versus 2,876 across
current extraction and qualification (21.8% lower for these scripted outputs).
This is local serialized resource evidence, not provider acceptance, observed
dollars, latency or semantic accuracy. Structurally valid wrong interpretation
and all-unknown tests demonstrate that matching sources does not establish
meaning. No store, classification, key, operational ledger or paid call is used.

Fixture SHA-256:
`778e6292fb3fc4ca4ca87d1b7922c2923cff20c41e77cdfa55a1b576a3a7ee86`.
Final report SHA-256 including newline:
`ff974bfa10e8d64900d6a18fc1fea1972e238cf74be0d30129820bb8fe59cbf8`.
The report includes exact exposed sources, all request/schema digests, captured
versus reconstructed provenance, refusal reasons, pairs, full serialized input
and output counts. Future paired semantic comparison remains separately frozen
and authorized; no existing extraction guard accepts this combined wire.

### Verification commands

Run each under `PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:$PATH`
and then `PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:$PATH`:

```sh
node --test adapters/openai/test/ingestion-design.test.mjs
node evaluation/ingestion-design/report.mjs
node evaluation/ingestion-design/report.mjs
npm test
npm run validate
npm run validate --prefix tools/plugin-validation
npm run test:openai
```

Focused tests: 9; generic tests: 112; full existing OpenAI offline suite:
254 including the new 9; JSON/version and strict marketplace/plugin validation
pass on both runtimes. Report repeat hashes match on both. Logs are retained
under `/tmp/ingestion-design-<runtime>-*`; the primary independently validates
the final candidate before delivery reviews/PR.

Retained development correction: the initial focused run was 8/9 because an
extra malformed field escaped as `invalid_input`; the evaluator compiler now
maps output-validation failures to `invalid_model_output`. No result is returned
for invalid output, including a valid first item and invalid second item; no
persistence exists. Preliminary prompt/output authoring corrections and the
unchanged source fixture digest are documented in the evaluator README.
