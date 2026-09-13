# Frozen installed rationale comparison

Base `31d8f36773aae00c7d646061de68ea67fca01f1b`, following guard PR #73.
Implements acceptance 4–6 of `rationale-experiment.md`; no paid call before
offline installed verification and independent review of the frozen candidate.

## Acceptance

1. Pin the eight-case fixture to SHA256
   `a7d3042027bf8dee46df16ef99bbe5be9a86beb622139a2795efe79fc0d73409`.
   Preserve all 16 case/arm records before work begins, alternate arm ordering,
   use separate fresh SQLite stores, same pinned baseline provider and actual
   installed artifact. Two events per arm. Never pass evaluator rubric to MCP.
2. Require exact options, explicit parent credential/one-attempt transport,
   matching reviewed source pins, canonical executable/archive/private paths,
   verified archive/installed bytes and explicit immutable rationale capability
   with authorizationId `rationale-pilot-v1`. Imports do nothing. Never create
   a ledger, replenish allowance or infer a grant from files alone.
3. Claim an exclusive fsynced ledger-scoped `rationale-pilot-v1-intent.json`
   before proxy startup or model calls. Refuse occupied evidence directories,
   preserve existing intents, pin capability bytes and full settled checkpoint.
   Apply existing 384 HTTP/US$1.92 cap within cumulative US$50, additionally
   max 6/8 HTTP per baseline/candidate capture and 4 per recall. No retries.
4. Child gets only an authenticated loopback token. Capture explicit event
   messages, then recall source-evidence versus rationale-evidence. Persist
   every bounded request/response, capture/recall envelope and independent
   partial failures. Transport/accounting/persistence failure halts the entire
   attempt; semantic/core output failure may leave an arm incomplete without
   retrying it. Failed/not-run arms remain in denominator.
5. Cold restart with an empty provider token, inspect all active memories and
   candidate graphs, compare to warm evidence, replay only committed captures
   and require duplicates without model calls. Forget every active record and
   confirm empty active listing. No paid reads; any unexpected request halts.
6. Offline installed tests run the complete sixteen-arm schedule through actual
   adapter framing and durable synthetic guard, not a replacement in-memory
   engine. Test retained model-output failure, transport halt and refusal to
   reuse an intent. Preflight tests reject altered pins/options/unsafe paths
   without transport. Both Node runtimes and independent dual review required.

## Frozen semantic rubric

An independent reviewer reads sources and recorded outputs; expected fixture
rubrics remain evaluator-only. For each arm label (pass/fail/unassessed):
choice/adoption fidelity, reason retention, changed-premise detection, attribution
and scope fidelity, uncertainty fidelity, source fidelity, and false replacement.
For candidate graphs additionally label every proposed edge supported/unsupported
by its exact source endpoints and count missing expected links. For baseline,
edge metrics are not applicable, not scored zero. A missing/failed recall cannot
earn answer-context success. Empty graphs can avoid false links but cannot earn
positive detection. No aggregate hides severe invented adoption/replacement.

Store invocation counts, reserved and known/unknown costs, wall-clock latency and
coverage omissions. This is a small synthetic diagnostic, not a benchmark
ranking, statistically established improvement, host-answer assessment or proof
of real-user reliability. Keep all failed observations; no retuning/rerunning
these cases as held-out evidence. Public export must omit private paths/keys and
distinguish mechanical results from independent semantic judgments.

## Offline verification

Node 22.16.0 and 24.15.0: `npm test`, `npm run validate`,
`npm run validate --prefix tools/plugin-validation` and
`npm run test:live-evidence-offline` pass (115 passed, 30 skips each; three
new installed cases are separately enabled below). Explicit installed command:

```sh
CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs
```

All four tests pass per runtime: full 16-arm schedule, retained malformed-output
schedule, transport halt and preflight. Happy path uses 288 synthetic HTTP calls;
cold inspection/replay/forget adds none. Tests initially exposed incorrect test
fixture archive-digest/header access, corrected before these passing runs;
neither failure involved a provider call or a production-core change.
Source fixture hash remains unchanged. Independent review and green CI precede
autonomous merge; live evidence is not yet established by this record.
