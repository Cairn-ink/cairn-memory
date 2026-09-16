# Selective rationale correction pilot preparation

This preparation was used for one completed once-only synthetic diagnostic;
see the [results and limitations](rationale-correction-results.md). The
three frozen cases and their separate scripted rubric are in
`evaluation/architecture/rationale-correction-{fixture,rubric}.json`. The
installed local CLI is intended to receive one explicit source-only
`review_rationale` call per case after each case's mistaken or genuine graph is
seeded through the installed core's public append-only API. The model will not
see the old graph or the rubric. This tests fresh inference plus replacement,
not self-correction reasoning or ordinary host tool selection.

The public `createRationaleCorrectionAttempt` is an additional closed cap over
the existing durable campaign guard: the pinned baseline model, only
`cairn_relate`, at most six HTTP attempts and 30,000 microUSD of conservative
reservation. It grants no new provider method, credential, budget or fallback.
The private operator and its transport bridge are kept outside the repository;
the child CLI uses a synthetic key and may reach only an authenticated loopback
parent. The parent guard alone would hold any separately authorized real key.
No live dispatch occurs by importing or testing this code.

Offline rehearsals use an inspected installed artifact, synthetic temporary
databases, the real method/session/ledger guard and fake provider responses.
They must retain full source records, default and incident graphs, failed review
envelopes, raw response bytes and durable reservation/accounting evidence.
Structural failure in one case is not silently converted to an empty proposal;
transport, pin, accounting or cleanup uncertainty stops later cases. Cold
keyless inspection must make no HTTP requests.

Before any paid request, the exact candidate, private operator, installed
artifact, policy/grant, fixture/rubric, exclusive intent and available campaign
headroom require primary and independent review. The earlier negative pilot
remains negative. Even if all three new cases pass, edge accuracy, current-state
binding, decision adoption and user benefit remain unproven; a larger fresh
held-out evaluation would be required before promotion.
