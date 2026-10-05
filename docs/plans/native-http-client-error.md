# Native HTTP client-error provenance

## Goal and observed boundary

N9 is CLOSED and unscored after first Mem0 arm halted with runtime/
native_http_invalid following15 succeeded/priced/settled requests. No N9 retry,
new paid call, reference evaluation or partial scoring. All177 requests settled;
891805 conservative microUSD this run, cumulative234488985/300000000.

Current kernel maps request-handler framing/JSON errors to native_gateway_failed;
native_http_invalid as first fault identifies the server clientError listener.
The underlying event code was not retained. A genuine tiny Node socket probe
demonstrated malformed header, partial EOF and HTTP request timeout can all
produce this classification; it copied the listener and is NOT a real-kernel
reproduction or a causal explanation of N9. No runtime relaxation is justified.

## Ownership and fixed point

Worktree /home/chichieh/Github/cairn-memory-worktrees/native-http-client-error,
branch test/native-http-client-error, base1706aa9f2f162d4d55f2147a7bbb24ec11aff2f5.
One actual GPT-6.1 Sol/high author; primary integration and acceptance; two
independent nonauthor review axes on final candidate. Dependent PR against
integration/diagnosed-current-engine, no main merge/release/deployment.
No actual corpus/key/ledger/control/old-operator access. Frozen DCE unchanged.

## Acceptance NHC1–NHC7

NHC1: Build a real-kernel/genuine synthetic guard test that demonstrates the
missing distinction: a successful settled fake-provider prefix followed by
genuine socket header/EOF/request-timeout faults, plus valid HTTP/invalid JSON
and healthy controls. Assert original failure reason, accounting and cleanup.
No manual event injection as sole behavioral evidence. Minimize/record red
diagnostic assertion before implementing the additive observation.

NHC2: Retain ONLY first accepted clientError provenance as a bounded immutable
diagnostic: finite allowlisted Node error category (unknown explicit), bounded
connection/request state and elapsed time needed to distinguish request/idle/
response lifecycle. Capture before destruction. Never retain rawPacket, message,
stack/cause, headers, URLs, source text or arbitrary provider codes. No callback
extension. Prefer smallest optional shape using existing native failure projection;
checkpoint precise schema and threat model with primary before implementation.

NHC3: Carry authenticated diagnostic through runtime error -> mixed native
failure -> journal/scorer roundtrip without changing status, reason, authority,
retry, deadlines, grants, accounting, native child source or Connection:close.
Legacy records remain valid; new invalid/proxy/accessor/forged/oversized data
must not execute callbacks or escape. Unknown original cause remains unknown.

NHC4: Exercise a sustained healthy genuine pinned native/httpx fake-HTTP run
with multiple batches (>15 requests if controllably generated), checking exact
request order/count, no retries, next-scope admission and child/socket/root
cleanup. If a real defect is reproduced, STOP at evidence and propose ranked
falsifiable hypotheses before fixing; do not fold speculative runtime fixes into
this diagnostic change. Synthetic timeout acceleration is explicitly labeled.

NHC5: Run applicable CONTRIBUTING gates on exact Node22.16.0/24.15.0: generic,
validate, budget/guard, portable/native-local, mixed-native/LongMemEval and
budget/guard/mixed demos when changed paths require them. Use real pinned native
prereqs and owned fresh workspaces, no provider network/operational ledger.
Missing prerequisites fail, skips not counted as passes. Record all failures,
complete logs and scope cleanup. Primary reruns key genuine paths on final bytes.

NHC6: Add focused threat-model/limitations documentation; no N9 cause or score
claim, no full product reliability claim. Maintain distinct original observations
and synthetic evidence. Old N9 artifacts are immutable. Keep change small.

NHC7: Freeze scoped candidate after tests, independent Standards and Spec same
base/head, all latest-head CI pass before ready. Primary handles commit/push/PR.

## Worker scope

Allowed: evaluation/experiment-budget/mem0-native-runtime.mjs additive metadata,
its focused tests/controlled fixture; evaluation/longmemeval/mixed-native-failure
projection/shape and relevant journal/scorer tests; this plan, docs/limitations.md.
Canonical test registration if needed. Do not edit batching/core/other worker
files, guards, native child/model/policy/configuration, stop classification or
timers. No old artifact mutation, repo-wide cleanup or dependency lock change.
Before broad gates send actual original repro + proposed diagnostic shape.

