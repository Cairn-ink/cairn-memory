# Fresh disposition comparison fixture and rubric

Base: `082e0736121ffd43cd3bb2000d14e9341e690f80` (corrected DC control slice).
This data-only preparation follows frozen control guidance 7b19f4deb938e192dcf6b386384ecb76aeb226f6524100fe8899b74bab5174ee
and candidate V2 676b4a2181c32b6fdff0cc528f6720349afc34cd8198f759201ce7f72d674241. The V2 runtime and DP guard are
separate dependencies to integrate before any real comparison. No scored call
has used these cases. One Sol/high worker authors data/test/doc only; primary
owns the requirements and independently reviews ambiguity before freezing.

## Acceptance

- DF1: Exactly six fresh synthetic scenarios below; each has at most six
  memories, one complete user/assistant receipt per memory, excerpts at most
  800 UTF-16 units and content at most the core admission bound. Retain the
  exact meaningful scope, attribution, dates, non-adoption and uncertainty.
  Use explicit event IDs and role, no real user data. Hand-seeded old edges
  are deliberately mixed correct/incorrect proposals, not automatic capture.
- DF2: Keep model-facing fixture separate from the evaluator rubric. Fixture
  contains only source events and old five-field tuples (receipt index zero);
  no verdicts, expected actions, explanations or answers. Local event names
  must not encode gold labels. The operator later maps all model inputs to
  local indices and includes no fixture IDs or evaluator metadata.
- DF3: Rubric records each old tuple's keep/withdraw/unknown expectation,
  required genuine challenge coverage and independently supported historical
  reasons, with source-bound rationales. No hardcoded post-response repair.
  Accept defensible alternative targets only where the cited target receipt
  explicitly expresses the same contested premise. A decision-kind card may
  also contain a premise; card kind alone cannot disqualify that target.
  Report exact original-premise-node coverage separately from semantic errors.
- DF4: Unknown preserves an unresolved proposal, not accepted current truth.
  For missing antecedents, candidate unknown and control omission may both be
  appropriate abstention; compare their protocol coverage separately. Definite
  wrong directions/scopes or explicit non-adoption must not hide in unknown.
  Any valid old edge withdrawn, definite wrong edge retained, genuine current
  challenge lost, malformed response or incomplete disposition coverage blocks
  considering a write path. Harmless source-supported extra relationships are
  adjudicated from evidence, not automatically marked wrong for absent gold.
- DF5: Explicitly distinguish historical correctness, present applicability,
  and current selected decision. Later premise loss must not erase the reason
  a past choice was made or silently choose another option. The experiment
  is relation review only, not extraction, MOC recall, answer utility, host
  behavior, or a general reliability score. No claim of six independent real
  users, repeatability or statistical superiority.
- DF6: Validate schema/indices/dense arrays/roles/normalization/bounds, source
  references and tuple uniqueness; pure deterministic tests on Node20-compatible
  modules and both local Node22.16/24.15 generic/JSON/strict-plugin gates. No new
  semantic scorer, paid launcher, provider call, credential or grant. Source
  fixture and evaluator rubric hashes must be recorded once frozen. Do not
  modify prompts based on these cases or previous scored failures.
- DF7: Scope only new evaluation/architecture/rationale-disposition-fixture.json,
  docs/rationale-disposition-rubric.md, matching pure test and this plan. No
  core/adapter/guard/default or existing evidence edits. Independent fixed-diff
  review, primary acceptance, PR/CI before delivery. No merge/publication.

## Primary acceptance scenarios

The following is acceptance design, not a model-facing payload. The worker
must split source-only data and the rubric; do not copy expected labels into
provider data. Unspecified receipt roles are user. All tuples cite receipt 0.
For late-import case, spell out the original report event date versus the
September import date; an old report is not a new test. The explicit price
rejection in case five is required. Current applicability challenges do not
mean the original dated observation was false when made.

