# Recall-only query-aware navigation excerpts

Base: `c0cbc6027316750a73a8a9423e62aeae4104c2f3`, dependent on PR44.

## Diagnosis before implementation

The frozen six-case [real diagnostic](../evidence/recall-label-visibility.md)
missed the target with four and sixteen memories when the fact followed generic
filler. The same facts at the front passed. An independent scripted one-memory
contrast also fails when the selector only has prefix evidence.

Ranked, falsifiable hypotheses:

1. Navigation information loss: target reference visible but distinguishing
   words absent. Supported in both actual failures. Test a bounded excerpt
   containing query-matched words without changing candidate membership.
2. Model relevance choice: the model can still reject useful evidence. Keep the
   same model/prompts, retain all follow-up outcomes, and distinguish visibility
   from selected and ranked target identity.
3. Pagination starvation: excluded for these cases by all maps being exhausted
   and target refs visible; remains a separate larger-store limitation.
4. Storage/source loss: excluded for these cases by current direct target reads.

## Acceptance fixed before implementation

- E1: Only recall's internal navigation changes. Public `core.map` and
  classification keep existing prefix labels and input schemas. No SQL candidate
  filtering/reordering, full-store lexical retrieval, persisted summary, new
  dependency, schema migration, model/prompt change, or fallback engine.
- E2: For already-authorized, current memory rows, choose a deterministic
  contiguous excerpt of at most 120 Unicode code points using literal query word
  overlap. Return original content, never synthesized text. Preserve the prefix
  when no useful match exists or the body fits. Document lexical limitations;
  this is navigation evidence, not semantic ranking or guaranteed recall.
- E3: Bind internal map cursors to query and excerpt version using a keyed digest,
  not plaintext query. Generate excerpts before existing token packing. Public
  cursors cannot be accepted as recall-internal cursors and vice versa. Keep
  namespace, index epoch and revision protections and authoritative final reads.
- E4: Red-before-fix offline tests reproduce a hidden target among distractors;
  green-after-fix verifies selector-visible evidence and actual recall. Also test
  front/back, no match, absent answer, non-ASCII/code-point integrity, deterministic
  ties, repeated words, public-map compatibility, token budgets, two-page
  continuation, namespace isolation and correction/deletion behavior. Existing
  malformed-ref/final-read tests must remain green.
- E5: Keep the current ceilings: two selection calls, one ranking call, two map
  pages per namespace, 120-code-point labels, 4,000-token map responses and
  6,000-token model inputs. No paid tests in CI, no agent credential access.
- E6: Primary runs core suite and relevant demos on Node22.16 and24, plugin tests
  and validation, adapter/MCP regressions and installed-artifact checks as needed.
  Independent Standards and Spec reviews use a fixed local commit before push.
- E7: Freeze a new follow-up operator/intent before paid calls, reuse the six
  original fixtures exactly, then include separately identified held-out wording,
  position and absent-answer checks. Preserve baseline failures; no retries to
  green and no broad accuracy claim. Use the original USD20 ledger at 886 requests
  and USD9.650 reserved, with an additional local cap of USD1 /100 requests.

Delivery is a focused dependent PR. No self-merge, publication, deployment or
private product changes. A passing narrow repair does not complete the broader
memory-quality, ecosystem or PLG milestones.

## Frozen excerpt policy (before runtime edits)

Tokenize maximal Unicode letter/number runs (`/[\p{L}\p{N}]+/gu`), apply
locale-independent lowercase, and match whole tokens. No stemming, Unicode
normalization, stopwords or language-specific segmentation. A contiguous CJK run
is one token: exact full-run overlap can match, a word embedded in a longer CJK
run cannot. This limitation must not be marketed as multilingual semantic recall.

For content longer than 120 code points, score each 120-code-point window by the
number of distinct query tokens wholly contained as full content tokens. Repeated
occurrences count once. Highest score wins, earliest start breaks ties; zero
matches returns the prefix. Short content is unchanged. Return the exact original
substring, preserving code points. A sliding window bounds computation linearly
in content/query length; current limits are 4,000 UTF-16 units each and at most
101 already-authorized rows per map request. No additional database lookups.

“Original” here means current stored content after existing admission sanitation;
the existing contract also normalizes/redacts the query. The excerpt helper adds
no normalization and never reads pre-sanitation text.

## Installed-host confirmation (frozen after source diagnostic, before host calls)

E8: After the source-level ten-case follow-up, verify the new installed artifact
through one fresh pinned Hermes A–F loop. Require all six product stages to pass
both structural and independent semantic review. Record the no-memory control
separately; this new diagnostic does not redefine PR44's failed combined gate.
No replacement run, model/prompt change or success-by-retry. Verify every installed
allowlisted source byte against this worktree before traffic. Reuse the same
original ledger at 924 requests / USD9.840 reserved, with an additional local
stop line of USD1.50 /100 requests and the unchanged USD20 cumulative ceiling.
Raw synthetic profiles remain private, keys remain primary-only and in memory.
This verifies the installed route for the changed engine, not general relevance.

## Verification receipt

Primary independently ran final source on Node22.16.0 and24.15.0, sanitized
environments, synthetic stores only:

- `node --test --test-reporter=spec core/test/*.test.mjs`: 214/214 each.
- `npm test` and `npm run validate`: pass each; plugin suite31 tests.
- `npm run demo:store`, `demo:moc`, `demo:recall`, `demo:continuation`: pass each.
- `npm run test:openai` and `npm run test:mcp`: pass each; MCP18 tests.
- After isolated adapter installs and `node packaging/prepare-cache.mjs`,
  `npm run test:artifact`: 14/14 each, actual installed subprocesses. Both archives
  have SHA-256 `c3310204f3e3e8351134433318876852666c389012c0d33c846da5350cff0dff`.
- `node --test evaluation/live/test/*.test.mjs core/test/recall-excerpts.test.mjs`
  with all six pinned Hermes fixture variables and the new installed artifact:
  49/49 each, zero skips (38 host/evidence plus11 excerpt tests). HTTP scripted;
  the separate actual paid host confirmation is recorded in the evidence page.
- Pinned Claude2.1.260 `plugin validate .` and
  `plugin validate plugins/cairn-memory --strict`: pass.

The worker first established a real SQLite/scripted-selector red test before
runtime edits. Helper tests include60 fixed-seed cases against an independent
exhaustive-window oracle. No TypeScript gate exists in this JavaScript repository.
Final committed diff and independent review results belong to the delivery PR.
