# HR-3 frozen generator v1

Authority: `../protocol/protocol-v0.3.4.md`, especially §§2, 3, 5–7, 9, 10 and 13.
Plain Node 22.16+ ESM; built-ins only. No credentials, network, APIs or models.

```sh
node evaluation/hr3/generator/cli.mjs --split pilot --out evaluation/hr3/generator/my-pilot
node --test --experimental-test-isolation=none evaluation/hr3/generator/test/generator.test.mjs
```

The destination must be empty. `--seed` changes independently sampled world
ASTs; the default is `hr3-worlds-v1`. Allocation stays frozen independently of
the world seed. `engineering`, `development` and `test` are supported split
names. **Only engineering and pilot worlds have been rendered for delivery.**
Rendering a held-out split later is an explicit separate command, subject to
the protocol's continuation gate; implementing the command does not pass it.

## Deliverables and boundaries

Each run writes eight files:

| File | Contents |
| --- | --- |
| `families.jsonl` | One synthetic family per row: four source batches, two probes, public headers, controls and private authoring AST |
| `gold.jsonl` | One row per family; each checkpoint has quotation-free `G_correct`, expected claims/statuses and accepted causal topology |
| `support.jsonl` | Private source spans, assertion provenance and supported accepted graphs; never part of a correctness bundle |
| `lineage-inventory.json` | All 310 lineage specifications, ancestry, unique lexical banks, language/control assignments and world multiplicities |
| `grammar-and-sentence-bank.json` | Abstract productions, all sentence templates, finite dictionaries and local byte guards |
| `rejected-candidates.jsonl` | Every failed candidate's ID, seed, error code/message, attempt and candidate hash; empty means zero rejects |
| `validation-audit.jsonl` | Structural, independent AST/gold and source-support checks; non-author audit stays pending |
| `manifest.json` | SHA-256/bytes/row counts, source/protocol hashes, allocation/counts and explicit pending gates |

`artifacts/engineering/` contains the 30 offline engineering worlds, excluded
from accuracy estimates. `artifacts/pilot/` contains exactly 60 pilot families
and their gold. Pilot allocation is 12/type; 33 Traditional Chinese, 18 English,
9 mixed; 2/type/causal class; 40 multi-hop worlds; 40 Card families and 20 safety
families. There are 30 lineages with two worlds each. No development/test
conversation or gold files are included.

The inventory fixes the later development allocation at 50×4=200 and the test
allocation at 200×8=1,600, with the exact §9 language/type/causal/control counts.
There are 20/30/100 multi-hop lineages in pilot/development/test. Inventory
validation checks all 310 specifications without rendering held-out worlds.

## Fixture contract

`extractionInput(family, batchOrdinal)` returns only the observed time, public
header and source turns for model extraction. The AST, control expectations, split/causal labels and gold are
private authoring data. `header`, checkpoint questions and literal §10 queries
are public; they contain subject/predicate/scope, never expected values. The
query for mixed language is the English and Chinese query joined by a newline.
Each checkpoint specifies its focal turn and exact requested predecessor turns.

Each authoring event has every §2 field. `claims` in this AST is an array of
typed `{field,value}` assignments, because an extracted event's `claims` format
is not prescribed in §2 and a partial patch must not invent inherited values.
`field_mask` names exactly those fields. This is a fixture AST, not a substitute
for the research extractor/link schema owned by the harness. Source record
names A/B/C/D are natural conversation referents; anchors use earlier source
turns and names, never gold event IDs.

Correction targets one route assertion with an explicitly restated approval
qualification; its erroneous predecessors are never labeled formerly adopted.
Reversal explicitly withdraws the whole predecessor. Refinement changes only
the cap, inheriting route and approval. Scope change first affects TW, then
TW+JP, requesting both amended predecessors at the final probe while preserving
US. Expiry has no successor and never falls back; batch three explicitly adopts
a new independently expiring assertion. Half the reversal worlds use
future-effective updates; half the correction worlds are retroactive. Fixed
UTC timestamps express Asia/Taipei boundaries. Dates are synthetic in 2031.

