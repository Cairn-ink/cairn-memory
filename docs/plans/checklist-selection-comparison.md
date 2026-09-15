# Fresh baseline/checklist comparison protocol

Dependent base: `15ca7fbb0790b7e7e62ff8ec47af3a1849b904c4`.

The goal is to test necessary-source retention within unchanged selection,
ranking and context limits, not count completed checklists as quality. Reuse
the existing multi-window capture/inspection diagnostic; retain earlier failed
experiments unchanged. This package freezes sources/rubric and execution rules,
not provider results or real authorization issuance.

## Acceptance

1. New fixture/rubric `checklist-selection-fixture.json` and
   `checklist-selection-rubric.json` under `evaluation/live/`, id
   `checklist-selection-comparison-v1`, use the existing multi-window fixture
   contract: three matched pairs, six histories, three windows each with five
   user messages plus one assistant suggestion. Globally unique source IDs,
   unchanged question within each pair, exactly one changed user sentence per
   pair distinguishing provisional versus committed choice. All messages remain
   within800 UTF-16 units after existing source normalization.
2. Use fresh domains: community board-game evening, puzzle-club meeting room,
   local-history exhibit labels. Across these, test changed and reaffirmed
   reasons, bounded temporary scope, different actors and genuinely absent
   translation-approval evidence. Do not copy previous railway/costume/singing
   source text or end with a convenient recap. Distribute required sources
   across windows amid independent incidental facts. Questions explicitly ask
   every required actor/reason/temporal distinction. Rubrics include exact
   required/irrelevant IDs, unique decisive qualifier and human-readable
   interpretation/absence limits; never feed rubric into model input.
3. One fresh capture per window, cold close/reopen inspection and all retained
   failure slots use `runMultiWindowFidelity` unchanged. The operator separately
   records one additional checklist recall and answer per history, on the same
   captured store, with actual namespace/revision/receipt identity validation
   against the final admitted inspection. Alternate baseline/checklist order.
   Preserve original baseline and canonical-control outputs; an additional
   candidate must not overwrite, retry or rescue them. No duplicated engine or
   changed production CLI/default is added in this package.
4. The operator may use actual existing MCP server/client factories with an
   experimental injected model wrapper. Label this source-based experimental
   MCP execution, not installed npm/CLI acceptance or a natural host choosing
   tools. Reopen stores across windows; distinguish this from process restart.
   Hold capture, rank, question, source projection, model and baseline answer
   instruction fixed. The only candidate change is selection. The canonical
   full-source control remains a constructed diagnostic, not retrieved evidence.
5. Freeze source/fixture/rubric/operator/compiler/schema/grant hashes before
   any paid request. Existing US$50 ledger stays cumulative; operator per-run
   ceiling US$3 /400 HTTP requests /18 answers, all requests counted and no
   retries. Insufficient conservative headroom, pin/accounting failure or
   transport interruption halts new sends. Rehearse successful execution,
   invalid checklist, source failure, transport halt, answer failure and cleanup
   with fake services; independently review operator before real grant issuance.
6. Report actual admitted counts (not assumed>12), required-source retention at
   admission/selection/rank/final receipts, qualifier retention, predefined
   irrelevant hits, unassessed source selections, semantic answer errors,
   bytes/tokens/latency/request counts and cost uncertainty separately. No
   aggregate semantic accuracy or external benchmark claim for three authored
   pairs. Reject promotion if it loses previously retained evidence, merely
   exposes more irrelevant text or fails to improve premise coverage within
   bounds. Full-source failures still require separate currentness work.
7. Add offline fixture compatibility/regression tests without credentials and
   document proposed operator choreography explicitly. Run full offline evidence
   suite plus generic/JSON/strict plugin checks on Node22.16/24. Independent
   Standards/Spec review and required CI precede merge and paid execution.
   No npm release, deployment, existing-ledger edit or live run in this package.
