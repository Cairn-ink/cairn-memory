# C1 — single-attempt ordered live evidence

Fixed runtime/harness parent: PR57 `a01f35bddc74fa60a62b69f3f339b10e0cc42178`.
The owner explicitly authorized execution and cumulative spending up to USD30.
This supersedes the human USD20 ceiling, not historical accounting. This first
attempt deliberately retains the stricter immutable USD20 ledger configuration;
no refill, new ledger, policy rewrite or accounting reset is needed.

## Frozen acceptance before calls

- Primary alone reads the authorized OpenAI key and executes paid requests.
  Delegate independent operator review and post-generation semantic review.
- One coordinator, no concurrency, retries, fallback or replacement runs.
  Execute the reviewed ordered four-history audit, seven-case currentness audit,
  and installed ordered A–F lifecycle once each, with original frozen fixtures.
  Preserve every result including partial, failed and not-run stages. A semantic
  failure does not erase evidence or authorize a tuned rerun.
- GPT-5.4 mini snapshot `gpt-5.4-mini-2026-03-17` for extraction only; original
  `gpt-4.1-mini-2025-04-14` for other methods including reconcile. No model,
  prompt, runtime or rubric changes in this evidence delivery.
- Reopen original ledger run `a9f5f491-9335-4790-ad92-8ad090e21e80` at the
  settled checkpoint 1725 requests /14617736 microUSD reserved. Record the
  owner's new cumulative USD30 grant separately, preserve all original files.
  Provision the reviewed reconciliation extension explicitly with the existing
  extraction token. All requests use the combined guard and single-attempt fetch.
- Local attempt ceiling: additional3000000 reserved microUSD and300 HTTP requests,
  within the existing ledger ceiling. Reserve conservatively before every call,
  serialize session requests, and latch any transport/guard/budget failure to
  prohibit subsequent HTTP calls. Count unknown costs conservatively, no refunds.
- Freeze operator hash, all runtime/harness/source/rubric hashes, artifact hash,
  original policy/token hashes, ledger checkpoint and stop conditions before key
  access or first provider call. Exclusive private intent prevents repeated runs.
  Preflight uses no key and no network; live mode checks the same exact pins.
- Use only fresh synthetic stores and the verified local installed archive
  SHA256 `49cb04896119c92b78043747517fa87e6db7df30c1a2247b6aacd9c2390d619a`.
  Installed consumers receive a synthetic proxy capability, never a real key.
- Retain raw reports privately with mode0600 exclusive durable writes. Log only
  content-free progress/accounting. Primary sanitizes any public evidence before
  delivery; no credentials, local paths, user data or private operational files.
- Independent semantic review happens after generation against unchanged
  currentness/history rubrics and installed sources, never helper flags or
  successful HTTP alone. Use existing scorers; absent labels cannot pass.
  Report mechanisms, source support, currentness, omissions and safety separately.
- This does not authorize merge, release, registry publication, outreach,
  production deployment, private-engine changes or a product-readiness claim.

## Delivery gates

Pricing checked before execution against official model pages: standard text
input/output per million tokens is USD0.75/4.50 for
[GPT-5.4 mini](https://developers.openai.com/api/docs/models/gpt-5.4-mini) and
USD0.40/1.60 for [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini).
Existing guarded prices match; no discounted cached-input assumption is needed.

Public evidence/docs changes use this isolated worktree, generic tests/validation,
relevant scorer tests on Node22.16/24, and pinned Claude validation. Freeze a
candidate and obtain independent Standards and Spec review before pushing a PR.
Keep original failed evidence immutable. Report actual totals, known usage versus
reserved allowance, all skipped cases and the next concrete quality gap.
