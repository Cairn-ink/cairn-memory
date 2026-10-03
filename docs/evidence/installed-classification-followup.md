# M1e installed classification follow-up: one-shot result

The 2026-09-30 one-shot run completed ingestion, answers and automatic judgments
for both arms on both newly authored synthetic cases. Fixed N=2 per arm and
common-resolved N=2: Cairn had 2 correct, 0 incorrect and 0 unresolved; Mem0 had
1 correct, 1 incorrect and 0 unresolved. This passes this finite packet's
completion and paired-scoreability checks. Source-based agent assessment still
finds finer omissions, so semantic coverage remains open.

Each history contained 16 sessions of 32 user turns (512 turns), prepared as
32 indexed-evidence batches with four separately frozen required source
windows. The workshop `multi-session` case ran Cairn then Mem0; the Traditional
Chinese logistics `knowledge-update` case ran Mem0 then Cairn. Installed Cairn
core/OpenAI adapter and contained native Mem0 2.2.0 used the frozen
indexed-evidence comparison protocol, without qualification or a retry.
Its recall used explicit bounded-keyset candidates and source-evidence /
bounded-source-scan recall; this does not validate default MOC navigation.
The coordinator wrote durable generation before loading evaluator rows.
The automatic scorer used its reference-answer prompt; agents separately read
the frozen source windows and rubric. No additional judge or rescore was run.

The public fixture was `d14951d31e3f83533d8876475b6f8950e2ebe9ea`.
Shipped installed core/adapter bytes remained those at `506eed015b70135323b373f7ec8c4cec6dc007f6`;
the `4ded0564963a680d3b2d2b7fab8c82931ac38d28` evaluator/runtime added only safe
`moc_title_conflict` diagnostic projection. No engine fix occurred.
The primary reports two independent prelaunch reviews with zero findings and
all 21 exact-head checks passed (CI `36624638158`, CodeQL `36624633600`).
Frozen hashes, installed identity and result-document verification are recorded
in the [result contract](../plans/installed-classification-results.md);
the [prospective plan](../plans/installed-classification-followup.md)
retains the rejected, unstarted schema and its correction.

## Automatic grades and source assessment

| Case and arm | Ingestion and answer | Automatic judgment |
| --- | --- | --- |
| Workshop, Cairn | Completed; 32 batches | Correct |
| Workshop, Mem0 | Completed native ingestion and answer | Incorrect |
| Logistics, Cairn | Completed; 32 batches | Correct |
| Logistics, Mem0 | Completed native ingestion and answer | Correct |

All four judges were attempted and resolved. Neither arm has a failed, blocked
or unresolved case in this packet. These unchanged question-level grades do
not establish that every finer frozen rubric requirement was met.

The documentation worker directly read all four retained answers against the
public frozen source and rubric:

- Workshop Cairn preserves the earlier east-wall rack, current adopted bay C
  and the replacement rationale of avoiding the HVAC drip while retaining
  cart clearance. It does not explicitly attribute clearance to the original
  adoption or tie the current claim to the later reaffirmation.
- Workshop Mem0 identifies the earlier and current racks and the original
  clearance reason, but omits the recorded reason for the change. Its automatic
  judgment is incorrect.
- Logistics Cairn preserves dock four as previously adopted, the historical
  backup-power rationale, reconfirmation and absence of an approved replacement.
  It says power changed without explicitly stating removal, and does not name
  dock six as an unadopted proposal.
- Logistics Mem0 likewise preserves prior adoption, its backup-power rationale,
  reconfirmation and no approved replacement, but does not explicitly state
  removal or the unadopted dock-six proposal.

These are agent assessments, not human adjudication or an externally independent
semantic judge. The finer omissions do not require declaring the whole Cairn
answers wrong; they do prevent treating automatic 2/2 as strict full-rubric
success. Automatic grades remain separate and unchanged.

## Retained execution and context

No classification failure was observed in this run: both Cairn cases completed
all 32 batches, with zero partial or not-run batches. This does not establish
that the prior M1c classification failure or historical timeout was repaired;
their causes remain unproven and the engine bytes were unchanged.

| Cairn case | Admission-memory references | Unique active memories | Source receipts | Unfiled memories | Selected receipts / packed units |
| --- | ---: | ---: | ---: | ---: | ---: |
| Workshop | 157 | 157 | 252 | 1 | 3 / 3 |
| Logistics | 141 | 141 | 411 | 0 | 1 / 1 |

The references and recall/packing counts are retained generation observations;
unique-store, receipt and unfiled counts come from the primary's read-only
store inspection. An admission reference is not in general a unique memory,
and filing does not prove an initial classification attempt's outcome.
The primary separately counted 32 admission claims and 32 initial-classification
journal entries with status `applied` in each case, with no other status rows.
One workshop memory remained unfiled despite all initial-classification journals
being applied; this current filing state is not a failed initial-attempt record.

