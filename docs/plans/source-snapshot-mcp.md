# Explicit keyless admitted-source snapshot over MCP

Dependent base: `5a35c796933d14fc2f88915ca91c7676978e403e`.
Expose the verified shared-core snapshot to actual local MCP users without
introducing a second read implementation or changing existing tool defaults.

## Acceptance

1. Strict opt-in `sourceSnapshot: 'current-admitted-v1'` in `createCairnServer`,
   configured by CLI `--source-snapshot current-admitted-v1`. No coupling to
   capture/qualification/staging/rationale flags. Validate modes and a supplied
   callable token counter before database creation in the programmatic factory.
   Missing/invalid opt-in values reject; ordinary startup/tool sets stay unchanged.
2. When opted in, expose exactly one additional read-only local tool,
   `read_memory_sources`, accepting only optional integer limit1–12(default6)
   and tokenBudget1–4000(default4000). Bound readSet to the startup namespace;
   no query, owner/project override, source IDs, cursor, partial fallback or
   automatic promotion. Delegate to `core.sourceSnapshot` without rewriting its
   evidence, freshness, bounds or failure guarantees. Source-only content and
   trust/coverage labels survive actual SDK round trips.
3. Keyless CLI startup can supply the existing `o200k_base` tokenizer through a
   narrow `countOpenAITokens` export from the optional OpenAI adapter. Reuse its
   exact local count function; no duplicate tokenizer implementation, fake API
   key, fetch or generation method. Existing adapter model behavior stays intact.
   Only load the tokenizer for opted-in normal startup (or existing real-model
   setup), not default keyless startup or syntax-only --check-config.
4. Help/config/tool descriptions clearly say whole small current-admitted source
   set, potentially unrelated content, not full conversation history, relevance,
   truth/applicability or execution authority. Existing semantic recall/capture
   remain separately model-dependent. Local snapshot makes zero provider calls.
   Budget is the core success envelope measured with o200k_base, not the host's
   whole prompt or MCP framing. No raw paths/keys in generic diagnostic errors.
5. Actual stdio SDK tests cover default absence, opt-in discovery/readOnly and
   openWorld false, strict input/namespace isolation, keyless source return, count
   and token overflow without partial evidence, correction/forget then cold
   snapshot, constructor rejection before database creation, and compatibility
   with existing capture/staging option combinations. A real CLI child with no
   API key must remember/close/reopen/read exact sources; assert no provider
   transport or generation. Add explicit isolated counter export tests.
6. Add installed-artifact CLI/SDK proof with no key: inspect the built runtime
   hashes, startup/check-config, explicit write then cold source snapshot,
   over-limit rejection and forgetting. No global install, registry publication,
   model request, private source or user database. Update CLI and public MCP/API
   privacy docs, changelog, and a concise keyless walkthrough.
7. Verify both Node22.16/24 MCP, OpenAI offline and artifact suites, focused
   tests, generic JSON/plugin checks. Independent Standards/Spec review on fixed
   candidate, then required CI successes before any authorized merge.

This slice delivers source evidence unchanged, not a quotation-only answer
renderer or a semantic quality repair. Previous generated-answer failures remain
failed. Fresh multi-window evaluation remains a separately frozen next gate.
