# Offline source-event grouping result

This evaluation-only experiment asks whether repeated original source evidence
can be transmitted once while retaining every cited memory/revision/receipt
association. It does not change core recall, the SDK, MCP, answer consumers or
the production six-memory projection contract.

| Synthetic input | Distinct memory units | Exact source-event groups | Associations | Packet size |
| --- | ---: | ---: | ---: | ---: |
| Fresh local-core admissions | 7 | 6 | 7 | 2,724 UTF-8 bytes |
| Normalized replay of the [public diagnostic inventory](decision-transition-results.md) | 7 | 6 | 7 | 3,182 UTF-8 bytes |

The fresh store admits two genuinely different interpretations of one submitted
event as separate memories. The packet retains both memory IDs, their revisions
and currentness, and their distinct receipt IDs under one source passage.
Another pair of events has identical text but different event IDs and remains
separate. All seven original associations round-trip exactly; packet assembly
leaves the store and input snapshot unchanged. The normalized replay uses
synthetic fixture receipt IDs and revision/currentness placeholders, not a
new read of the live experiment or a generated answer. The original projected
diagnostic answer remains unavailable.

Grouping requires exact namespace, client, session, event, role and retained
excerpt. It performs no extra text normalization. Reused submitted event
metadata with divergent excerpts produces separate groups, both visibly
flagged as a provenance collision. Submitted provenance does not authenticate
a speaker or establish the truth of the source. No card is merged, revised or
chosen as a representative, and no relationship interpretation is sent.

This experiment rejects more than six groups, more than 36 associations or
more than 24,000 serialized UTF-8 bytes, with no truncation or fallback.
Tests exercise each overflow and the byte boundary. These evaluation-only
limits are deliberately *not* equivalent to the shipped six-memory and
24,000-UTF-16-character source projection. The small packet sizes demonstrate
structural payload availability for these synthetic inventories, not relevance,
answer quality, semantic reliability or a production freshness guarantee.

The smallest supported next design step is to specify and independently review
a versioned source-event DTO with explicit association and collision semantics.
Production use would separately need an authoritative final-read/freshness
fence, compatible consumers and installed MCP tests. No such integration or
provider call occurred here.