## Approved finite diagnostic contract

After the original genuine-kernel RED, primary explicitly approved this optional
schema and private minting model. `nativeFailure.httpClientError` contains only:
version1; code HPE_INVALID_HEADER_TOKEN, HPE_INVALID_EOF_STATE,
HPE_HEADER_OVERFLOW, ERR_HTTP_REQUEST_TIMEOUT, ECONNRESET, other_parser or
other; connectionOrdinal1..1000000; total requestCount0..1000000;
connectionRequestCount0..requestCount; phase headers/body/response/idle;
stopping boolean; scopeStatus active/completed/failed;
connectionAgeMs0..2147483647; sinceLastResponseMs null or0..2147483647.
Counters saturate at1000000. Monotonic elapsed milliseconds are floored and
saturate at2147483647; they are not wall-clock dates or causal proof.

Phase is per connection: headers before the first Node request callback, body
from that callback until the bounded body completes, response from completion
until ServerResponse finish, idle after finish. The phase is an observed
lifecycle boundary, not inspection of parser internals. Last-response age is
global to this kernel; connection age is local to the offending connection.
Only the first accepted clientError is captured, before connection destruction.
The existing first fault and ignored revoked/stopping ECONNRESET rule remain.

The code is extracted using an own data descriptor, never a getter or arbitrary
coercion. A private runtime WeakMap associates the immutable internally minted
diagnostic with the actual thrown native Error. Public caller properties,
constructor arguments, copied errors and proxies cannot mint this metadata.
The mixed shape validator accepts only exact plain own data, finite whitelisted
codes and bounded numeric state. JSON journal/scorer roundtrips carry an
observation and do not acquire execution authority. Legacy three-field native
failures remain valid. No arbitrary messages/codes, rawPacket, headers, URLs,
source, stack/cause, key or content is retained. No retry, deadline, halt,
scoring, stop classification or Connection:close behavior change is authorized.

Primary approved a narrow scope extension after inspecting the shared callers:
mixed-validation.mjs rejects nested proxies before reflective snapshot traversal,
and mixed-scoring.mjs validates optional nativeFailure using the existing shared
shape and the same failed-Mem0/execution context rule as the journal. No scoring
arithmetic, evaluator/reference handling, guard or budget change. New optional
metadata and its fields must be enumerable own data for JSON roundtrips; legacy
three-field native observations retain their existing shape policy. These checks
do not claim every unrelated options/root/public caller is globally hardened.

## Original RED and sustained healthy control

Author: actual GPT-6.1 Sol/high, fixed public base1706. The worker read the
diagnosing-bugs and worktree-pr-workflow skills, their model-routing reference,
and this public repository's CONTRIBUTING.md before edits. Root owns delivery.

Before runtime/projection changes, the genuine kernel and synthetic v3 guard
cross a genuine UDS after one successful fake-provider embedding response:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin node tools/testing/run.mjs --test-name-pattern='NHC1 genuine kernel settled prefix then bad-header' evaluation/experiment-budget/test/native-http-client-error.test.mjs
```

Natural exit1, 1failed/0skipped, duration1100.169765ms. The sole failure was
`undefined` versus `HPE_INVALID_HEADER_TOKEN` for required provenance. Finite
observation: nativeReason native_http_invalid, guardReason callback_failed,
requests1, diagnosticPresent false. Assertions before that failure establish
succeeded/priced/response-terminal prefix1, no pending durable attempts,
global halt, active/null scope, outcomes0, controlled child and raw UDS closed,
kernel root removed, and next scope denied. This uses a controlled process
double with the unchanged real kernel and genuine guard, not an installed
native child or an actual N9 replay.

The same canonical command without its test-name filter ran5tests:
2passed (healthy and complete HTTP/invalid JSON), 3failed solely for missing
diagnostic codes (header token, partial-header EOF, header timeout), 0skipped,
duration5663.128049ms. The timeout case accelerates only Node's connection
expiry scan to10ms in a scoped test mock; the actual kernel2s header deadline
and all configured safety timers remain unchanged. JSON retains
native_gateway_failed; all three clientError cases retain native_http_invalid.

The original sustained healthy control ran before runtime changes:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu node tools/testing/run.mjs evaluation/experiment-budget/testing/native-http-client-error-local.test.mjs
```

