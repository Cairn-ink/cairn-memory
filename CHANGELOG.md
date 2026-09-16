# Changelog

## Unreleased — explicit local MCP rationale re-review

- Independent `--rationale-review replace-reviewed-v1` exposes a strict,
  startup-namespace-bound `review_rationale` tool and keyless inspection. It
  uses the embedded bounded replacement mode, not a second engine or model port.
- Automatic capture stays append-only, default tool sets stay unchanged, and
  no capture retention, hosted wire field or provider spending grant is added.
  Proposed links remain unverified; empty or mistaken re-review can withdraw
  in-scope links without changing source records.

## Unreleased — explicit bounded rationale replacement

- Embedded `reviewRationale` accepts opt-in `writeMode: 'replace-reviewed'` to
  transactionally retract and insert proposed links only between its guarded
  current refs. Empty output clears that bounded set; unchanged output does not
  advance the namespace epoch. Crossing and unrelated links remain.
- Default and automatic-capture reviews stay append-only, with their original
  response shape. Model interpretations remain unverified; a mistaken replacement
  can remove a correct link. No schema, provider port, MCP or hosted change.

## Unreleased — independent provider usage bounds

- The optional OpenAI adapter accepts bounded observed input usage that differs
  from preflight, checking both against the unchanged provider-input and context
  limits. Output ceilings, usage consistency, source checks and no-retry behavior
  remain intact; this does not widen experiment budgets.
- A retained synthetic discrepancy is reproducible through offline HTTP replay.
  Its provider-side cause is unknown. The historical failed run stays failed;
  this transport repair is not evidence of better memory or answer quality.

## Unreleased — experimental checklist selection adapter capability

- The optional OpenAI adapter adds an explicit `selectChecklist` method using
  the existing selection model profile and bounded count/generation transport.
  Ordinary selection, core defaults, storage and MCP behavior remain unchanged.
- An evaluation-only wrapper compiles bounded question-linked proposals into
  the existing reference selection shape after checking raw output tokens.
  This is an integration capability, not evidence of better recall or answers.
- Existing experiment guards do not authorize this new method. A separately
  scoped immutable capability and frozen comparison are still required before
  paid evaluation; no package release or deployment is included.

## Unreleased — explicit keyless source snapshot over MCP

- Local stdio `--source-snapshot current-admitted-v1` adds `read_memory_sources`,
  bound to the startup namespace and delegated to the unchanged shared core.
- Keyless opted-in startup uses the optional adapter's existing local tokenizer
  through `countOpenAITokens`; default keyless startup and syntax checks do not
  load it. No provider calls, fake keys, relevance fallback or generation.
- Reads expose the entire bounded current-admitted source set, potentially
  including unrelated content. Core envelope budgets exclude MCP framing and
  host prompts; semantic fidelity and previous answer failures are unchanged.

## Unreleased — bounded complete admitted-source snapshot

- Embedded `sourceSnapshot` can explicitly return all current admitted sources
  in a small authorized read set without relevance filtering or generation calls.
  A local exact token counter is required; defaults remain unchanged.
- Whole-response memory, token and byte limits fail without partial content or
  fallback. A final atomic reread rejects concurrent memory or source changes.
- Sources may be unrelated to the task; complete admitted coverage does not
  establish truth, current applicability or downstream answer fidelity. No MCP
  tool, new storage schema, provider request or telemetry is introduced.

## Unreleased — explicit staged evidence over MCP

- Local stdio hosts can explicitly opt into bounded source staging with
  `--capture-evidence staged-v1` and source-bound-v2 capture. Defaults remain off.
- Independent `--capture-evidence-access staged-v1` exposes keyless inspect and
  discard tools without enabling new retention or model work. Tools remain
  bound to the startup namespace; failed sources never become ordinary recall.
- Help and tool descriptions explain event closure and namespace-wide staged
  clearing on successful correction/forgetting, including after disabling
  retention. This is not automatic capture, retry, promotion or secure erasure.

## Unreleased — opt-in staged capture evidence

- Embedded source-bound-v2 capture can explicitly retain a bounded source view
  before interpretation. Failed captures remain inspectable without becoming
  searchable memories or automatically retrying. Defaults and MCP are unchanged.
- Discard fences that event's unfinished admission. Successful correction or
  forgetting conservatively clears all staged sources in the exact namespace
  and prevents old event replays, including through the legacy facade.
- Database v13 adds staging and clock metadata; stop older connections before
  upgrading. Payload quotas and logical expiry do not imply secure erasure or a
  bound on all database metadata. See `docs/staged-capture-evidence.md`.

## Fix — candidate qualification transport mapping

- The optional OpenAI adapter now requests one required named response field per
  source-bound-v2 candidate item and validates it before restoring the existing
  core array contract. Duplicate/missing item mappings are not repaired or
  admitted. No new dependency, model call, retry or storage format. Semantic
  support remains unassessed; the failed longer-history experiment is preserved.

## Hermes — opt-in source recall preference

- Native Cairn profiles can select `recall_context: source-evidence` so query-only
  recall returns original submitted receipts without generated interpretations.
  Explicit tool arguments override the preference; existing profiles and MCP
  defaults are unchanged. Scripted host integration is not semantic certification.

