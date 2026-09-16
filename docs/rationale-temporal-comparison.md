# Prepared fresh paired chronology comparison

This packet prepares, but does not run, one guarded comparison of the
[frozen six-case fixture](../evaluation/architecture/rationale-temporal-fixture.json)
against its separately frozen [source rubric](rationale-temporal-rubric.md).
The baseline and candidate use the same installed public core, OpenAI adapter,
model pin, source bytes/order, output schema and limits. Only candidate `relate`
instructions gain the [fixed chronology guidance](../evaluation/architecture/prompts/rationale-temporal-guidance.md).
The evaluation facade is injected into the embedded core; this is not an
installed-CLI or automatic-capture test.

Each case has two independent fresh synthetic SQLite databases. Arm order
alternates. Each arm manually admits the same sources, then requests one
explicit source-only `replace-reviewed` review. There is no seeded old graph:
the comparison measures relation proposals and persistence, not whether a
wrong existing proposal can be withdrawn. Complete before/after records and
default/incident graphs, raw count/generation responses, source-ID mapping,
and a keyless cold-child read are retained privately. Structural failures stay
in the denominator and are never reported as successful empty graphs.

A separate one-shot guard allows at most 24 HTTP attempts and 120,000 microUSD
of reservations, 5,000 per request, inside the existing durable campaign
ledger and a new exclusive intent. The candidate's extra local token recount
does not add an HTTP request. A full run would permit one provider count and
one generation per arm, with no retry. Reservation is not a bill. The operator
requires a separately supplied transport and key; importing it does not read
credentials or dispatch. Offline fake-HTTP rehearsals do not authorize real
requests. The original three-case correction attempt and its exhausted intent
are untouched.

Only after separate review, primary approval and a fresh ledger/pin preflight
could the once-only run proceed. Its six adapted histories are not blind
accuracy, natural capture/recall, MCP-host integration, user benefit or a basis
to change defaults. A semantic assessment must retain defensible alternative
links, temporal/scope errors, missed genuine challenges, absent distinct
supports, abstentions and failures for all twelve arms.
