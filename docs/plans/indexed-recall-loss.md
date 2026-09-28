# Indexed source-evidence recall loss

Status: diagnosis and scoped offline implementation. Fixed base: `304ac6fcb9b71ec2eade579bfb0877e409167e10`; worktree: `diag/indexed-recall-loss`.

## Observed failure and limits

The public official-six report records two failed indexed-evidence cases. Ordinal 2 captured 52/52 batches and admitted 236 cards, then recalled 0 memories, attached 0 receipts, selected 0 answer units, and abstained incorrectly. Ordinal 4 captured 44/44 batches and admitted 213 cards, then recalled one memory, attached one receipt, selected one answer unit and made no packer omissions; the selected receipt concerned unrelated activity and omitted the target event and time. The public report alone does not establish whether the needed source was admitted or which stage first lost it; the later read-only source audit is recorded below. The paid runtime is immutable and may not be replayed. No claim about its corrected score will follow from offline tests.

## Acceptance contract

- **R1 — Trace.** Map real capture admission and retained-source storage through cold reads, candidate visibility, selection, receipt fetch/ranking, and the actual answer pack. At each boundary distinguish source-text visibility from interpretation/label visibility. Identify the first observed loss in synthetic reproductions and keep any historical first-loss stage explicitly unknown unless admissible read-only evidence proves it.
- **R2 — Feedback loop first.** Before hypotheses or a production fix, run one fast deterministic command at the actual retrieval/answer seam using a newly authored minimal synthetic workspace and visible-input-only scripted selection/ranking. Assert a missing or wrong source-evidence symptom. Include negative controls and synonym/paraphrase, temporal, and multi-session variants where they exercise the bounded-source path. The harness must be red-capable and must not use hidden expected IDs, source evaluator answers, forced empty model output, corpus text, paid requests, or a provider key. Report its exact command and output.
- **R3 — Falsification and scope.** Share three to five ranked falsifiable hypotheses with the primary agent before testing them. Change one variable per probe. Propose a minimal retrieval candidate, source-evidence, or selection fix only after a local defect is proven. Preserve default MOC behavior, privacy, scope, revision, deletion and history semantics; do not expand model, prompt, vector store or limits without specific proof.
- **R4 — Regression and safety.** Keep full statistics and existing limits. Synthetic cases must cover a cold read, explicit correction, forget, namespace isolation and unknown staying unknown. Tests can establish mechanical coverage but cannot establish real-model semantic selection or old paid-case success.
- **R5 — Test isolation.** New fixtures use `createTestWorkspace` and the repository-owned test runner. Verify on Node 22.16 and 24.15 where available. Never clean historical temporary directories.
- **R6 — Edit checkpoint.** Request primary-agent review of the diagnosis, tested hypotheses, exact proposed production files and change before any production edit. The primary coordinates shared `ROADMAP.md`, `docs/limitations.md`, `CHANGELOG.md`, package/CI files, public reports and actual-case artifact review; after the source audit, it approved this worktree's scoped `docs/limitations.md` addition.
- **R7 — Delivery evidence.** Run targeted existing tests, relevant `CONTRIBUTING.md` gates and negative controls. Record exact commands/outcomes. The primary will inspect and rerun the combined candidate and arrange independent Standards and Spec reviews before push. This worker makes no push, PR or merge.

## Boundaries

All investigation is offline. This worker may inspect public code, documentation, synthetic fixtures and public aggregate evidence, but must not read the actual corpus, evaluator, source answers, key, environment, operational ledger or paid run directory. No live or paid request, old-case tuning/rescoring, filed hand placement, or production change is authorized. Capture timeout/abort work is owned separately.

## Evidence log

The public caller path is `mixed-generation`'s `core.capture` admission, followed by cold `core.get` and `core.recall`. Recall builds bounded keyset query candidates in `core/moc-storage.mjs`, projects source or interpretation labels into `mapPage`, performs complete-map or model selection in `core/recall.mjs`, fetches source-only receipts, ranks, and makes an authoritative final snapshot. The indexed comparison then runs `verifiedEvidence` against `core.get` and `packMixedAnswer` before its answer call. Source receipt text can be retained while absent from the map label; a visible memory reference does not imply its source evidence reached selection or ranking.

Phase 1 command, run on Node 22.16.0:

```sh
node tools/testing/run.mjs --test-name-pattern='indexed recall exposes retained fifth' core/test/indexed-recall-loss.test.mjs
```

It exited 1 in 1.9 seconds (`1` test, `0` pass) with the target assertion `expected /whistle event at dawn/, actual packed evidence ''` in the initial fixture. After strengthening the fixture to include the actual `verifiedEvidence` call, and removing a synthetic receipt-ID rewrite, the red command exited 1 in 4.2 seconds with `target source must reach the answer pack`. The final synthetic test captures five distinct source events deduplicated into one generic interpretation, adds twelve unrelated cards, verifies exact receipts through cold `get`, and uses the real bounded-keyset recall, `verifiedEvidence` and `packMixedAnswer`. It chooses a unique queried source by read-only inspection of the fifth receipt in the actual ID ordering; it does not modify receipt IDs or give any hidden target ID to selection/ranking. Those scripted callbacks use only received map labels and candidate receipts, with fixed visible-text substitutions for a paraphrase.