## Evaluation — longer captured source history

- Add a bounded, source-first diagnostic separating capture loss, MOC versus
  lexical receipt coverage and downstream answer outcomes over a frozen longer
  history. Partial recall remains scored even when answer policy abstains.
  Offline orchestration only; see `docs/long-source-history.md` for the live gate.

## Evaluation — installed source-to-answer delivery

- Join actual cold installed MCP source recall to a bounded, injected answer
  consumer; preserve original provenance, reject partial/wrong-context inputs,
  and never treat completion as verified truth. Scripted installed regression
  only, not named-host or real-model quality evidence. See `docs/installed-source-answer-delivery.md`.

## Evidence — downstream source answer utility

- Preserve sixteen real-model answers: twelve useful source-supported responses
  and four appropriate no-memory abstentions, with detail omissions retained.
  No demonstrated advantage from adding basis interpretations or from MOC over
  lexical sources in these four development cases. See `docs/source-answer-utility.md`.

## Evidence — installed source-loop controls

- Preserve four real capture/restart/MOC-recall cases and twelve basis controls.
  Required sources survived, but new-reason omissions and one role-contract
  rejection remain. No answer-accuracy or general reliability claim.
  See `docs/source-loop-results.md` for all outcomes and the downstream utility gate.

## Evaluation — capture-to-basis loss controls

- Add an offline diagnostic driver for actual capture/restart/MOC recall and
  basis interpretation, with lexical and all-captured-source controls. Preserve
  missing evidence and wrong-but-accepted proposals without claiming quality.
  See `docs/source-loop-controls.md`; paid installed validation remains pending.

## Evidence — source-addressed development ablation

- Preserve all 48 real-model installed-core arms: structural completion was
  16/24 original versus 18/24 addressed, not an accuracy result. Exact ranges
  coexist with accepted semantic regressions; no default promotion.
  See `docs/source-addressed-ablation-results.md` for all-case review and limits.

## Unreleased — experimental source-addressed basis review

- Add an opt-in mode selecting core-enumerated source ranges instead of
  reproducing quote text; repeated occurrences keep distinct exact anchors.
- Explicit premise-update units can both challenge an old reason and support
  a recorded new choice. Original modes and all resource/trust bounds remain
  unchanged. No semantic improvement, state mutation or default promotion claimed.

## Evidence — source-context development ablation

- Preserve all 48 real-model installed-core arms, including 25 rejected outputs.
  Added context citations did not improve mechanical completion; semantic errors
  remain in accepted proposals. No default promotion or reliability claim.
  See `docs/source-context-ablation-results.md` for evidence and next design tests.

## Unreleased — opt-in source-context basis proposals

- Embedded decision-basis review can attach exact receipt-bound subject,
  applicability, scope and commitment citations to each proposed unit.
  Unknown context stays null; citations remain unverified interpretations.
- Preserve default behavior, resource limits and read-only lifecycle. No
  automatic state changes, new model grant, MCP tool or quality claim.

## Unreleased — decision-chain validation for source-basis challenges

- Reject a current-basis challenge unless its premise also supports a decision
  in the same proposal. Preserve whole-output rejection, source data and all
  existing bounds; never manufacture adoption or repair the graph.
- Structural chains do not prove semantic correctness or resolve time/scope
  errors. No model default, persistence or migration changes.

## Evidence — source-basis comparison v1

- Preserve all48 real-model installed-core arms, including five rejected outputs
  and accepted semantic mistakes. Exact quote/type checks are not entailment.
- Source-bound units isolate affected reasons in selected cases, but attribution,
  temporal scope and reaffirmation errors remain. No default promotion.
  See `docs/source-basis-comparison-results.md`.

## Unreleased — bounded source-basis comparison preparation

- Separate basis-only experiment capability and parent session keep every old
  grant unchanged. A closed comparison attempt permits relate/reviewBasis with
  three fixed models, capped at 96 HTTP / US$2.048 inside the aggregate ledger.
- Offline safety checks are not semantic evidence; no paid run, automatic grant,
  default promotion or publication. See `docs/source-basis-comparison.md`.

## Unreleased — experimental source-bound decision-basis review

- Embedded callers can inspect exact quoted decision, premise and update units
  without persisting model proposals or changing recorded decisions/history.
- Typed links distinguish support from challenges to current applicability;
  roles and semantics remain unverified. Independent basis model control and
  installed prompt are opt-in; old paid guards deny the new method.
  See `docs/source-basis-review.md` for boundaries and missing quality evidence.

## Evidence — rationale model control v1

- Preserve 48 real-model installed-core arms comparing baseline, Luna and Sol
  within source-only and claim-focus modes, including remaining failures.
- Model capacity helps selected cases but does not resolve whole-memory premise
  ambiguity or establish full-loop reliability. No default model is promoted.
  See `docs/rationale-model-control-results.md`.

## Unreleased — fixed rationale-model comparison attempt

- Add a relation-only parent session and a closed 96-HTTP / US$2.048 local
  comparison cap inside the existing ledger. Existing attempt limits remain.
- No operator, paid run, automatic grant or model-quality claim is included.

