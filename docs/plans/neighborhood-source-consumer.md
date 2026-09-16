# Neighborhood source-to-answer composition

Fixed base: `c82a6eb00ace70ca78a30bbefdecbba9b1aadb8b` (PR156).

## Decision

Evaluate the new read path at the consumer boundary before adding another graph
or promoting automatic relationship correction. Earlier source/basis answer
comparison found no demonstrated gain from adding interpreted basis. This slice
therefore uses relationships only to obtain retained source evidence already
returned by recall, never as answer-time authority. It is evaluation-only.

## Acceptance

- NC1: Add a narrow external adapter for an actual successful local MCP
  `rationale-neighborhood-evidence` recall result. It performs no retrieval,
  capture, basis review, provider discovery, or writes. Existing source-only
  answer helper, prompt, model, defaults and runtime remain byte-identical.
  Require an explicit caller-declared request mode equal to
  `rationale-neighborhood-evidence`; empty results lack a mode marker, so this
  declaration is not an attestation. Installed tests must check the actual tool
  request, and documentation must not claim DTO-only proof of empty-result mode.
- NC2: Form the stable-order union of selected roots and their returned
  `rationale.sources`. Preserve exact memory identity/revision/currentness and
  complete receipt IDs/roles/excerpts. Deduplicate identical source objects;
  enforce RN's current-only contract for roots and linked sources (the older
  source-answer consumer also accepts historical DTOs, so it cannot do this);
  conflicting copies reject, never choose a newer-looking copy. Each root must
  agree exactly with its copy in its neighborhood, whose root identity/revision
  and `bounded-root-neighborhood`/`unassessed` labels must be valid. Reject wrong
  modes, malformed envelopes, partial traversal or receipt pages. Empty complete
  recall remains valid ignorance. Do not fetch missing sources or insert gold
  evidence from fixtures. No source may be silently dropped to fit bounds.
- NC3: Reuse the existing installed source-answer preparation/delivery contract
  after explicit projection. The answer request contains only those source DTOs
  and the question; no edges, relation status, basis units, generated summaries,
  qualifications, namespaces or source/client/session metadata. Preserve existing
  six-source, 24,000 request-byte and input/answer limits, one injected completion,
  no retries/fallback/tools, and generated-unassessed versus failure statuses.
  Reject overflow before completion. Do not relax the old consumer to accept
  rationale DTOs implicitly.
- NC4: Unit tests assert exact source bytes/order, duplicate sharing, conflicting
  revision/receipt/currentness copies, missing/mismatched root, wrong coverage or
  labels, extra interpretation fields, source/count/byte overflow, empty recall,
  malformed or failed completion and no completion on invalid input. Proposed
  relationship strings cannot become answer instructions or authority.
- NC5: Extend the existing installed RN test through this external consumer:
  actual archive, synthetic capture/admission, cold installed stdio recall,
  old-root selection, exact rank/final evidence, then injected completion whose
  input includes the outgoing later-decision source and support-chain challenge
  receipt, without graph interpretations. Verify keyless cold graph/source
  equality and no extra model call by conversion. Scripted model/answer results
  prove wiring only, not relevance, correct inference or useful answers.
- NC6: Document the comparison this enables: ordinary source recall versus RN
  expanded returned sources. Sources may differ, so it measures whole read-path
  utility, not a same-input causal ablation. Longer fresh histories, natural
  model selection/capture and independently judged answers remain separate gates.
  A partial/oversized result remains a recorded failure, not a quality success.
  This helper does not attest freshness after arbitrary external delay and does
  not authorize paid dispatch; any live operator must add its existing guarded
  transport, budget, immutable inputs, timing and retained evidence.
- NC7: One Sol/high worker owns only a new evaluation helper and focused tests,
  the installed RN test extension, one documentation page and this plan. No core,
  MCP, adapter, existing source consumer, prompt, fixtures/rubrics, grant, ledger,
  private operator, release or deployment edits. Run live-offline and installed
  artifact gates plus generic/JSON/strict validation on both Node22.16/24.15.
  Freeze scoped commit; primary reruns key paths, independent Standards and Spec
  reviews, then latest-head CI required. No merge or paid calls in this slice.

## Implementation record

The Sol/high worker used this isolated worktree at the fixed base above. The
new evaluation-only entrypoints `prepareNeighborhoodSourceAnswer` and
`deliverNeighborhoodSourceAnswer` validate an actual RN SDK result, project a
stable source-only union, then call the existing installed answer preparation
or delivery function unchanged. The caller-declared mode is required, but an
empty result cannot attest its mode from the DTO alone. Ordinary MOC selection
is the supported path; optional bounded-source-scan metadata rejects rather
than being silently discarded. All roots and linked sources must be current,
all selected roots must agree with their neighborhood source, and every root's
index revision must match within the single completed recall. Deduplication
uses deep structural equality so JSON object key order cannot create a false
conflict, while receipt order and bytes remain exact.

The affected dependent check is the installed RN artifact regression: it now
restarts actual installed stdio before the RN recall, hands the exact SDK
result and declared request mode to the helper, asserts the answer callback
receives only original source DTOs (including outgoing-later and
support-chain-challenge sources), then checks keyless cold source and graph
equality. Focused pure tests cover mode/envelope/label/conflict/currentness,
empty recall, whole-union count/byte bounds and single-call failure statuses.
The existing source consumer, prompt, core, adapter and MCP runtime remain
byte-identical. No semantic answer quality is inferred.

Serial worker verification passed on both Node 22.16 and 24.15: focused
projection plus installed RN test 5/5; live-evidence-offline 269 passed with 30
intentional skips; installed artifact 71/71; generic `npm test` 139/139;
`npm run validate`; strict plugin/marketplace validation. `git diff --check`
passed. The installed callback and all model responses were synthetic; no paid
request, key, grant or shared ledger was used. Primary integration reruns,
independent review and latest-head CI are subsequent gates, not claims here.
