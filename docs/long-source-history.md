# Longer captured source history

This diagnostic joins explicit capture, cold inspection, MOC source retrieval,
a simple lexical control and downstream answers over one longer synthetic
history. It is evaluation infrastructure, **not an observed live result**.

The [fixture](../evaluation/live/long-source-history-fixture.json) contains 32
messages across eight windows and four later questions: changed flask reasons,
different people's course decisions, a temporary commute exception, and a
telescope purchase that never happened. The
[machine scorer](../evaluation/live/long-source-history-rubric.json) and
[semantic rubric](long-source-history-rubric.md) are separate from model inputs.
Required passages measure specific reference retention; redundant evidence can
still support a useful answer when one reference is missing.

`runLongSourceHistory({openClient, complete, fixture, rubric})` creates a fresh
temporary database path and asks the injected client factory for MCP-compatible
`callTool`/`close` connections. Each capture sends only a stable batch ID and
explicit role/text pairs, then closes and reopens for source inspection. The
driver does not hand-admit sources, seed routing categories or give expected
answers to extract/select/rank. It snapshots inventory and receipts with finite
limits, retaining the source evidence and any capture/restart failures.
Snapshot pagination independently caps three inventory pages and two receipt
pages per memory, rejects repeated cursors, and caps 128 memories/100 receipts.
If capture fails after a successful window, `captureCoverage.snapshotBasis`
identifies the last completed snapshot; later partial writes remain in raw
capture/inspection records, not silently counted as a verified final snapshot.
Later capture and query slots remain not-run rather than being retried.

MOC calls `recall_memory` with `contextMode: "source-evidence"`, limit six. The
lexical arm reads the same captured active source snapshot, ranks unique query
token overlap (individual Han characters and non-Han letter/number words), and
keeps up to six positive-score memories, with snapshot order breaking ties.
It uses original receipts, not generated summaries. This deliberately simple
control is not vector RAG, an optimized search engine or an oracle baseline.

For scoring only, fixture IDs map to the public MCP capture protocol's derived
message-event hashes. The report separates capture retention, required returned
source IDs and a non-exhaustive irrelevant-source set. Original receipt text and
full returned contexts remain available for independent semantic review. No
reference-ID count is an answer-accuracy score.

Answer order alternates by query. MOC passes its actual tool result into the
[bounded answer consumer](installed-source-answer-delivery.md); lexical builds an
explicitly marked constructed control envelope with the same source DTO. A
successful partial MOC recall is scored **before** its answer is marked
`answer_not_run_partial_coverage`. Invalid source, overflow, no completion and
failed completion are separate from unsupported answers. Empty successful
evidence may appropriately yield ignorance. All query/arm slots remain visible
when prior capture or inspection failure prevents execution.

The driver has no credential discovery, global HTTP fetch, retry or new spending
authority. Caller injection is not proof of safety: the operator must supply an
installed runtime and the existing guarded transport with durable budget,
timeouts, response bounds, exact source/fixture pins and permanent halt after
transport failure. Raw reports contain synthetic source identities and are not
publication-safe by default. No change to memory/MCP defaults or package contents
is made here.

Offline tests use the real local core behind MCP-compatible scripted envelopes;
they test orchestration and loss visibility, not semantic model quality. A
separate installed-MCP rehearsal and independent operator review must pass
before a once-only real-model follow-up. Its ceiling is 128 HTTP requests and
US$1.50 conservative reservations within the existing US$50 ledger, not a new
budget. No real-provider result is claimed by this document.