Natural exit0, 1passed/0skipped, duration5646.052973ms. Genuine pinned
Mem0/httpx ran six identical synthetic batches and search, exact19requests:
(embedding/chat/embedding)x6 followed by embedding. All19 succeeded, priced
and response-terminal; scope completed, global halt false, child closed,
owned OS group absent, kernel socket/store root removed, next scope entered
once. Duplicate synthetic facts deliberately keep the provider script small.
Healthy traffic exceeding15requests does not by itself reproduce N9; its
unknown underlying clientError code remains unknown.

## Focused post-change evidence and retained harness failure

The approved additive runtime projection made the original three diagnostic
assertions green while retaining the same error/halt/accounting/cleanup shape.
Node24 focused NHC tests passed9/9, 0skipped, duration7415.85271ms. They include
private Error identity minting, copied/forged/getter/proxy error-property refusal,
exact enumerable metadata, JSON roundtrip, genuine kernel diagnostic journal
retention and scorer input, and malformed nested metadata denial before trap or
provider entry. Existing legacy classifications remain covered separately.

One earlier journal command placed --test-name-pattern after the first test
path and consequently ran all32tests:31passed/1failed, duration36579.73693ms.
The failure was a harness assertion incorrectly expecting generic JSON snapshot
to reject semantically invalid but serializable plain fields. The shared finite
shape correctly rejected those values; generic snapshot is not that validator.
The assertion now requires snapshot rejection only for nonserializable own data.
The focused9 rerun above passed. This failure is retained, not represented as a
runtime defect or silently discarded.

Genuine reset invocation:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin node tools/testing/run.mjs --test-name-pattern='NHC2 genuine UDS reset' evaluation/experiment-budget/test/mem0-native-gateway.test.mjs
```

Natural0, 1passed/0skipped, duration1096.819686ms. A valid100-item embedding
response creates real unread IPC bytes; the controlled child revokes its scope
and closes its UDS on first response data. Node emits actual ECONNRESET, never
manual emit. The kernel retains failed/cancelled, haltfalse, succeeded/priced/
response-terminal accounting, root removal and next-scope admission. The
existing late-malformed-after-local-seal global refusal remains a separate
canonical regression. Portable metadata tests are registered by the canonical
gateway suite; the sustained installed control is registered by the canonical
native-local suite. No timer/configuration or native child source changed.

## Primary acceptance on stabilized CODE

Primary personally authenticated these production SHA256 identities before its
key reruns: runtime0fc29844df6c9dbf566a44f375b88f51c1f58a07cf692de4bb186796e3afb438;
projection1d50c9cad6d6af1c473fb8e00419ce28284af45adcb64f0e4c4110d227754683;
shape1e347f995b6616b3fd73467f0c93a87d90cff211e5e236086e541a7c5c606d46;
snapshot700a513aeaa7ca4ae4ba937b28d8bcc05c69deabdbb0ac3ae93354d717807622;
scorer1bba0da11b9a1f45afda2e5b9bee106be76685af2b88c5fa7a4f2dcf86ee28c9.

Key command on both exact22.16.0 and24.15.0 PATHs, empty environment otherwise:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin node tools/testing/run.mjs --test-name-pattern='NHC' evaluation/experiment-budget/test/mem0-native-gateway.test.mjs evaluation/longmemeval/test/native-http-client-error-shape.test.mjs evaluation/longmemeval/test/mixed-result-journal.test.mjs
```

Each natural0,10passed,0failed/cancelled/skipped/todo. Node22 primary session71631,
duration9466.518911ms, output2b25b7; Node24 session17279, duration8802.071596ms,
output3c22a9. Command with Node24 uses the exact24.15.0 PATH instead.

Installed command is the original sustained control command above on each exact
PATH with only the two named pinned synthetic roots. Each natural0,1passed,
0failed/cancelled/skipped/todo, exact19settled requests, no global halt, child
closed, root absent. Node22 primary session98219, duration8465.299017ms,
outputd27cdc; Node24 session54644, duration7348.589213ms, output781ea8.
These reruns establish the approved prospective metadata behavior on these
bytes, not N9 causation, provider/model quality or general reliability.

