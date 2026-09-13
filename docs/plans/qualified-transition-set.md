# Complete qualified transition sets (S2b)

Fixed base: `b51be086e61f0ddb08fae8dcafc53de3124bc3f8`.
Private dependent work; the inherited security disclosure hold remains.
Extends trusted-manual S2a without claiming automatic semantic interpretation.

## API

Add local-only `transitionQualifiedSet({namespace,predecessors,replacement})`.
All fields are required and extra keys rejected. `predecessors` is a dense array
of 1–5 distinct `{memoryId,expectedRevision}` references; `replacement` is one
such reference and cannot appear in the predecessor set. Canonicalize predecessor
order by ID so outcomes do not depend on input order. Every reference has the
existing identifier/revision validation. No labels, binding overrides, evidence
indices or inferred authority are accepted.

Inside one shared write transaction, resolve every reference and exact revision
before policy evaluation. Validate source qualifications and immutable bindings
for ALL referenced memories before any ordinary unresolved return, so an earlier
policy failure cannot mask later corruption. All records must be current in the
same namespace. Require one established slot identity and a different known
replacement value for every predecessor, using S2a direct/adopted and user-anchor
requirements. Different prior values are not automatically reconciled: this
operation records the trusted caller's explicit selection of the complete set.

The supplied set plus replacement must contain every current, nondeleted bound
member of that slot. Any unreferenced current member yields unresolved
`additional_current_claims`, with no mutation. Historical/deleted members do not
consume the 1–5 input allowance. At most five total incoming supersession edges
may target the replacement, including earlier edges: preflight capacity before
the first retirement; insufficient capacity is `supersession_limit` hard error.
Current-member discovery returns at most seven rows (six permitted members plus
an overflow sentinel), retaining namespace fields to reject corrupt foreign
membership as storage_error. This bounds returned rows, not historical rows
visited by SQLite; no constant-time scan claim or new migration is made.

Applied response: `{status:'applied',reason:null,retiredCount,previous:[{id,
revision}],replacement:{id,revision},indexRevision}` with previous sorted by ID.
Unresolved uses S2a's finite reason envelope with retiredCount zero and unchanged
indexRevision. Only after all validation may the existing private retirement
mutation run once per predecessor. Any late failure rolls back every edge,
suppression, conflict/MOC invalidation, revision and epoch change. Successful
repetition with stale refs is a hard revision/history error, not a new replay API.

## Acceptance

- M1: strict shape/bounds/density/duplicates/self/namespace/revision checks. Bad
  references and historical/forgotten records are hard failures without mutation.
- M2: share the same S2a source/slot/adoption policy and private mutation seam;
  no boolean bypass and no alternative engine. Existing pair API response and
  behavior (including third-current refusal), direct/ordered fences remain intact.
- M3: complete set coverage, full validation before mutations, finite unresolved
  reasons, preflight existing+new incoming edge capacity, deterministic output.
  Inspect all referenced sources before early policy returns. No schema change.
- M4: actual SQLite positive old/reaffirmed-old/new jointly retires both old rows,
  retains all original evidence and reports only replacement current. Test 1 and
  5 predecessors, 6 rejection, omitted member, wrong slot, same-value member,
  missing qualification, bad source/role on a late member, stale late revision,
  existing edge limit, late-write rollback, shuffled order and full cold reopen.
  Historical/deleted members do not block coverage. No implicit deletion is used
  to make the old/reaffirmed-old/new scenario succeed.
- M5: installed-core positive multi-update and negative omitted-member case,
  authoritative history checks after closing all handles and reopening. Update
  contract/protocol docs, changelog, and artifact allowlist if modules are added.
- M6: both Node22.16/24 contributor/JSON/plugin, full core, relevant demos,
  OpenAI/MCP offline and installed-artifact gates; independent Standards/Spec
  review of the frozen commit. Synthetic data only; no paid requests or publishing.

This manual operation does not decide whether the supplied claims are truly one
matter, whether the caller's single-claim attestation is correct, or whether a
source's wording entails adoption. Automatic qualification, ambiguity resolution,
premise tracking and real-model quality remain subsequent gates.

## Local verification

Root ran the frozen runtime/tests on Node 22.16.0 and 24.15.0: each passed
generic 31, core 421, OpenAI adapter 152, MCP 25 and installed artifact 18 tests.
The offline live-evidence suite passed 61 with 27 skipped, not 88 passes.
JSON/plugin validation and store/admission/MOC/capture/conflicts/history/rebuild/
recall/continuation/OpenAI-offline demos all exited 0. The new focused suite's
27 cases are included in the core total. All stores and model replies were
synthetic; no provider request, publication, merge or deployment occurred.
These are local gates, not private-fork CI or semantic-quality evidence.
