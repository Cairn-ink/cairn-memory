# Bounded qualification partitions

Status: implementation acceptance, before paid execution. Fixed base:
`32eaf8e9c3da78ba523fc8f5725ecbb2e2ee1d99`.

The official six-type pilot retained four qualification context-budget stops
and two slot-mapping stops. A separate synthetic maximum-distinct-source case
demonstrates that a legal five-item qualification batch may exceed the full
serialized request bound while each individual item fits. This is not a
reconstruction of the unretained pilot requests. This change targets capacity,
not semantic fidelity or the separate slot-mapping failure.

## B1 — Preserve the already-fitting path

Keep the existing whole-batch inline-then-catalog selection, prompt, provider
wire, model, output validation and single qualification invocation whenever
that batch fits. Custom models without the explicit fit capability retain
their current whole-batch contract. Do not reinterpret a provider rejection as
permission to try another representation or split after dispatch.

## B2 — Plan all partitions before dispatch

Only when both existing whole-batch representations do not fit, preflight a
deterministic, original-order singleton partition of all extracted items, at
most five groups. For every group use the same inline-then-catalog fit rules
and the actual adapter serializer. Finish the entire plan before the first
qualification HTTP call. If any single item cannot fit, reject without any
qualification HTTP call. No source text, receipt, item, field, or required
evidence may be shortened, omitted or invented to make a group fit.

Each group has its own detached immutable candidate snapshot. Request-local
indices may be rebased only through that snapshot; compile each result against
its own exact sources and concatenate in original item order. Neither a caller,
counter nor model callback may redirect sources across groups.

## B3 — Atomicity and failures

Keep the original capture deadline across planning, counts, generation and
compilation. Stop at the first failed group with the existing error semantics;
do not retry, skip it, execute later groups, or return partial qualifications.
Verify through real capture and a reopened synthetic store that a later-group
failure cannot admit earlier-group memories. Preserve unrelated prior memories
and the documented staging boundary. This change does not certify that cited
text entails an interpreted field.

Revalidate staged-source ownership immediately before each group dispatch,
including the first after planning. If evidence was explicitly discarded or
forgotten during an earlier in-flight group, do not send it to any later model
invocation; retain the existing closed-evidence error. The already-started
invocation cannot be recalled. The capture layer may supply one trusted,
scoped freshness callback for this purpose; do not accept a model-supplied
callback or broaden public configuration. Test discard from a separate store
handle, zero later invocations and zero new admitted memories after reopen.

The invocation microtask must recheck that same trusted freshness callback:
a discard queued by token counting may execute after a synchronous check but
before the model callback. A bounded `core/model-call.mjs` change is authorized
to close this demonstrated gap. Preserve trusted freshness failures with
internal provenance, while model-thrown lookalike authority errors remain
sanitized; retain existing timeout precedence and original deadline. This is
an immediate pre-invocation check, not a claim of cross-process linearizability
or an ability to retract already-dispatched provider requests.

## B4 — Unchanged per-request bounds

Every dispatched request retains the 6,000-token local/full-count-body bound,
7,024-token provider-count bound and 1,024-token output budget, with one count
and one generation per qualified group. Keep custom-model limits and all
source/citation validation. No provider call is needed for local planning;
runtime provider counting still has final authority to reject a request.

## B5 — Honest resource and protocol description

Update the pure mixed-resource projection to reserve at most five qualification
count/generation pairs per capture batch, not one. Preserve extraction,
classification, recall, Mem0, answer and scorer costs. Give the changed resource
projection an explicit new version and bind the new qualification scheduling
policy into the mixed context descriptor/digest; do not relabel old frozen
results. Keep external manifest shape and unchanged adapter wire/settings where
possible. Review every affected projection, grant/cap fixture and native fake-
HTTP integration. Do not loosen per-request guard checks or reuse a paid grant.

## B6 — Falsifiers and regressions

Retain a pre-fix synthetic failure for a five-item legal, distinct-source batch
whose singleton requests fit. After the change, verify all five exact items and
source bindings complete through real core and fake HTTP, with bounded call
counts and no retries. Also cover: already-fitting inline and catalog batches;
custom models without fit support; an unfit singleton causing zero dispatch;
failure after an earlier successful group; cancellation during planning and
between calls; callback mutation; wrong/cross-group citations; a provider count
above its ceiling; unchanged invalid slot rejection. Test assertions must show
the real request bodies and persistence boundary, not only planner internals.

