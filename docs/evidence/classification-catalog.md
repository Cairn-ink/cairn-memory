# Classification catalog: one real-model input-path probe

The catalog fix removes unrelated memory rows from classification input. In one
frozen synthetic probe, the candidate created and persisted a first category at
both 1 and 101 memories. The baseline created one at size 1, but returned a valid
noop at size 101. This is mechanism evidence, not a general quality benchmark.

The [pre-call contract](../plans/classification-catalog-live.md) fixed the source,
four-arm order, limits and no-retry rule. The [retained evidence](../../evaluations/results/classification-catalog-v1.json)
includes all four observations, model inputs/outputs, HTTP responses, cold reads,
source artifact hashes and budget totals. No private operational paths or keys
are exported. Runtime commits are baseline `5dbf73c` and candidate `0ffec59`;
the unchanged model is `gpt-4.1-mini-2025-04-14` on Node 22.16.0.

All arms select the same explicit synthetic instruction: "For the fictional
Seabrook project, use a diagram to explain the release handoff." Other records
are unrelated numbered inventory notes; no topic exists initially. Explicit
admission isolates classification from extraction and reconciliation.

| Fixed execution order | Model catalog | Outcome after cold reopen |
| --- | --- | --- |
| Baseline, 1 memory | 1 unfiled entry; complete | Filed: Project Seabrook Release Processes |
| Candidate, 1 memory | Empty; complete | Filed: Seabrook project release management |
| Candidate, 101 memories | Empty; complete | Filed: Seabrook project release process |
| Baseline, 101 memories | 77 unfiled entries; incomplete | No new category; still unfiled |

The large baseline exposes 76 unrelated inventory bodies. Its actual token
packing admits fewer than the 100-row ceiling; the candidate exposes none.
The baseline noop is an observed response, not a successful category creation
or an invalid-model failure. It was not retried or replaced.

An independent agent inspected the source, model traces and applied/cold reads.
It judged all three generated titles reasonable groupings of the source
instruction, not new user instructions. Each created title is source-bound to
the selected memory at revision 2; original receipts survive and post-apply
snapshots match cold reads. This is independent agent judgment, not a blinded
human study or a paid model score.

## Budget and verification

Exactly 8 HTTP requests completed: four count/generation pairs. The new USD50
phase ledger reserves USD0.040000, with USD0.003102 known generation usage and
four count requests with unknown cost. No reservation is refunded; known usage
is not the total bill. No requests remain unsettled. Earlier campaign evidence
and its ledger are untouched. No merge, release or deployment was performed.

Before calls, both independent review axes passed on `0ffec59`; the private
operator passed a separate safety review and zero-I/O preflight. Node 22.16 and
24.15 each passed: 294 core tests, 31 plugin tests, 152 OpenAI offline tests,
25 MCP tests, JSON/plugin validation, and store/MOC/OpenAI offline demos.
One legacy assertion was deliberately updated: classification no longer copies
the public mixed map, while public map labels remain unchanged.

This probe covers one instruction with one observation per arm and size. It does
not test broad existing topic catalogs, bilingual classification, temporal
updates, decision provenance, retrieval routing, real users or installed-client
quality. Those remain separate gates. No classification prompt, model profile,
public map API, schema or recall policy changed in this fix.