One-variable probes under the same owned runner: four rather than five receipts passes through the same 13-card model-selected route; twelve rather than thirteen cards passes through complete-map with the fifth receipt. A paraphrased temporal question across two captured sessions (`morning signal` versus retained `whistle ... dawn`) reproduces the selection loss. An unrelated question (`unseen comet`) remains empty. The initial full diagnostic file returned `4` pass, `1` expected red. After the red proof, the first test was converted to a passing characterization of the observed limit, and a sixth test was added: an indexed capture with two submitted windows completes and admits one card, but retains only the one window selected by scripted extraction. Cold recall finds the retained source and leaves the omitted source unknown. The final file passes 6/6. These controls establish bounded local mechanics, not historical model behavior or a fix for the official cases.

Ranked hypotheses shared with the primary before probes:

1. First-four receipt scoring hides a later retained source from the selection label. Moving the target to receipt four should restore visibility.
2. Above twelve refs, fallback selection drops source evidence that complete-map would carry to rank. Reducing the set to twelve should bypass selection.
3. Admission omitted the needed source despite completed batches. A cold authoritative receipt audit would distinguish this for a particular case; public aggregates alone cannot.
4. Top-K or physical-scan pruning removes a needed card before selection. A separately bounded over-limit fixture would show map absence and incomplete coverage; the current thirteen-card fixture cannot establish it.
5. Rank chooses irrelevant evidence although the correct fetched source is present. A probe with a source-visible candidate and source-aware scripted rank distinguishes it from a selection-stage loss.

The fourth/12-card probes support the first two hypotheses jointly in the synthetic fixture. The primary's read-only audit found that **all** 236 ordinal-2 cards and 213 ordinal-4 cards have only one to four receipts, so hypothesis 1 cannot explain those actual cases. The audit rebuilt the frozen source map without running capture or recall: ordinal 2 had 950 unique planned indexed windows, 601 matched to authoritative retained receipts and 349 unmatched; ordinal 4 had 919, with 558 matched and 361 unmatched. Its 643 and 581 receipt rows respectively all mapped to planned windows. These are retention counts under selective admission, not relevance, quality or completeness scores; unmatched windows alone are not defects. Ordinal 2 retained several exact relevant source turns but recalled no cards. Ordinal 4's exact target event/time turn was present in the prepared input as one sub-800-unit window in a completed admission batch, yet no receipt matched its capture message ID, while positive adjacent-turn bindings did match. This locates that exact turn's loss at or before durable receipt retention. It does not distinguish semantic extraction omission from another pre-retention behavior, prove semantic absence in paraphrases, or establish ordinal 2's first retrieval-loss stage. Neither actual case saved candidate/select/rank frames. In the synthetic capture test, `coverage: complete` means the eligible-card traversal exhausted; it does not mean all submitted windows were stored or the chosen evidence is semantically relevant. The production-edit checkpoint therefore approves a diagnosis-only deliverable: this plan, scoped synthetic tests and a limitations note, with no preview/cap or other production code edit. No paid case was replayed or rescored.

Existing targeted safety controls passed under the owned runner on Node 22.16.0: `node tools/testing/run.mjs --test-name-pattern='E4 correction/forget|BS6 two namespaces|BS10 source correction' core/test/indexed-evidence-capture.test.mjs core/test/bounded-source-selection.test.mjs` returned 3/3. E4 covers cold-safe correction/forget, suppression and foreign namespace; BS6 covers two-namespace source isolation and stale unranked evidence; BS10 covers correction during rank. The new diagnostic test covers cold read and an unknown query.

Verification on this candidate before commit:

| Command | Result |
| --- | --- |
| `node tools/testing/run.mjs core/test/indexed-recall-loss.test.mjs` (Node 22.16.0) | 6/6 pass |
| `/home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs core/test/indexed-recall-loss.test.mjs` | 6/6 pass |
| `npm test` (Node 22.16.0) | 121/121 pass |
| `npm run validate` (Node 22.16.0) | JSON and versions valid |
| `npm run demo:store` | pass, new synthetic store |
| `npm run demo:recall` | pass, new synthetic store |
| `npm run demo:capture` | pass, new synthetic store |
| `npm run test:core` (Node 22.16.0) | 1,007/1,007 pass; 412,842 ms |

The primary owns Node 24.15.0 full acceptance, exact-head rerun and independent review. No installed host or paid behavior is claimed by these tests.

## Next checkpoints, separate from this diagnosis

- **N1 — Source-window coverage:** design a bounded, source-free report that matches every offered canonical indexed window to stored source identity and exact canonical text. Separately count selected, admitted, unmatched and ambiguous windows with the batch claim status. Preserve the selective-admission contract, quotas, privacy and deletion semantics; this is neither a truth/relevance score nor an evaluator oracle. A report must not expose raw text or source IDs.
- **N2 — Retained but unrecalled:** on new synthetic inputs, record a finite trace at candidate visibility, selection, fetch, rank and answer packing, with an explicit trace byte/count budget. Distinguish source text from generated labels at every stage. Diagnose failures with those traces before choosing any retrieval change; do not infer a stage from an empty final answer alone.
- **N3 — Fresh quality evidence:** only after a scoped product change, offline gates and independent reviews, prospectively freeze new paid cases and budget. Keep the consumed official six, judgments and scores unchanged.

Current session episodes and staged-evidence modes are mutually exclusive with indexed-evidence capture. Episodes retain only selected bounded passages and prefix text; staging expires. Neither automatically supplies a complete retained source archive for this lane. A future opt-in raw-source retention design would need its own quota, deletion and privacy contract rather than a silent default or schema change.
