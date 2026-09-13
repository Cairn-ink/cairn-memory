# One-shot source-selection ablation

Base `eb7580329e83bb2e9b4f3f3127e71b1c17c51599` (#77 candidate).
Isolate the documented MOC label-prefilter omission from capture and rationale
inference. This is diagnostic oracle ingestion, not an end-to-end memory score.

## Acceptance

1. Freeze eight new synthetic fixtures before any model call, with source events,
   routing labels, questions and separate evaluator-only required/irrelevant
   source indices. Include changed reasons, scope/subject differences, temporary
   exceptions, uncertainty, irrelevant sources and unanswerable queries. These
   are authored cases, not a blind external benchmark or real user evaluation.
2. Sixteen scheduled arms alternate baseline/source-scan order. Both use actual
   installed core/MCP and the same pinned baseline model, source-evidence context,
   fresh temporary stores and manually admitted identical sources/labels. Only
   selectionMode differs. Do not send evaluator-only rubric to the provider.
3. A new immutable source-scan-ablation-v1 intent, source/artifact/fixture pins,
   exact shared-ledger checkpoint and narrow one-shot attempt cap protect the
   run. Maximum 64 HTTP requests / US$0.32 conservative reservation within the
   existing cumulative US$50 ledger, not an additional budget. Only baseline
   select/rank and their count routes are allowed; no capture, relate, host
   completion, retry, resume, old-intent reset or old-capability widening.
4. Retain every arm including failures, raw synthetic inputs/outputs, exact
   returned source identities, strategy, durations and known/unknown/reserved
   costs. Report required-source coverage and irrelevant-source inclusion
   separately, not answer truth or user trust. Independent semantic review is
   still required; no rerunning failures to improve results.
5. Empty-key preparation and fake-HTTP actual-install tests verify forwarding,
   all 16 slots, caps, pin/checkpoint changes, transport failure and immutable
   repeat denial. Required dual-runtime contributor/live/guard/artifact tests
   and independent dual review precede any live execution.

The source scan's complete-map property is mechanical. Whether the ranker keeps
changed evidence and avoids unrelated material remains the experimental question.
Fine-grained rationale binding and false decision adoption are not fixed by this
experiment and remain explicit next work regardless of retrieval results.
