# Independent preflight and observed usage bounds

Base: `97b09f4afb7476729e602a0afca4fc5a88c2c0e6`.

A frozen synthetic experiment returned preflight2251 input tokens and observed
2377 input/123 output/2500 total. Shared count/generation payloads match exactly
apart from generation-only max_output_tokens/store/stream. Selected refs are
valid; offline replay diagnoses adapter `response_usage` rejection. Do not
modify or rerun that scored case. This is a transport-contract repair, not a
semantic improvement or evidence that the service guarantees a drift amount.

The official [counting guide](https://developers.openai.com/api/docs/guides/token-counting)
describes an exact count for the same request, while
[response usage](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create)
records generated response usage. This observed discrepancy conflicts with that
expectation; its provider-side cause is unknown. Accepting independently bounded
usage is a deliberate resilience policy, not a claim that drift is documented
normal behavior. Preserve the existing ceilings rather than assume arbitrary
drift is safe.

## Acceptance

1. Keep serialized immutable count/generation payload construction, one count
   then one generation, fixed model profiles, local input6000, preflight7024,
   max output1024, context-window checks, cancellation and no retries unchanged.
2. A completed response is no longer rejected solely because its valid observed
   input usage differs from preflight. Independently require observed input
   <=7024, observed input plus reserved1024 <=selected model context window,
   observed output<=1024 and total=input+output. All usage values remain safe
   nonnegative integers; no missing usage, malformed envelope, wrong model,
   refusal/tool output, oversized/local-token output or invalid refs are allowed.
3. Preserve `invalid_model_output` and content-free `response_usage` diagnostics
   for malformed/over-limit observed usage. Do not expose raw data in diagnostic
   events, alter cost-ledger/grant code, widen a budget or replace actual usage
   with preflight for accounting. Post-response checks cannot prevent provider
   work already performed; no invoice-level spend guarantee is claimed.
4. Before the fix, independently authored tests reproduce bounded upward/downward
   count drift rejection at the actual adapter seam. After the fix, those pass;
   exact7024/1024 edges pass while7025/1025, inconsistent totals, malformed usage,
   missing counts and wrong model/ref data remain rejected without retries.
   Existing corruption tests must still test real corruption, not assumed
   count equality. Include actual-core or adapter lifecycle proof of accepted
   bounded drift and no unsafe finalization on over-limit response.
5. Root replay of the retained input/output through fake HTTP demonstrates the
   original adapter rejection and repaired parsing without provider execution or
   changing the frozen result. Run full OpenAI offline suite/demo plus generic,
   JSON and strict plugin gates on22.16/24. Independently reviewed exact candidate
   and all required CI precede merge. Preserve Node20 generic compatibility.
   CI exposed a second obsolete equality-based mock in the installed diagnostic.
   Preserve that failed check, replace its invalid-usage fixture with actual
   observed overflow, and add a separate installed bounded-drift success mode.
   The existing transport guard intercepts overflow before the adapter receives
   it; assert the actual halted/transport-failure layer, not response_usage.
   Install both isolated adapter sets, prepare the documented metadata cache,
   and run full artifact plus MCP gates on both core runtimes before delivery.
6. Update current provider documentation and Unreleased changelog. Historical
   frozen runs and plans retain their original count-equality rules/results.
   No selector promotion, model change, new paid test, release or deployment.