## Complete author gate record and freeze

Both exact Node22.16.0 and24.15.0 ran every command below, each natural exit0.
No failures, cancellations, skips or todos in any test suite:1376passed per
runtime. All four author gate processes returned naturally: sessions48156,
88600 (main sequences),40354,63490 (maintainer/workspace sequences). Canonical
test runners verify their owned process groups before workspace cleanup; native
cases separately check owned child/group/socket/store cleanup. No test process
from these gate invocations is left running. Source bytes remained unchanged
through primary acceptance and these full gates.

Each main command used this empty-environment prefix, changing only the exact
Node version in PATH for the second runtime:

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu
```

| Command after prefix | Node22 | Node24 |
| --- | --- | --- |
| npm run test | 581/581 | 581/581 |
| npm run validate | exit0 | exit0 |
| npm run test:experiment-budget | 65/65 | 65/65 |
| npm run test:experiment-request-guard | 313/313 | 313/313 |
| npm run test:mem0-native-gateway | 58/58 | 58/58 |
| npm run test:mem0-native-local | 16/16 | 16/16 |
| npm run test:longmemeval | 271/271 | 271/271 |
| npm run test:mixed-native-local | 47/47 | 47/47 |
| npm run demo:experiment-budget | exit0 | exit0 |
| npm run demo:experiment-request-guard | exit0 | exit0 |
| npm run demo:longmemeval-ingestion | exit0 | exit0 |
| npm run demo:longmemeval-comparison | exit0 | exit0 |
| npm run demo:longmemeval-public | exit0 | exit0 |
| npm run demo:longmemeval-mixed | exit0 | exit0 |
| npm run validate --prefix tools/plugin-validation | exit0 | exit0 |
| npm run test:workspace-lifecycle | 25/25 | 25/25 |

Maintainer validation used env-i with the exact PATH,
NODE_DISABLE_COMPILE_CACHE=1 and a fresh CLAUDE_CONFIG_DIR at
/tmp/cairn-nhc-gates.feGgIb/claude22 or claude24; neither pinned native root was
needed. Marketplace and strict plugin validation passed with isolated locked
Claude Code2.1.260. Workspace-lifecycle used env-i, exact PATH and
NODE_DISABLE_COMPILE_CACHE=1, with isolated OpenAI and MCP dependencies installed.
All dependencies were installed using existing locks: npm ci --prefix
adapters/openai, adapters/mcp and tools/plugin-validation. No lock changed.
This public JavaScript repository has no TypeScript/typecheck gate, per its
CONTRIBUTING.md. No route/component/Next.js source changed.

Complete32logs are retained under /tmp/cairn-nhc-gates.feGgIb as
nodeVERSION.SUITE.log; maintainer uses SUITE plugin-validation. The private
manifest.json lists every complete log's exit code, byte count and SHA256.
Node22/24 mixed-native durations:323666.629815/316847.714123ms;
workspace durations:18962.803141/18821.094236ms. The plan retains the original
RED and the corrected harness failure above; full green gates do not erase them.

Worker delivery scope is stable for primary commit and independent same-base/
same-head Standards and Spec reviews. Worker made no commit, push, PR, paid
call, old artifact change, runtime relaxation or speculative defect fix.
Primary owns candidate commit, review integration and latest-head CI acceptance.

## Independent review documentation correction

Both initial independent axes reviewed candidate
e41376f585bc312d5ad5d10a28518b168800c486: Spec PASS with zero findings;
Standards PASS with one actionable documentation inconsistency. Primary approved
a narrow docs/protocol.md correction: its stale exact-three-field overview now
preserves the legacy nativeFailure shape while allowing the optional bounded
httpClientError only for runtime/native_http_invalid, linking this contract and
retaining private minting, no raw data and no execution authority. No source,
test or gate changed. The docs-only correction passed git diff --check and
npm run validate on exact Node22.16.0. Primary owns the correction commit and
both reviewers' final-head rechecks; earlier CODE gate evidence remains intact.