## B7 — Delivery gates and non-goals

Run applicable contributor checks on Node 22.16 and 24.15: focused regressions,
generic tests and validation, core and capture/MOC/recall demos, OpenAI adapter,
installed artifact and rationale gates, LongMemEval and mixed-resource tests,
mixed native fake-HTTP integration and affected request-guard gates. The primary
must inspect the actual combined diff and independently rerun key paths, then
obtain independent Standards and Spec review of the same final candidate.

No key, original corpus, evaluator or operational ledger is needed for this
implementation. No paid run, replay, merge, publication or deployment is part
of this packet. Passing offline gates does not establish improved LongMemEval
accuracy, repair of slot mapping, or product reliability. The partition path is
conditional on an explicitly fit-capable adapter/model; ordinary installed
MCP/Hermes entrypoints do not automatically enable it.

## Implementation and verification record

Implementation owner: GPT-6 Sol/high in the isolated
`fix/bounded-qualification-partitions` worktree, fixed base
`32eaf8e9c3da78ba523fc8f5725ecbb2e2ee1d99`. The originating B2 RED is
retained in the worker tool transcript (no raw file log was created):
`node --test core/test/qualification-text-catalog.test.mjs` on the fixed-base
runtime with the new five-distinct-item test gave 11 pass / 1 fail,
`context_budget_exceeded` at `qualification-candidates.mjs:197`. A separate
real-core staged-source RED observed a second singleton model call after a
different store handle discarded evidence during the first; the later
counter-microtask RED also observed one stale model call. These are synthetic
controls, not reconstructions of unretained pilot payloads.

After the scoped correction, the real adapter/fake-HTTP test observes all five
singleton fit decisions before the first transport call, then five count and
five generation calls with unchanged candidate/source binding. Real core
capture admits five distinct synthetic items; separate late-failure and
staged-discard tests cold-read zero new admissions. The trusted freshness check
is repeated at the invocation microtask; a model-forged authority error is
still sanitized and a deadline expiry still takes precedence. Resource v3
reserves five qualifier pairs per batch and the hashed mixed-context v2 names
the policy, while the external adaptive wire profile remains unchanged.

Raw offline gate logs are retained under
`/tmp/cairn-bounded-partitions.xXWbG5/`; the primary keeps its independent
Node 24 evidence under `/tmp/cairn-partition-primary.Opt941/`. On the final
runtime, both Node 22.16 and 24.15 passed full core (741 each), OpenAI (239
each), artifact (84 each), mixed native/fake-HTTP (22 each), LongMemEval (185
each), request guard (289 each), generic (112 each), and validation. Relevant
core, LongMemEval, OpenAI, and request-guard demos also passed. Installed
rationale tests passed 4/4 on both versions; the primary additionally passed
Node 24 MCP tests 91/91 and strict plugin/marketplace validation on both
versions. A Node 24 core run exposed a test-only mutation-splice target that
no longer matched after `validateFresh` was added; the helper was corrected
without a runtime change, its standalone mutant check passed, and the final
741-test core run passed. Final candidate SHA and independent review results are
recorded at delivery, not inferred from earlier runs.

The full-core commands were `node --test --test-concurrency=1
core/test/*.test.mjs` (Node 22) and `node --test --test-concurrency=2
core/test/*.test.mjs` (pinned Node 24). Adapter commands were `npm test
--prefix adapters/openai` and, from `adapters/openai`, pinned Node 24
`node --test --test-concurrency=1 test/*.test.mjs`. Other scoped suite commands
were `node --test packaging/test/*.test.mjs`, `npm run test:longmemeval`,
`npm run test:experiment-request-guard`, `npm test`, and `npm run validate`;
the mixed-native command was `node --test
evaluation/longmemeval/testing/mixed-native.test.mjs` with the pinned local
Mem0 virtual environment and Python root. The same applicable commands used
the pinned Node 24 binary for the second-version checks. The raw logs retain
terminal counts and the successful demo outputs; the test-only splice failure
is retained separately in the primary's earlier core log.
