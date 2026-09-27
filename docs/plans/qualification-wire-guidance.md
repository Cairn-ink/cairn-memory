# Qualification wire guidance

Status: implementation contract. Initially authored from `ce5342f458f45fd809d69edf2f86fc7f57f82aee`, then cleanly rebased onto the independently reviewed diagnostics commit `8b8b761fe706bcae59fdeb95a4c51c9d79e99619`, the fixed base for final review. Its amendment from `382d512eb7b73501fc36d46bf1f0fa0345b0393d` changed only a plan and installed-test expectations, not runtime bytes. This change repairs contradictory provider-facing format instructions; it does not establish the cause of the completed N1 `output_shape` observation or improve measured memory quality.

## P1 — One shared interpretation source

Keep the existing source-trust, independent-field, attribution, commitment, uncertainty, citation, canonical-label and no-authority rules in one shared Markdown guidance file. Keep only format-specific instructions and one valid, source-bounded example in each short inline and evidence-pool wrapper. Pool positions are transient transport references, never persistent source or claim identities. Neither variant may tell the model to invent an identity, infer adoption, decide replacement/currentness, compute offsets, or grant authority.

## P2 — Preserve the core/custom-model contract

Core still sends one `qualifyCandidates` call with the unchanged inline input shape, 1,024 output-token budget and inline `qualifications[]`/`evidenceIndices` response contract to custom models. It loads the shared Markdown plus inline wrapper through one small prompt composer. Existing source-bound compilation and admission checks remain unchanged. Record old and new standard-core prompt SHA-256; explain any reordering without claiming unchanged model quality.

The frozen base's monolithic core prompt SHA-256 was `1c0794cfb1aa4b0e76c4603aa3d26d07f2024e1f79fecd9389202ce6ab726a41`. The composed inline system is `0ff197aab706e13a41fe92c9b7db271a46e7e392e745633ef79fb4e0dd5eec35`; the composed pool system before request-specific mapping is `6ea8eb61fe241abce61a197ebb30c3dea525608f5b589f490624c60009961b7a`. Shared interpretation guidance now precedes the shorter wire framing and example. The inline contract and source/uncertainty prohibitions are retained, but wording/order changed; no quality equivalence is claimed.

## P3 — Coherent standard OpenAI request

When and only when the adapter receives the exact composed standard core system string, it uses shared Markdown plus the pool wrapper and requested `item_N` mapping. That provider system contains no old `qualifications[]` example or `evidenceIndices` output direction; its single example is valid `evidence-pool-v1` and decodes to a core-valid inline result. An arbitrary caller-supplied `system` string is retained verbatim and receives the existing wire override rather than being discarded or text-replaced. The input snapshot, model, JSON schema, guard, output validation, provider endpoints and API parameters remain unchanged.

## P4 — Bounds and schedule

The same provider-instruction selection and request serializer feed synchronous fit planning, count and generation. Preserve the 6,000-token local/count-body bound, 7,024-token provider bound, 1,024-token output bound, one count plus one generation request, and no retry/fallback. Previously fitting required fixtures must still fit; any newly fitting fixture due to a shorter prompt may dispatch only after the real full count-body check. Actual over-bound bodies still refuse before HTTP, with no guard relaxation. Compare inline and adaptive-catalog boundary fixtures and full serialized bodies; do not expand prompt/output cost substantially.

## P5 — Offline falsifiers

First retain a RED synthetic fake-HTTP capture showing the old and pool format instructions in both actual count/generation payloads. GREEN tests then show the standard path contains only pool-format output instructions, identical count/generation instructions, a pool example that decodes and compiles, shared uncertainty/source restrictions in both variants, an unchanged inline contract for a custom model, arbitrary-system preservation, byte-equal expected schema/input/model, and no additional HTTP/retry. Test both inline and adaptive text-catalog paths and verify the hypothetical old inline response remains invalid on the provider wire. All fixtures are synthetic; no provider, key, corpus, evaluator or operational ledger is read.

RED: after installing the lockfile dependencies with `npm ci --prefix adapters/openai`, `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node --test --test-name-pattern 'P5 standard core request' adapters/openai/test/qualification-interpretation-guidance.test.mjs` exited 1 as expected. The new fake-HTTP assertion failed on `/evidenceIndices/`: both captured request bodies carried the old `qualifications` array example and appended `evidence-pool-v1` override. This is the prompt conflict under test, not evidence of the historical N1 cause. The initial pre-install attempt failed to import `tiktoken` and is not counted as RED evidence.