All six causal classes are grammar productions. Accepted graphs are an OR of
graphs; edges within a graph are an AND; an edge's support is an OR of arrays
whose spans are an AND. Both branches of alternative mediation are explicitly
independently sufficient. Conjunctive mediation explicitly requires both
conditions, and every required edge is retained. There are no implicit serial
shortcuts. Unstated reasons have no nodes, edges or accepted graphs.

Spans identify source turn, half-open UTF-16 offsets, offset unit and exact
quotation. These are **source offsets**, not delivered citation offsets.
`support.jsonl` is for scorer/authoring audit only. Delivery mapping,
normalization/truncation maps and support judgments must use actual delivered
units. No raw offset may be reused as a delivered offset. `G_correct` never
contains supporting quotations, spans, source IDs or delivery labels.
Its empty `citations` arrays reserve the closed Claim shape; its separate
`acceptedGraphs` records allowed reason edges rather than a fabricated answer.

`answer.schema.json` is a closed JSON Schema with all required fields and
explicit `type` discriminants for the five Value variants. `validate.mjs`
enforces its executable shape plus status, scope, temporal and graph invariants.
`canonicalize.mjs` freezes NFKC/whitespace rules, rational arithmetic,
finite units, exact scope equivalence and duplicate/set normalization. Unknown
unit equivalences are referred, never guessed. Contradictory extras remain
distinct. Gold subjects/predicates/reasons use the bank's canonical English
semantic identifiers; Chinese/mixed source aliases are published in the bank.

## Controls

Card scripts contain the complete §5 lifecycle, symbolic returned references
`$M/$V1/$V2/$c/$d/$b/$s` and fresh reviewed dependencies, plus all eight branches.
The public runner resolves these symbols from real call results and inspected
revisions; they are not product IDs or a hidden archive. V2 imports use
`expectedPackageRevision`; import and adoption are separate operations. Every
mutation has a unique action ID and explicit fixture authority. Unauthorized
MCP actions expect `approval_required` without mutation. Invoice assertions are
separate from focal dispatch assertions. Eligibility, delivery and reader use
must be scored independently; history eligibility never authorizes current use.

Each safety family bundles a named record, an independent copy, a foreign-only
record, named forget, and exact-content replay. Only the named record is
forgotten; the independent copy remains independently auditable. Foreign
namespaces are excluded from the authorized read set. No focal answer is copied
into these controls. These scripts are fixtures; no product mutations are run.

## Validation and freezing

The gold builder and validator's cell interpreter are separate implementations.
The latter replays observed/adopted events over all 12 cells, applies pending
activation, field inheritance and no-fallback expiry, then compares exact
current/history gold. Other checks cover references, source-order anchors,
historical/incompatible targets, intervals, nonempty scopes, causal direction,
edge support, distractor entailment, language, bytes and private-label leakage.
Negative tests corrupt timelines, anchors, scopes, history labels, current
values, source spans, support and graph topology. Rejection logging records the
original candidate once; it never silently substitutes a new world.

Hashes are over canonical UTF-8 JSON (sorted object keys, deterministic array
order, one final newline). Source and protocol hashes freeze implementation
bytes. Manifests are checked by hashing bytes read back from disk and by an
independent directory enumeration. `freeze.json` records the final delivery
inventory and hashes; it does not authorize paid work.

## Interpretation choices and unresolved audit items

1. **Lexical ancestry granularity.** §9 does not define ancestry for a shared
   abstract grammar. This implementation shares syntax, mandated causal
   topology and function words, while assigning independent semantic bank
   roots, disjoint subjects/routes/reason aliases and no derivative/translation
   parent across splits. Within a lineage, members share a bank but sample
   numeric values and dates independently. This is a declared authoring choice
   for non-author review, not evidence of generalization to unseen grammars.
2. **Control totals.** §9 does not specify whether its named-forget/replay/foreign
   total counts actions or families. Here 20/20/160 means distinct safety
   families, each with all three controls. Card totals also count families;
   overlap is allowed. The eight Card branches cycle deterministically. No
   branch/language cross-balance beyond the protocol's global totals is implied.
