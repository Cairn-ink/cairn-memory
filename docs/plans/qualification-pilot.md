# One-shot installed qualification pilot (S4b)

Fixed base: `ccb93169eaf44aa0f8171311cfe8538e6fc54e44`.
S4a passed both runtime matrices and independent Standards/Spec review.
Local dependent work; inherited private security disclosure hold remains.

## Evidence boundary

This is a source-production pilot, not a currentness benchmark or release gate.
The independent case author had no Cairn implementation/fixture access. Root
selected six of its twelve proposed bilingual cases and fixed one language for
each before any provider call. Root sees both implementation and expectations;
this is independently authored, not a fully blinded experiment. Preserve the
original meaning when converting its messages into role/content arrays.

Freeze `evaluation/live/qualification-pilot-fixture.json`: version 1, six cases
in this exact order: changed preference (English), temporary exception (zh-TW),
assistant suggestion without adoption (English), disproved decision premise
(zh-TW), unresolved contradiction (English), explicit change with reason (zh-TW).
Each has initial/later message arrays and the author's query and expected
current/history/reason/prohibited-inference/reconfirmation descriptions. These
expectations never enter the model payload; queries are not answered in this
pilot. Do not claim its expected state behavior has been implemented.

## Frozen operator acceptance

- E1: add explicit `runQualificationPilot` operator; imports never run it. Only
  injected fetch and explicitly supplied synthetic/private configuration; no
  native fetch fallback, credential discovery, new budget or resumed attempt.
  Exact options: `{ledger,expectedCheckpoint,apiKey,fetchImpl,nodePath,
  cairnExecutable,cairnArtifact,cairnArtifactSha256,privateDirectory,pins}`.
  expectedCheckpoint is exact `{requestCount,reservedMicroUsd}`. Ledger must be
  the supplied existing open/settled US$50 phase (limit <=50000000 microUSD),
  with unchanged identity/policy/history. Smaller synthetic ledgers may be used
  by offline tests. No old US$20 campaign or prior failed fixtures are used.
- E2: fixed per-run ceilings: 100 HTTP requests and 1000000 microUSD additional
  conservative reservation, within remaining shared-ledger headroom. Require
  sufficient headroom for those declared ceilings at preflight. Both count and
  generation requests, including errors/unknown usage, consume reservations.
  Baseline experimentPolicy charges 5000 microUSD for each permitted request.
  No host completion/judge/reconcile/alternative extraction or automatic retry.
- E3: validate absolute canonical node/artifact/install/evidence paths, installed
  artifact SHA and source correspondence using existing helpers. pins is an
  exact filename-to-SHA map for the checked-in fixture, operator, qualification
  session, request guard, proxy and launcher. Freeze these hashes before I/O and
  verify before first and every subsequent request. New helper modules, if
  needed, must join the pin set. Recheck installed archive/runtime correspondence
  before first request. Never silently accept missing or updated pins.
- E4: exclusive durable `qualification-pilot-v1-intent.json` in the existing
  ledger directory prevents this fixed pilot being rerun via another output
  directory. Use existing safe exclusive/fsynced evidence helpers. Provision
  the reviewed qualification capability with fixed authorization ID
  `qualification-pilot-v1` only after local preflight and intent creation.
  Existing partial intent/authorization is retained and blocks execution;
  no overwrite, cleanup, automatic recovery or budget reset.
- E5: serialize all upstream requests. Check exact expected shared checkpoint
  and settled state before and after each request, including after callback/
  persistence work before sending. Persist content-free per-request reservation
  before sending and settlement/failure afterward, append-only. Unexpected
  activity, pin/persistence failure, transport error, timeout or cap exhaustion
  permanently halts this attempt. No further requests after halt, no refunds.
- E6: use actual installed MCP via existing launcher/proxy/new guarded parent
  session. Child gets proxy token, never real key. Each case has its own fresh
  database and fixed namespace; initial and later captures use distinct fixed
  batch IDs in that namespace. Call only capture_memory and inspect_memory.
  Expectations/queries are evaluator-only. Two batches per case, six cases,
  maximum 12 capture operations; expected fully successful route ceiling is
  72 HTTP requests (extract/qualify/classify count+generation), not permission to
  retry failed stages. Missing/empty required extraction is recorded, not fixed
  by handwritten admission. No trusted binding, retirement or correction calls.
- E7: record original capture envelopes and qualified ID inspections, exact
  source receipts and missing/failed stages in private evidence. Close the
  process, launch a fresh one, inspect again and replay completed batches with
  an operator-enforced zero-request read/replay phase. Evidence must match;
  pending/new requests during that phase halt. No date/currentness assertions
  inferred from active state or successful qualifications.
- E8: initialize all six cases/twelve event slots in report as not_run. A
  semantic/structural failure (`invalid_model_output`, input budget rejection,
  empty admission) marks that case failed, skips its dependent later stage and
  may continue to the next fresh case. Transport/timeout/unknown fatal failures
  halt all remaining cases; classification failure is retained explicitly, not
  disguised as capture failure or success. Do not replace failed/not-run cases,
  rerun them or remove them from denominators. No automatic semantic score.
- E9: report provider-known usage separately from conservative reservations,
  before/after shared checkpoint, request counts, per-case structural outcomes,
  source/fixture/operator/archive hashes and semanticReviewRequired:true.
  Raw synthetic text stays in private 0700 directory/0600 files. Errors are
  finite/content-free; persist all writable failure evidence without replacing
  an original failure when cleanup also fails. No credentials in artifacts.
- E10: offline tests cover all safe gates using synthetic ledgers/fake HTTP,
  including exact caps, failed/late requests, checkpoint tampering, partial
  intent, mismatched pins, missing artifact, persistence failures, malformed
  qualification and complete/not-run denominator preservation. Installed test
  exercises actual tools through guarded proxy, fresh restart and replay; do
  not substitute core calls or skip this installed gate in root verification.
- E11: both Node22.16/24 generic/JSON/plugin, OpenAI/MCP, full offline live tests,
  ledger/guard tests and installed-artifact tests. Exact final commit gets
  independent Standards/Spec review before any actual phase-ledger/key access
  or live request. Runtime/prompts/fixtures must remain frozen during the run.

## Subsequent real execution

After E11, root verifies the existing phase policy/checkpoint and official
baseline prices, builds/pins the archive and operator inputs, then uses the
previously authorized US$50 phase resources within this smaller US$1/100 cap.
No new user authorization or total budget is inferred. Independent post-run
review judges extraction completeness and qualification semantics against the
frozen sources. It must distinguish quoted/proposed/temporary claims and reasons
from adopted decisions. Any failure is retained before a separate improvement
and freshly authored evaluation. No merge, release, deployment or security
disclosure is part of this pilot.

The [official GPT-4.1 Mini model page](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
was fetched before execution planning: it lists the pinned 2025-04-14 snapshot
and standard text prices of US$0.40 input / US$1.60 output per million tokens.
These match the existing policy; no pricing or model migration is proposed.
Count requests still retain unknown actual cost and their conservative full
reservation. Model listing does not verify this account's access or credentials.