Pre-rebase focused GREEN on Node 22.16 and 24.15 for the final prompt bytes: the four prompt/qualification adapter and core test files passed 28/28 on each; the installed `source-qualified-recall` fake-HTTP test passed 1/1 on each after locked OpenAI/MCP installs and public registry metadata-cache preparation. The repeated 5×4×800 catalog fixture still refuses inline, selects catalog and makes exactly two fake-HTTP calls. Its full count body is 4,804 versus frozen 4,757, and its local request is 2,982 versus frozen 2,935 (+47 each), below the existing ceilings. After the first diagnostics rebase, the combined focused six files passed 45/45 on both Nodes; the final diagnostics amendment left their runtime bytes unchanged. On the final base, eight relevant adapter/core files passed 55/55 on both Nodes (`/tmp/cairn-qualification-wire-gates.aAu59n/focused-final-{22,24}.log`).

## P6 — Packaging, verification and handoff

Include all runtime Markdown and the tiny composer in the explicit installed-artifact file manifest, and adjust installed prompt tests to verify composed guidance. Run focused OpenAI/core/package tests first. Wait for the frozen reviewed diagnostics candidate before rebasing and running the applicable full offline Node 22.16 and 24.15 contributor and installed wire gates on the combined tree. Freeze one local candidate for independent Standards/Spec review; do not push, merge or claim paid-readiness before primary coordination.

Across the first combined tree and its test/docs-only final diagnostics amendment, full OpenAI adapter tests passed 234/234 on each Node; full installed-artifact tests on the final base passed 84/84 on each; installed offline rationale tests passed 4/4 on each; LongMemEval tests passed 185/185 on each; generic tests passed 112/112 on each; validation passed on each; all seven offline demos exited zero on each. Full core tests passed 729/729 on each Node with serial file scheduling; the Node 24 run was independently owned by the primary reviewer. Logs for the final-base Node 24 OpenAI and core, both artifact and rationale suites, Node 24 demos, and focused suites are in `/tmp/cairn-qualification-wire-gates.aAu59n/`; the earlier same-runtime-byte gate transcripts were retained in the implementation session. No paid provider run, real corpus, evaluator or operational ledger was used.

The first PR CI live-evidence-offline Node 24 gate found three stale exact full-body token expectations in `qualified-source-budget-boundary.test.mjs` (3,905→3,952 and 3,913→3,960 twice). The unchanged candidate reproduced RED locally: 4 passed, 3 failed. Updating those exposed the local serialized count assertion (2,452→2,499), likewise measured by its own provider-like fake HTTP count of the actual serialized body; the intermediate RED was 6 passed, 1 failed. All four changes are +47 tokens from the coherent prompt. The schema/evidence contribution assertions, full bounds object, over-bound refusal, no-halt condition and three-method count/generation sequence remain exact and unchanged. Focused final file passed 7/7 on both Nodes. Full live-evidence-offline reruns on Node 22.16 and 24.15 each passed 340, failed 0, skipped 30 (the existing opt-in skips), as retained in `/tmp/cairn-qualification-wire-gates.aAu59n/live-evidence-final-{22,24}.log`. Earlier runtime gates remain applicable because no runtime file changed.

## E1–E5 — Post-P canary evidence and next checkpoint

This section is acceptance for a **documentation-only** result record, not a
retroactive amendment to P1–P6 or authority for another launch.

- E1: Record the fresh N2 synthetic canary's fixed one-question, six-session,
  24-turn scope; all six Cairn capture batches, 24 admitted memory references,
  one recalled source receipt, and each arm's one answer and resolved judgment.
  Separate operational completion from the synthetic reference's correctness.
  Preserve the failed S3 fixed-30 and N1 outcomes without replay or causal
  attribution to the P prompt change.
- E2: Report the N2 request and **conservative reservation** totals separately
  from an invoice or known usage. Avoid private paths, case IDs, source text,
  evaluator content and operational hashes in public docs. Identify the scope
  of the independently checked aggregate accounting without implying that
  the known usage estimate is an invoice.
- E3: Specify the next proposed checkpoint as a **new**, sealed six-case
  official LongMemEval-type pilot: one case per each of the six official type
  labels, selected deterministically by hash from ID and type only after
  excluding every previously frozen ID, including unexecuted holdouts. Freeze
  source/evaluator separately, use the same paired arms, models, scorer and
  resource protocol, and retain all scheduled outcomes without replacement.
  Neither this record nor N2 authorizes selection, spending or launch.