## Unreleased — isolated rationale-model experiment guard

- Add a separately bound, relation-only experimental capability for baseline,
  Luna and Sol. Existing grants, defaults and aggregate ledger remain unchanged.
- Fixed per-HTTP reservations include count calls; no live run is initiated.
  See `docs/rationale-model-guard.md` for the separate operator prerequisites.

## Unreleased — independent rationale model controls

- Embedded OpenAI adapters can explicitly select Luna or Sol for relate alone,
  independently of extraction. Existing baseline and MCP defaults remain.
- No semantic success, live guard grant or automatic upgrade is implied.
  See `docs/rationale-model-controls.md` for bounded framing and cost estimates.

## Evidence — claim-focus ablation v1

- Preserve all 16 installed-core real-model arms. Unverified focus did not reliably
  repair endpoint identity, direction or scope; semantic gate not passed.
- Mechanical persistence succeeded but is not semantic accuracy. No promotion to
  automatic capture defaults. See `docs/claim-focus-ablation-results.md`.

## Unreleased — experimental rationale claim focus

- Embedded review may opt into unverified stored-content focus alongside complete
  receipts to distinguish claims sharing a source. Exact focus participates in
  existing snapshot, freshness and budget bounds; source-only defaults remain.
- This is an input-information ablation, not demonstrated semantic improvement.
  Automatic capture/MCP defaults are unchanged. See `docs/rationale-claim-focus.md`.

## Evidence — source-selection ablation v1

- Preserve all 16 one-shot installed MCP arms. Source scan recovered three
  substantive updates excluded by baseline selection; one additional source
  was ranking-dependent suggestion provenance. No irrelevant sources returned.
- Manual oracle ingestion and eight synthetic pairs do not establish answer
  accuracy or rationale quality. Default recall is unchanged and the rationale
  semantic gate remains failed. See `docs/source-scan-ablation-results.md`.

## Unreleased — bounded source-selection experiment

- Freeze eight synthetic oracle-ingested cases and a one-shot installed MCP
  comparison of label-prefilter and source-scan recall, with separate source
  coverage/irrelevance evidence and a narrow 64-HTTP/US$0.32 attempt cap.
- Offline preparation only; no live improvement claim. Existing grants, older
  attempt caps and product defaults remain unchanged. See
  `docs/source-scan-ablation.md`.

## Unreleased — opt-in bounded source-first selection

- Offer a source-context recall mode that skips label prefiltering only for a
  complete small MOC within existing candidate bounds. Larger maps keep the
  original path; default recall is unchanged. Actual strategy is reported.
- This may send more authorized source text to the ranker, with existing token
  limits unchanged. It is an architectural ablation, not a semantic-quality
  claim. See `docs/bounded-source-selection.md`.

## Evidence — rationale pilot v1

- Preserve the one-shot 16-arm real-provider installed MCP comparison with a
  source-linked public export. All mechanics completed; semantic gate failed:
  missed challenged reasons, ambiguous subject binding and one false-decision
  link remain. Expose proposals separately from returned graph projections.
- Record conservative/known/unknown costs and independent agent judgments without
  rerunning failures or changing product defaults. See `docs/rationale-pilot-results.md`.

## Unreleased — installed rationale comparison runner

- Freeze eight synthetic two-event cases and a separate evaluator-only rubric.
  Add a one-shot installed MCP baseline/rationale comparison with 16 retained
  arms, guarded transport, keyless cold inspection/replay and forgetting checks.
- No semantic score is implied by the scripted installed tests. Live execution
  and independent source-versus-output assessment follow verification and review.
  See `docs/plans/rationale-installed-pilot.md`.

## Unreleased — explicit incident-proposal inspection

- Add an optional keyless core/MCP inspection view for directly incoming and
  outgoing rationale proposals, including orphan challenges. These remain
  unassessed proposals; default decision context and recall are unchanged.
- Preserve existing namespace, revision, receipt and complete-result bounds.
  See `docs/rationale-inspection.md`. This is observability, not a semantic fix.

## Unreleased — bounded rationale experiment preparation

- Add a separate explicit baseline rationale-pipeline experiment capability,
  parent-only session and fixed 384-request/US$1.92 attempt limit within the
  existing shared ledger. Older grants remain unchanged and deny `relate`.
- Offline preparation only: no new live evidence or semantic-quality claim.
  See `docs/plans/rationale-experiment.md` for the remaining installed pilot.

## Unreleased — opt-in automatic rationale loop

- Add explicit source-bound-v2 capture rationale configuration, bounded current
  MOC candidate discovery and a post-classification proposed-rationale pass.
- Add baseline OpenAI `relate` adapter and source-linked `rationale-evidence`
  fetch/recall/MCP context under existing token bounds; configured MCP adds
  keyless rationale inspection. No automatic decision replacement.
- Capture reports independent rationale failures; duplicates do not retry this
  best-effort pass. No background-job recovery, new paid capability, hosted
  change or semantic-quality score. See `docs/automatic-rationale-loop.md`.

## Unreleased — embedded proposed rationale

- Add source-bound, model-proposed decision/premise/challenge links and keyless
  bounded inspection in the shared core; schema 12 invalidates links on source
  or revision changes. No decision replacement or truth/adoption assertion.
