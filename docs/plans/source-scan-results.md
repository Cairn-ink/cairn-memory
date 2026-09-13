# Public source-selection ablation evidence

Base `0469eac48412d29674357261cc0435096b256f5a` (#78).

## Acceptance

1. Preserve all sixteen fixed arms and failures from the one-shot
   source-scan-ablation-v1 experiment. Export only explicit synthetic source,
   query, model-stage, result and cost fields; remove private operator paths,
   namespaces, credentials and transport/provider metadata.
2. Validate the frozen fixture hash and schedule. Keep the distinction between
   manually admitted oracle sources, model-selected results and downstream
   answers that were not tested. Source-index retention is not answer accuracy.
3. Include source-preservation rubric caveats recorded before live outcomes:
   two-people, temporary-route, uncertain-course and compatible-confirmation
   contain potentially redundant provenance. Do not relabel frozen expectations.
4. Report fixed denominator, per-arm results, prefilter versus rank omissions,
   irrelevant-source inclusion, measured latency boundary and conservative,
   known and unknown cost components. Retain unfavorable or inconclusive results.
5. Independently assess returned source sufficiency and limits; add export tests
   for no private fields, denominator/failure retention and exact frozen metrics.
   Contributor/live offline gates on both runtimes, dual review and CI before
   merge. No new live calls, reruns, product default changes or quality claim.