```json
[
  {
    "id": "two-reasons-printshop",
    "purpose": "preserve distinct historical reasons after one premise changes, withdraw reversed challenge",
    "sources": [
      "2026-07-01: The printshop test of press K confirmed offline job queuing. We will treat offline availability as an operational premise when selecting this press, until that capability changes.",
      "2026-07-02: Our supplier confirmed a six-year parts contract for press K.",
      "2026-07-03: We selected press K because offline job queuing and the six-year parts contract both meet our requirements.",
      "2026-07-10: Firmware 8 disabled offline job queuing on our same press K, so offline availability is no longer an applicable operational premise. This does not deny what worked on July 1. The six-year parts contract is unchanged."
    ],
    "oldEdges": [
      {
        "from": 0,
        "to": 2,
        "relation": "supports-decision",
        "expected": "keep"
      },
      {
        "from": 1,
        "to": 2,
        "relation": "supports-decision",
        "expected": "keep"
      },
      {
        "from": 0,
        "to": 3,
        "relation": "challenges-premise",
        "expected": "withdraw"
      }
    ],
    "requiredNew": [
      {
        "from": 3,
        "to": 0,
        "relation": "challenges-premise"
      }
    ],
    "notes": "Do not automatically change selected press. Additional supported self/reaffirmation edges evaluated separately; unknown cannot hide definite reversed chronology."
  },
  {
    "id": "late-import-logger",
    "purpose": "event time vs arrival; historical premise changed not historicalreason invalid",
    "sources": [
      "Report dated June 4: our logger N currently runs firmware 1 and cannot export CSV. This is the operational constraint for our export workflow until the same device gains CSV export.",
      "Meeting dated June 6: we chose manual export because logger N lacks CSV export.",
      "Release test dated August 2: our same logger N was updated to firmware 2 and now exports CSV. This removes the operational constraint from June 4; it does not deny that firmware 1 lacked CSV at the time.",
      "Import note dated September 1: today we re-imported the original report dated June 4 about our then-installed firmware 1. September 1 is the import date, not a new test date."
    ],
    "oldEdges": [
      {
        "from": 0,
        "to": 1,
        "relation": "supports-decision",
        "expected": "keep"
      },
      {
        "from": 0,
        "to": 2,
        "relation": "challenges-premise",
        "expected": "withdraw"
      }
    ],
    "requiredNew": [
      {
        "from": 2,
        "to": 0,
        "relation": "challenges-premise"
      }
    ],
    "notes": "Scope chronological firmwarechange explicit; lateimportnote is not contrary test. Reaffirmation note->oldhistory may be legitimate source attribution not currentregression; judge source text."
  },
  {
    "id": "different-department-plan",
    "purpose": "scope mismatch vs genuine current challenge coexist",
    "sources": [
      "Design department, annual plan R: supplier contract includes unlimited image exports.",
      "Design department: we selected annual plan R because unlimited image exports are necessary.",
      "Finance department, monthly plan R: image exports are limited to 20. This statement is only about our monthly plan.",
      "Design department update: the supplier corrected our annual plan contract; it allows 100 image exports, not unlimited."
    ],
    "oldEdges": [
      {
        "from": 0,
        "to": 1,
        "relation": "supports-decision",
        "expected": "keep"
      },
      {
        "from": 2,
        "to": 0,
        "relation": "challenges-premise",
        "expected": "withdraw"
      },
      {
        "from": 3,
        "to": 0,
        "relation": "challenges-premise",
        "expected": "keep"
      }
    ],
    "requiredNew": [],
    "notes": "No inference that current designselectedplan automatically changes. Crossdepartment falsechallenge definitely wrong."
  },
  {
    "id": "explicit-nonadoption",
    "purpose": "considering option is related context but not adopteddecision supports label",
    "sources": [
      "Studio team: provider P can offer a sponsored license.",
      "Studio team: we are considering provider P because of that sponsored license, but no switch is approved. Our recorded choice remains provider Q.",
      "Studio team: provider Q was chosen last month because its local rendering worked.",
      "Studio retest: provider Q local rendering now fails after its update; this removes our original reason. We still have not chosen provider P."
    ],
    "oldEdges": [
      {
        "from": 0,
        "to": 1,
        "relation": "supports-decision",
        "expected": "withdraw"
      },
      {
        "from": 2,
        "to": 2,
        "relation": "supports-decision",
        "expected": "keep"
      }
    ],
    "requiredNew": [
      {
        "from": 3,
        "to": 2,
        "relation": "challenges-premise"
      }
    ],
    "notes": "Withdraw only erroneous adoptionlabel, do not deletependingchoice source. No source authorizes new choice."
  },
  {
    "id": "corrected-inferred-reason",
    "purpose": "retracted AI-inferred motive vs explicitly attributed user decision reason",
    "sources": [
      "Courier quote: courier V costs 20 units per parcel.",
      "Team decision: we chose courier V because it includes cargo insurance; price was not a reason for our choice.",
      "Assistant: I guess the team chose courier V because the parcel price was low.",
      "Team correction: that guess about our motive is wrong. Cargo insurance was our reason, not the parcel price.",
      "Contract record: courier V includes cargo insurance."
    ],
    "roles": [
      "user",
      "user",
      "assistant",
      "user",
      "user"
    ],
    "oldEdges": [
      {
        "from": 0,
        "to": 1,
        "relation": "supports-decision",
        "expected": "withdraw"
      },
      {
        "from": 4,
        "to": 1,
        "relation": "supports-decision",
        "expected": "keep"
      },
      {
        "from": 2,
        "to": 1,
        "relation": "supports-decision",
        "expected": "withdraw"
      }
    ],
    "requiredNew": [
      {
        "from": 3,
        "to": 2,
        "relation": "challenges-premise"
      }
    ],
    "notes": "Keep original userdecision source. Withdraw unsupported AI-inferred support not historicalvalidmotive. Explicit not-price excludes ambiguity. Sources0/4possiblepredicatepremises but onlyinsuranceadopted."
  },
  {
    "id": "missing-antecedent",
    "purpose": "unknown vs unsupported confidentkeep/withdraw",
    "sources": [
      "Project coordinator: the supplier supports encrypted archives.",
      "Meeting fragment: we agreed to go with that because of the thing we discussed earlier.",
      "Project coordinator: I no longer have notes from before that fragment."
    ],
    "oldEdges": [
      {
        "from": 0,
        "to": 1,
        "relation": "supports-decision",
        "expected": "unknown"
      }
    ],
    "requiredNew": [],
    "notes": "No hardcoded semanticrepair; control may omit, candidate unknownpreservesunverified. Exactnodeabsenceinsufficientproofnotdefinitewithdraw. Need reviewer agree rubric before freeze."
  }
]
```