3. **Byte limits.** No fixture-source byte ceiling is given. Local source guards
   are 12,288 bytes/batch and 32,000 bytes/family. The former leaves 4,096 bytes
   under the §14 extraction reservation ceiling before provider framing. These
   are implementation guards only; actual framed-body reservation and tokenizer
   certification belong to the harness and remain required.
4. **Value tagging and gold representation.** The protocol's algebraic Value
   notation does not prescribe JSON tags; `type` is frozen here. `G_correct`
   retains the Claim shape with empty citations and adds accepted graph
   structure. The separate support file is never projected into correctness.
5. **Expiry — revised E-1 (2026-10-25).** R retains the frozen question:
   why the change occurred. Every expiry source states that the explicit
   deadline was reached and the decision expired. A complete supported
   `deadline → decision` trigger graph is accepted alongside the existing
   rationale graphs. A deadline mention without a causal edge earns no credit.
   `not_stated` is retained only for changes with no supported cause; the expiry
   sources no longer append the contradictory “no reason” sentence. The frozen
   causal-class allocation still describes the authored rationale topology;
   expiry's trigger is an additional accepted alternative, including in the
   `unstated` rationale class. Questions and non-expiry gold are unchanged.

   All **36 affected rendered checkpoints** (12 engineering, 24 pilot) are
   disclosed below. The previously reported six are the two checkpoints of
   the three L02 families, marked Yes. Held-out worlds remain unrendered.

   | Family ID | Checkpoint batches | Previously reported six |
   | --- | --- | --- |
   | `engineering-expiry-L01-W1` | 2, 4 | No |
   | `engineering-expiry-L02-W1` | 2, 4 | Yes |
   | `engineering-expiry-L03-W1` | 2, 4 | No |
   | `engineering-expiry-L04-W1` | 2, 4 | No |
   | `engineering-expiry-L05-W1` | 2, 4 | No |
   | `engineering-expiry-L06-W1` | 2, 4 | No |
   | `pilot-expiry-L01-W1` | 2, 4 | No |
   | `pilot-expiry-L01-W2` | 2, 4 | No |
   | `pilot-expiry-L02-W1` | 2, 4 | Yes |
   | `pilot-expiry-L02-W2` | 2, 4 | Yes |
   | `pilot-expiry-L03-W1` | 2, 4 | No |
   | `pilot-expiry-L03-W2` | 2, 4 | No |
   | `pilot-expiry-L04-W1` | 2, 4 | No |
   | `pilot-expiry-L04-W2` | 2, 4 | No |
   | `pilot-expiry-L05-W1` | 2, 4 | No |
   | `pilot-expiry-L05-W2` | 2, 4 | No |
   | `pilot-expiry-L06-W1` | 2, 4 | No |
   | `pilot-expiry-L06-W2` | 2, 4 | No |
6. **Card confirmation/declaration — unresolved.** The literal §5 table confirms
   with `currentDependencies`, then declares separately with a null dependency
   expectation. In pinned product `core/private-card-storage.mjs:211`, that
   confirmation already writes dependency revision 1; the declaration's null
   expectation therefore fails the revision check in
   `core/card-current-storage.mjs:65`. “Declare separately” may mean an alternative
   confirmation path or another Card, but neither interpretation is explicit.
   Scripts preserve the literal sequence and are labeled
   `blocked_protocol_clarification`; they are not certified executable controls.
   The question is reported instead of silently changing the frozen protocol.
7. **Audit and §13 gates.** Mechanical source/AST/gold checks are not non-author
   semantic review. The complete required 690 rendered-world audits cannot yet
   exist while development/test stay unrendered: 30 engineering + 60 pilot +
   200 later development + 400 selected test worlds. All 310 specifications are
   published now. Required non-author review, reference serialization and
   real-tokenizer verification of every maximal structure at 768 tokens,
   calibration, resource/accounting checks, inspection declarations and pilot
   continuation remain pending. No claim of a cap fit or paid-stage readiness
   is made. No accuracy or inference results are produced here.

No paid calls, broad product suites, repository manifest edits or commits are
part of this directory's work. Only the generator's own test file is run, as
required by TRAPS item 11.