- This embedded slice requires an injected `relate` method. Automatic capture,
  real-provider/MCP integration and new semantic evidence are not delivered by
  this change. See `docs/source-backed-rationale.md`.

The private-hold language in historical entries records each stage's status at
the time. The minimum identifier fix was publicly delivered through PR #69 and
[GHSA-42p4-q4pr-vpwf](https://github.com/Cairn-ink/cairn-memory/security/advisories/GHSA-42p4-q4pr-vpwf)
on 2026-09-13. This integration does not publish a package or certify semantic
reliability.

## Candidate — native Hermes submitted capture

- Add explicit v2-only capture configuration to the native Hermes provider,
  using the installed MCP tool schema and shared engine. Preserve the five-tool
  default, keyless discovery, profile binding and inert transcript hooks.
- Limit dedicated-key forwarding to explicit capture/recall and give capture
  bounded longer deadlines. Timeout is not evidence of rollback; inspect and
  replay the same batch rather than automatically retrying a new one.

## Candidate — qualified installation settings

- Accept an explicit source-bound capture mode during preview installation and
  preserve it in the private startup receipt after a matching configuration check.
  Default installation remains five-tool and credentials remain separate.
- Document explicit submission, per-call source-only recall and inspection.
  Installed fake-provider tests verify the generated settings, not semantic
  accuracy, passive capture or named-client compatibility.

## Candidate — source evidence context

- Add opt-in source-only fetch/recall context: complete retained passages and
  submitted roles, without generated summaries or qualification labels in rank
  and returned memory context. Keep existing modes and counted budgets unchanged.
- Preserve the frozen eight-case real pilot: all ten records were recalled, but
  semantic errors included false adoption and lost uncertainty. Source-first
  usage does not repair selection gaps or prove truth or downstream answer quality.

## Candidate — fresh source-support experiment

- Add a separate eight-case installed capture/qualified-recall experiment with
  fixed source/query/rubric provenance, original capability reuse, per-phase
  limits and a 96-HTTP/US$0.48 conservative cap inside the existing phase budget.
- Keep prior experiments unchanged; preserve failed/empty/not-run outcomes and
  request-free cold inspection/replay. This operator is not a consumer feature,
  semantic score, general reliability claim or permission to publish a package.

## Private candidate — v2 interpretation guidance

- Clarify independent source-supported descriptors, proposal attribution and
  settled versus uncertain commitment in the v2 qualification prompt. Keep
  unknown values valid, preserve conditions, and provide a scoped example.
- No schema, authority, budget or legacy/v1 behavior changes. Offline contract
  verification is not measured semantic improvement; earlier pilot failures
  remain unchanged and public delivery is still held for security coordination.

## Private candidate — retained-source extraction

- Align v2 extractor input and selected receipts to the same canonical retained
  800-unit source windows. Preserve complete input digests and legacy/v1 paths.
  Report omitted source tails through retainedSourceWindow on v2 success/replay.
- Guide v2 source selection to retain antecedents with anaphoric responses.
  This is not an entailment validator or measured semantic improvement; omitted
  tails cannot supply claims, and old duplicates do not attest execution policy.

## Private candidate — canonical v2 description labels

- Compile v2 descriptive labels with declared NFKC normalization before unchanged
  strict S1 validation. Preserve raw/final limits, exact source anchors, nulls,
  enums and atomic failure; do not truncate, rewrite sources or infer identity.
- Retain the original failed pilot unchanged. This mechanical fix does not
  demonstrate semantic quality, complete antecedent selection or useful labels.

## Private candidate — source-qualified recall

- Carry opt-in complete source qualification through counted fetch, ranking and
  authoritative recall snapshots. Preserve legacy reads and budgets; never strip
  anchors to fit. Local MCP defaults this on with source-qualified capture.
- Retain the frozen six-case v2 pilot: five storage completions, one rejected
  case, incomplete semantic descriptors and one antecedent-provenance gap. This
  is not five semantic passes, general reliability, a release or disclosure clearance.

## Private candidate — explicit v2 qualification experiment

- Add a separate baseline-only candidate-qualification capability and narrowly
  routed session to the shared experiment accounting boundary. Preserve every
  old guard's method restrictions and immutable grants; no budget replenishment.
- Prepare one frozen six-case installed v2 experiment with a 36-request/US$0.18
  ceiling, source traces, finite diagnostics and request-free cold replay. Keep
  earlier failed pilots intact and distinguish structural storage from semantic
  quality. This entry does not claim the experiment passed or clear disclosure,
  release or deployment gates.

## Private candidate — source-candidate capture over MCP

- Accept explicit `--capture-qualification source-bound-v2` in the local MCP
  server and experiment launcher, reusing the existing capture/inspection tools
  and shared core. Preserve default/v1 behavior, mode-bound replay and caller
  authority limits. Configuration diagnostics report the chosen mode without
  opening storage or contacting providers.
- Installed fake-provider verification covers source selection, cold inspection,
  replay and mode conflicts. This is not semantic-quality evidence, a paid-method
  grant, publication or security-disclosure clearance.

## Private candidate — core-owned qualification evidence

- Add explicit core `source-bound-v2` and optional adapter `qualifyCandidates`,
  preserving v1, default capture and stored S1 qualifications. Core generates
  bounded Unicode-safe evidence windows, derives exact anchors and field
  coverage from selected references, and applies unchanged source validation.
  V2 matches admission's final receipt canonicalization at truncation boundaries.
- Keep qualified ordered updates unresolved without trusted identity. This is
  mechanical source linkage, not verified interpretation, adoption or currentness.
  MCP exposure and paid-method authorization remain separate, denied gates;
  no release, deployment or security-disclosure clearance is included.

## Private candidate — explicit qualification experiment capability

- Add an independent, baseline-only qualification capability to the existing
  request guard, preserving all three old deny-by-default constructors and
  accounting. Immutable authorization binds the settled existing ledger and
  is rechecked after request accessors before reservation.
- Prepare a narrowly routed qualification session and installed-MCP launcher
  integration for fake-HTTP verification. No real ledger/key access, paid pilot,
  budget replenishment or disclosure-hold clearance is included.

## Private candidate — explicit qualified capture over local MCP

- Opt-in `--capture-qualification source-bound-v1` exposes `capture_memory` for
  explicitly submitted batches through the same core. Keep default five tools,
  fixed namespace, keyless explicit writes and bounded source retention.
- Add keyless `inspect_memory.includeQualification` for ID inspection, preserving
  receipt pagination. Submitted roles and model labels remain unverified source
  claims, not human authentication, safe automatic updates or execution consent.
  No passive hooks, trusted bindings, retirement, paid calls or disclosure-hold
  clearance is included in this private delivery slice.

## Private candidate — automatic source qualification

- Add opt-in local `captureQualification: 'source-bound-v1'`: one bounded model
  batch describes extracted claims against exact persisted receipt excerpts.
  Validate and atomically store qualifications without automatic slot binding.
  Ordered capture preserves evidence with unresolved
  `qualification_requires_identity`, never legacy retirement in this mode.
  Mode-bound replay prevents reinterpreting legacy events as qualified. This is
  inspectable model provenance, not proven truth or automatic-update reliability.
  No paid calls, publication or disclosure-hold clearance is included.

## Private candidate — complete qualified transition sets

- Add local-only `transitionQualifiedSet` for 1–5 explicitly revision-guarded
  predecessors sharing one established slot with their replacement. Require full
  current-member coverage, revalidate all referenced sources, preflight existing
  history-edge capacity and retire atomically through the existing engine.
  Preserve the pair API and qualified retirement fences. This trusted-manual
  extension does not establish automatic memory-update reliability or clear the
  inherited private security disclosure hold.

## Private candidate — trusted-manual qualified transitions

- Add immutable server-generated claim slots and manual single-claim bindings,
  with atomic v10→v11 migration and empty-slot cleanup on correction/forget.
  Apply source-validated transitions between already-admitted qualified memories
  or retain both as unresolved; fence legacy retirement of qualified endpoints.
  Ordered capture preserves admission and replay when fenced. Unqualified legacy
  retirement and model interpretation remain explicitly unprotected. No public
  disclosure, release, deployment or model calls are part of this private slice.

## Private candidate — Unicode identifier integration (disclosure hold)

- Integrate the separately reviewed malformed-Unicode identifier guard with
  qualification storage, preserving both installed-core regression probes.
  Combined offline gates passed on Node 22.16 and 24, including 351 core tests
  and 16 artifact tests on each runtime; no model calls were made. Independent
  review of the frozen integrated commit remains required.
  This local integration does not release the SECURITY.md private coordination
  hold or authorize a public push, PR, disclosure, merge or deployment.

## Unreleased — bounded claim qualification storage

- Add optional trusted qualification to manual explicit/inferred admission, with
  immutable bounded labels, exact receipt anchors and opt-in core inspection.
  Preserve bindings across filing, receipt additions and historical retirement;
  clear them atomically on correction/forget. Conflicting qualified dedup fails.
  Upgrade SQLite v9 to v10 without legacy backfill. No automatic qualification,
  model/MCP exposure or retirement-rule change is included; provenance checks
  do not establish semantic truth or repair update-quality failures.

## Unreleased — current-memory candidate allowance

- Exclude retained history and tombstones from recall's 1,024-row candidate
  allowance using the existing current-memory partial index. Projection-rejected
  current rows still consume the allowance; current sentinels retain incomplete
  coverage. Bump the private candidate cursor policy to v2 and fail closed when
  the required index is missing. No new migration, public-map change or scoring
  change is included. Frozen v1 evidence remains unchanged; offline tests do not
  establish model-quality or latency improvements.

## Unreleased — bounded query-aware candidates

- Score current exact-namespace memory bodies by distinct literal query-token
  overlap before recall page packing, scanning at most 1,024 raw rows plus a
  sentinel. Preserve real placement refs, deduplicate multiparent memories and
  retain zero-overlap candidates. Private selection omits group headers; public
  maps, classification and model ports are unchanged. Scan-limited results keep
  incomplete coverage, and callback/final epoch checks also protect empty recall.
  These offline controls establish bounded reachability, not semantic quality.

## Unreleased — MOC architecture diagnostic

- Add a synthetic cold-store visibility diagnostic and corpus-wide SQLite FTS5
  baseline, retaining late-topic retrieval misses, Chinese/paraphrase lexical
  failures and the 101-unfiled-memory classification failure. Separate oracle
  visibility from semantic quality and provider cost; no runtime changes or paid
  calls accompany this evidence. See [the report](docs/evidence/moc-architecture.md).

## Unreleased — paired reconciliation evidence

- Retain one frozen old/new comparison on eight new bilingual synthetic cases,
  with per-claim, retirement, retrieval and answer review. Neither version meets
  the full frozen gate; retain invalid-output and wrong-retirement failures.
- Add a one-shot paired harness, private append-only evidence writer and a
  conservative additional request/spending cap over an existing campaign guard.
  No runtime tuning, paid retries, release, default-model change or new reliability
  claim accompanies this evidence.

## Unreleased — bounded classification catalog

- Classify placement against a MOC-only catalog, so unrelated unfiled memories
  and placement references cannot crowd out topics or prevent first-topic
  creation. Preserve namespace/revision checks and reject new topics when the
  topic catalog itself is incomplete. Public maps and recall are unchanged;
  this is an input-selection fix, not evidence of semantic classification quality.

## Unreleased — explicit MCP history inspection

- Add optional active/historical filters to the existing local `inspect_memory`
  listing mode. Keep the same five tools and no-key inspection path; document
  how to follow retained change evidence without inventing reasons or dates.

## Unreleased — explicit historical evidence view

- Add local `list({states})` filtering and opt-in `fetch({view: 'historical'})`
  for retained superseded evidence with source receipts and supersession metadata.
  Current recall/fetch defaults remain unchanged. This is not date-based temporal
  QA, full revision history, automatic motive inference or a new MCP surface.

## Unreleased — qualified reconciliation candidate

- Require explicit relation, value-change and adoption judgments in the
  experimental injected reconcile port. Only a consistent adopted replacement
  can retire prior memory; validated nonretiring judgments preserve it. Custom
  models must update nonempty outputs; old bare tuples fail closed. No database
  or hosted protocol change, and no new real-model reliability claim.

## Unreleased — ordered live evidence

- Retain one real-provider ordered-history, seven-case currentness and installed
  MCP lifecycle attempt with independent agent review. Explicit updates and the
  narrow installed lifecycle pass; reaffirming the current fact wrongly retires
  it in C6, so broader currentness acceptance remains failed. No runtime changes.

## Unreleased — well-formed local identifiers

- Reject malformed Unicode identifiers at the shared core boundary. Valid
  identifiers retain exact spelling; no normalization or migration of existing
  identifiers is performed. This candidate is held for private security
  coordination, not a published fix or a claim about hosted-service exposure.

## Model-backed evidence candidate

- Add an explicit shared-budget live experiment session, loopback host bridge,
  and value/pilot evidence workflow. Offline harness tests are not quality scores;
  live outcomes and limitations are reported separately.

## Local-memory introduction candidate

- Lead documentation with the local memory layer and pinned install walkthrough,
  clearly separate from the released hosted plugin and its privacy defaults.
- Retain source-support failure beside evidence claims and prepare a consent-based
  adoption experiment without publication, telemetry or promised stars.

All notable changes follow semantic versioning.

## Unreleased

- Prepare an installed ordered-capture lifecycle gate with fresh MCP consumers,
  source-bound history, scoped correction/forgetting, isolation and explicit
  failure retention. Scripted installed tests are not real-model acceptance or
  autonomous host capture; prior evidence remains unchanged.

- Freeze a separate seven-case currentness diagnostic covering confirmed updates
  and non-update cases, with complete raw history and independent source,
  currentness, retention and recall labels. Scripted offline acceptance does not
  establish real-model quality or replace the original failed history audit.

- Prepare a separately versioned ordered-history diagnostic retaining complete
  raw history alongside an explicit current-only projection for the unchanged
  v1 scorer. Historical retirement requires separate independent review; frozen
  original failures and denominators remain intact. Offline harness checks are
  not real-model acceptance or a new semantic-quality score.

- Prepare a separate immutable reconciliation experiment authorization and an
  explicit combined request guard. Existing guards still reject reconciliation;
  only an owner-authorized operator may provision real campaign state. Offline
  tests do not grant permission, replenish budgets or establish model quality.

- Add opt-in local source-ordered capture reconciliation with inferred-authority
  preservation, atomic history/progress fencing, bounded unresolved outcomes and
  durable replay. Schema v9 retains content-free causal provenance; legacy
  captures and MCP input schemas are unchanged. Offline tests do not establish
  real-model quality, and existing paid guards do not authorize the new port.

- Add explicit revision-safe `core.supersede` with atomic replacement admission,
  preserved historical evidence and current-only recall/navigation. Schema v8
  separates history from forgetting; no automatic capture reconciliation or
  semantic-quality improvement is claimed by this storage foundation.

- Add an explicit Luna extraction-only experiment and an opt-in durable model
  authorization extension over the original shared experiment budget. Defaults,
  prompts and historical failed quality results remain unchanged. Offline support
  does not establish provider access or memory quality.

- Use bounded query-aware excerpts in recall's internal navigation to expose
  relevant words beyond a memory's prefix. Public map/classification, model calls,
  candidate membership and resource ceilings are unchanged. A frozen synthetic
  real-model follow-up repaired the observed misses; broad semantic quality is
  still not established.

- Version Hermes evaluation acceptance as v3: reject duplicate initial memories
  and no-op forgetting, preserve failed inspector state, and require semantic
  review separately. Retain v2 and publish bounded real-model loop evidence:
  18/18 product steps accepted, but the combined control gate did not pass.

- Add opt-in bounded failure collection to the installed Hermes experiment path,
  with finite content-free events, explicit collection limits and full allowlisted
  runtime source matching before traffic. No model policy or quality claim changes.

- Preserve bounded capture/classification failure causes in comparison and pilot
  summaries. Partial ingestion still fails; historical evidence and scores are
  unchanged, and no raw model or source content is added to diagnostics.

- Add optional content-free model failure diagnostics for trusted local callers.
  Stage/layer/reason events do not change operation results, record model text,
  relax validation or establish the cause of historical live failures.

- Correct the OpenAI preflight check to use the existing absolute 7,024-token
  provider-input ceiling, while retaining local 6,000 input /1,024 output limits.
  Dynamic schema overhead no longer rejects otherwise in-budget requests solely
  for exceeding local input +1,024; reservations and model defaults are unchanged.

- Add an opt-in experiment HTTP guard joining host completion and Cairn count/generation reservations in one persistent budget, with bounded fake-HTTP verification; live Hermes routing and paid approval remain separate gates.

- Add an offline persistent experiment reservation ledger shared across
  processes and restarts, with conservative no-refund accounting and fail-closed
  overrun handling. This does not yet guard live host/provider traffic.

- Add a first-value guide separating the verified no-key installation path from
  a pending real-model Hermes task, including profile identity/storage, separate
  model credentials, fresh-session evidence and paid-run prerequisites.
- Strengthen the installed walkthrough to compare Source Receipts across process
  restart, not only memory content. This changes diagnostic assertions, not the
  core, MCP protocol or model behavior.

- Refresh developer-preview introduction, demo and roadmap with the isolated
  installer and evidence boundaries. Keep scripted host integration, actual
  model probes and unverified human/production outcomes distinct; no promotion
  is published and no star/accuracy/savings claims are introduced.

- Verify pinned Hermes native-provider and general MCP routes through the actual
  AIAgent conversation loop with scripted completions and real installed tools.
  Cross-session receipts, revisions and forgetting are tested; real-model tool
  selection and semantic recall remain separate gates.

- Add `install:preview` to build and install into a new private directory with
  separate app/data paths and an installation receipt. Existing targets are
  rejected and failed partial installs are retained. No client settings, global
  tools, model calls or registry publication are involved.
- Document local MCP `--help` and non-mutating `--check-config` diagnostics:
  configured credentials are not a claim of verified model or database access.

- Include the shared model-profile module in the local archive and verify an
  installed adapter import. MCP retains its existing default; experimental
  extraction remains an explicit programmatic option.
- Add an opt-in third-party Hermes memory-provider preview over installed MCP,
  with profile-local explicit tools, CLI/primary context boundaries and no
  automatic capture. Pinned-host lifecycle tests do not establish semantic
  quality, full chat compatibility or upstream listing.

- Prepare pinned public package metadata explicitly before offline artifact
  installation; add a clean-cache CI regression. Dependency installation with
  `npm ci` alone does not warm the metadata required by nested shrinkwraps.
  Ordinary artifact tests remain offline; runtime/archive contents are unchanged.

- Add an inspected private local npm install artifact over the same source core
  and stdio host, with pinned production closure, upstream notices and actual
  installed lifecycle/restart/upgrade tests. No npm publication or named-client
  compatibility claim is included.

- Add a thin local stdio MCP source host over the same public core, with
  startup-bound namespaces and explicit remember/recall/inspect/correct/forget.
  Distribution, real-client matrix and remote connectors remain separate gates.
- Add an explicit experimental extraction-only model profile; retain GPT-4.1 mini
  as default and for classify/select/rank. Mixed-model guards reserve per-request
  integer costs before I/O and evaluation reports per-method identity. Offline
  tests establish routing/accounting, not improved extraction quality.

- Add an answer-blind three-arm LongMemEval comparison runner and separate
  evaluator-only scoring, with actual-core synthetic verification; no real-model
  or full-benchmark score is claimed.
- Add offline LongMemEval-S pilot preparation with pinned input integrity,
  separate model/evaluator artifacts, opaque case IDs and capture-size blocker
  reporting. This is not ingestion, a scored benchmark or a paid model run.

- Add source-mapped capture planning and injected sequential ingestion for
  prepared LongMemEval histories. Preserve raw turn reconstruction and expose
  normalization, blocking and partial outcomes; no scored or paid run is added.

- Retain the third frozen synthetic evaluation and independent labels: all
  repetitions completed, but two unsupported captured claims still fail the
  mandatory source-support gate despite 45/45 recall and relevance. Preserve
  prior failures; the prompt-only fix is not a general entailment guarantee.

- Add a frozen synthetic semantic/resource evaluation with three fresh-state
  repetitions, explicit unknown semantic judgments, safety checks and a shared
  paid-request reservation budget. This is not a human or competitor benchmark.

- Clarify extraction source fidelity: preserve relationships and qualifications,
  without invented entity types or stronger claims. Scripted regression tests
  verify prompt delivery and receipt/content preservation, not model entailment.
  Real-provider source-support acceptance remains a separate gate.

- Constrain optional OpenAI classification/recall references to their immutable
  request snapshot and clarify cold-start topic creation for clear subjects.
  Preserve genuinely unfiled outcomes, existing core authority checks and all
  token/framing limits. A two-fact real-provider filing probe passed; general
  semantic quality still requires the separate frozen evaluation.

- Add an explicitly opt-in, budget-guarded synthetic live-provider lifecycle
  runner with sanitized reports and offline safety tests. Ordinary tests/CI
  never make paid requests. General semantic quality and standalone MCP remain
  separate acceptance gates.

- Add an optional pinned OpenAI adapter with a real local tokenizer, provider
  count preflight, bounded transport and strict output schemas. Offline fixtures
  only: live provider acceptance and quality evaluation remain pending. Preserve
  narrow trusted adapter budget/output errors through the shared model port.

- Extend recall to two bounded root-map rounds and two receipt pages per
  candidate, with explicit incomplete coverage and the same final authoritative
  snapshot. Cap three model calls and 36 unique fetched memories; large combined
  evidence retains explicit context errors. Add a core operation/test inventory.

- Add bounded model-free index rebuild with persisted continuation, validated
  generation authority and atomic publication. Ordinary mutations maintain the
  active projection transactionally. Schema v7 retains existing data; no topic
  discovery, automatic cleanup or production migration is included.

- Add optional revision-bound contradiction hints to explicit/inferred admission,
  symmetric attributed inspection and atomic invalidation on memory revision
  changes. Schema v6 preserves existing state; bounded links do not claim
  semantic conflict detection or change the capture model output contract.

- Add `core.capture` with bounded injected extraction, trusted source binding,
  digest-bound replay and post-admission classification. No provider, passive
  hook, local MCP server, hosted migration or schema change is included.

- Add package 1a admission leases and atomic inferred-memory commits over the
  shared runtime, with fenced takeover, digest-bound replay, suppression and
  abandonment. Completed outcomes retain IDs/counts, never cached memory content.
  Upgrade v1/v3/v4 databases atomically to v5. This does not yet add extraction,
  automatic capture, conflict hints, a model provider or a local MCP server.

- Add S2c revision-safe fetch with receipt continuation and bounded recall over
  explicitly authorized namespaces. A final authoritative read prevents deleted
  or changed candidates from escaping after model work. Injected selector/ranker
  adapters share bounded-call enforcement with classification. Synthetic tests
  and a runnable mock demo verify controls, not semantic quality. No local MCP
  server or hosted migration is included; schema remains v4.

- Add S2b persisted L2/L1 MOC organization, guarded multi-membership placement,
  bounded maps and read-only classification through an injected model port.
  Corrections/deletions invalidate memberships and source-derived titles in the
  shared runtime. Upgrade v1/v3 data atomically to v4. Synthetic SQLite/mock tests
  and a runnable demo verify controls, not real-model classification quality.
  Semantic recall, a local MCP server and hosted migration remain separate work.

- Add the model-free S2a core contract over the existing SQLite store: explicit
  receipt batches, metadata/source pagination, stable source IDs, persistent
  namespace epochs and signed cursors shared with legacy mutations. Upgrade v1
  storage atomically to v3; unmerged draft-v2 databases remain unsupported.
  This is not yet the MOC/classification/recall engine or a local MCP service.

- Add a source-runnable local SQLite storage preview with atomic memory/receipt
  writes, exact owner/project isolation, deduplication, revision-checked correction,
  deletion suppression, lexical lookup, and real-file/concurrent-process tests.
  Core requires Node >=22.16; existing plugin Node 20 support remains unchanged.
  Model extraction and a local MCP/HTTP service are not part of this milestone.

- Apply local credential redaction to automatic recall queries before bounding
  their length to the protocol limit; skip empty queries.
- Atomically initialize persistent project and telemetry identities so concurrent
  first use cannot overwrite a key or create unstable project scopes.
- Add a persistent pause generation and conservative resume cursor boundary to
  prevent paused history from being backfilled by subsequent automatic capture.
- Replace age-only capture lock expiry with process ownership and guarded cleanup.
- Clarify that ordinary conversation text may contain pasted files or paths and
  explain the separate automatic recall processing path.

## 0.1.0 — 2026-09-05

- Initial Claude Code auto-capture and auto-recall plugin.
- Detached in-memory capture handoff that survives interactive and headless Claude Code teardown.
- Explicit MCP remember, recall, and forget connection.
- Local transcript allowlisting, credential redaction, and opaque project scope.
- Public compatibility schemas and privacy contract.
- Documented Codex connection through the hosted MCP memory tools.