The primary matched canonical coordinates, event identity and full normalized
excerpts against all four required windows per case: all eight were stored as
exact receipts. Workshop recall selected the prior adoption, adopted replacement
and reaffirmation windows, leaving the standalone HVAC-change window
unselected. The selected replacement receipt itself contains the HVAC rationale,
so that omission does not establish missing change-reason information.

Logistics recall selected only the final reconfirmation/no-replacement window.
The earlier adoption/reason, explicit power-removal and unadopted-proposal
windows were stored but not selected. Across both cases four of eight exact
required windows were selected; this is an exact-window count, not a 50%
semantic-coverage score. Both Cairn contexts had zero omitted selected indices.
The observed logistics loss precedes answer packing; whether candidate
visibility, selection or ranking caused it remains unknown.
These exact-retention findings are primary store checks, not the documentation
worker's independent database audit.

Each Cairn observer recorded 469 phase events, retained the last 64 and omitted
405; all retained event outcomes were completed. The bounded tail does not
reconstruct all invocations or end-to-end work. Transport spans include guard
accounting and validation as well as HTTP, not isolated provider latency.
Workshop and logistics Mem0 recorded respectively 532 and 512 verified native
ADD records, with six results and six packed units each and zero omitted
selected indices. The primary's counter inspection identifies these as `ADD`
records returned by `memory.add(infer=True)` whose ID/content matched
`memory.get` at that moment. They are neither source-turn/batch counts nor
final distinct facts; 532 can exceed the workshop's 512 source turns.

## Accounting and resources

The primary's read-only audit authenticated the parent and preserved the
original 24,227-request / 151,787,556-microUSD prefix. It mapped all 470 new
rows one-to-one to guarded attempt, channel, reservation, outcome and cost
records, with zero pending. New reservation was 2,630,914 microUSD; cumulative
requests were 24,697 and reservation 154,418,470 microUSD, leaving 45,581,530
under the unchanged 200,000,000-microUSD cap. The increment is below 4,000,000
and the remainder exceeds the protected 30,000,000.

| Stage | Requests | Reserved microUSD | Known estimate microUSD | Unknown actual costs |
| --- | ---: | ---: | ---: | ---: |
| Cairn token count | 134 | 670,000 | 0 | 134 |
| Cairn generation | 134 | 670,000 | 138,856 | 0 |
| Mem0 embedding | 130 | 2,322 | 2,322 | 0 |
| Mem0 chat | 64 | 1,043,712 | 351,674 | 0 |
| Answer | 4 | 203,280 | 960 | 0 |
| Judge | 4 | 41,600 | 2,860 | 0 |

Known estimates total 496,672 microUSD and exclude 134 unknown actual costs.
Reservation is a conservative ceiling, not an invoice; the estimates are not
total spend. Including answers but excluding judges, workshop Cairn was
135 requests / 720,820 reserved / 64,785 known / 67 unknown; workshop Mem0 was
98 / 573,670 / 171,880 / 0; logistics Mem0 was 98 / 574,004 / 182,714 / 0;
logistics Cairn was 135 / 720,820 / 74,433 / 67. These reconcile to 466 requests
plus four judges. This is the primary's audit, not independent accounting review;
the documentation worker did not read the ledger, stores or accounting file.

The original prefix history digest is
`a94be7c73fbf435bcd38bac727ca67bab5e81a48802a24f85414d394b9d18d92`;
the current history digest is
`3f7eb50023b1c59499855f30133b0df0e9abcfa295fdf868f4e807dec177ed39`.
No ledger writes, settlements or grants were made by this reporting work.

Primary-measured end-to-end time was 1,632,350.745576 ms; retained operator time
was 1,629,841.738216 ms. Parent maximum RSS was 827,808 KiB and CPU was
707,030,237 microseconds user / 50,211,258 microseconds system. These include
harness and ledger work, omit a full process-tree measurement and are not
product-only or per-arm resource figures. Installation weight was not
revalidated. No lightweight-fit claim follows.

## Gate and next diagnostic

Retain this finite completion and paired-scoreability pass alongside its
source omissions. Semantic coverage, default-route behavior and ordinary
installed MCP/Hermes acceptance remain open. The earlier timeout and
classification failure remain retained with unproven causes.

The next scoped work is an offline MOC/application-boundary matrix and
isolation of candidate visibility, selection and ranking on new synthetic
cases before an engine or prompt change. No immediate
fixed-30 expansion, consumed-case replay/rescore or retuning, repaired answers
or raw-retention increase follows. Two authored cases do not establish an
official benchmark score, ranking, superiority or reliable memory behavior.
This is not an npm release or an installed MCP/Hermes result.