- E4: Distinguish six-of-six mechanical completion and scoreability in both
  arms from accuracy. Report correct, incorrect and unresolved counts by arm
  and common resolved denominator. A mechanical failure returns to an offline
  reproducer and reviewed repair before expanding scope; it is not a reason
  to retry a consumed case. Only after a feasible pilot propose a **fresh**
  fixed-30 comparison under the existing at-least-29-per-arm and common
  scoreability rule, with separate statistical, semantic, resource and
  invariant gates. Do not invent an accuracy target or parity claim.
- E5: Keep installed Hermes, MOC candidate visibility, source-supported
  update/answer fidelity, and lightweight request/latency/cost evidence as
  separate later product gates. Verify this documentation change with the
  repository's generic tests and validation on Node 22.16 and 24.15; no
  provider, operational ledger or original corpus is needed.

The [technical result](../evidence/qualification-canary.md) is limited to the
N2 observation and the proposed next gate. For this docs-only edit, generic
tests passed 112/112 and JSON/version validation passed on each of Node
22.16 and 24.15; no runtime, scorer, model or provider test behavior changed.

## E6–E10 — Official six-case pilot result record

This documentation-only continuation starts from
`8b7d8d347481c8560ca3ab254193f4d18d45d04e`. It does not modify the
pilot's runtime, models, prompts, cases, evaluator, or budget policy.

- E6: Record the completed pilot only after terminal generation, scoring and
  accounting evidence has been inspected. Until then, label the result pending;
  do not infer completion from a running process or requests already issued.
  Describe six new official LongMemEval cases, one per official type, with
  source-only deterministic selection and all previously frozen cases excluded.
  Report the fixed six-case denominator without replacement or replay.
- E7: Separate lifecycle completion, per-arm mechanical completion, scoreability,
  correct/incorrect/unresolved counts, and the common resolved denominator.
  Break failures down by the recorded stage and finite diagnostic category;
  do not label an unresolved case an incorrect semantic judgment or infer a
  specific model response that was not retained. Six cases are not a leaderboard
  score, statistical parity evidence, or a product reliability guarantee.
- E8: Publish only aggregate accounting verified against the unchanged prior
  ledger prefix and the exact run tail. Separate conservative reservations from
  known usage estimates and unknown usage; neither is an invoice. Omit private
  paths, operational hashes, case identifiers, source text, model answers,
  evaluator material and credentials from public evidence.
- E9: Preserve S3, N1 and N2 outcomes. Update the limitations and roadmap with
  the observed gate outcome and bounded next action: repair a mechanical failure
  with an offline reproducer and independent review before fresh paid expansion;
  otherwise assess feasibility of a fresh fixed-30 cohort, retaining its existing
  scoreability rule. Keep semantic fidelity, MOC visibility, installed Hermes,
  latency/request/cost evidence as separate unfinished gates unless independently
  demonstrated. This document does not authorize another launch or a merge.
- E10: Limit delivery to this plan, one technical result document, limitations
  and roadmap. Run generic tests and validation on Node 22.16 and 24.15, obtain
  independent Standards and Spec review of the same final commit, and check
  latest-head CI before completing the PR handoff. No paid calls are needed to
  verify the documentation itself.

The [official-type pilot result](../evidence/qualification-official-pilot.md)
records the terminal non-halted but mechanically incomplete run: Cairn 0/6
answered and 6/6 unresolved, Mem0 6/6 answered with 4 correct and 2
incorrect, and common resolved denominator 0/6. Independent aggregate review
confirmed 976 settled new attempts, 5,582,424 micro-USD additional conservative
reservation, and zero pending without changing the prior ledger prefix. These
facts do not support a fresh fixed-30 expansion or a parity claim. The next
gate is a synthetic offline context-fit and qualification-slot reproducer,
followed by independent review of any product correction before a fresh probe.

Routing and verification for E6–E10: bounded documentation implementation by
G6 Sol/high from the fixed base above. The primary supplied terminal aggregates
after an independent accounting check; the author did not open operational
inputs. On both Node 22.16 and 24.15, `npm test` passed 112/112 and
`npm run validate` passed JSON and version checks; raw logs are retained for
review. The local candidate SHA is supplied in the fixed-point review handoff.
No runtime, scorer, model, provider, corpus, evaluator or ledger file is
changed by this packet.