## Frozen data and verification record

The source fixture and evaluator rubric were frozen after primary ambiguity
review and before any scored provider output. SHA-256:

- `evaluation/architecture/rationale-disposition-fixture.json`:
  `606e35acfd7bd6a9276f1a7bd89248cc1608051de90eb270725b595b27947d7a`
- `docs/rationale-disposition-rubric.md`:
  `7fb2f1c023a4d1b4f5b6ac1a42546a71ef468172eae0ae8ea96f36a945b32831`

Owner: Sol/high worker; fixed base `082e0736121ffd43cd3bb2000d14e9341e690f80`.
The only new data entrypoint is the evaluation fixture: a later operator may
map its six neutral scenarios to local model indices, but no current product
caller imports it. The new pure test is the sole present consumer. It checks
exact source-only structure, one role-bearing receipt per memory, dense arrays,
event and tuple references, tuple uniqueness, the core's actual NFKC/whitespace
normalization and 800/4000-unit bounds. The separate rubric retains the
human-only dispositions and permitted target alternatives. Primary reviewed
case 1's 3→2 and case 2's 2→1 as defensible only when the cited decision
receipt explicitly carries the challenged premise; current applicability must
not be confused with historical truth. Exact original-premise-node coverage
remains separately reportable.

Worker evidence, using synthetic files only: focused test 3/3; generic
`npm test` 139/139 on Node 22.16; the equivalent direct Node 24.15 generic
test command 139/139; `scripts/validate-json.mjs` passed on both; and the
pinned marketplace plus strict-plugin validation passed under both Node
versions after an isolated tooling install. No Node 20 binary was present;
the pure test uses APIs available in the declared Node 20 range and has no
adapter or SQLite dependency. No scoring, prompt tuning, provider call,
credential, grant or shared-ledger access occurred. Independent fixed-diff
reviews, primary final gates and PR/CI remain delivery gates.
