# Fixed selective-correction evidence

Base: `0c7c40bdb738c1144d12f3a21084619e4b084f96` (PR143).
One actual installed diagnostic has completed: six guarded HTTP attempts,
30,000 microUSD reserved, three mechanically completed cases. Semantic review
is separate; mechanical completion is not a quality pass. Do not rerun it.

## Acceptance

- CE1: A pure, closed synthetic projection covers exactly all three frozen
  fixture cases and all six attempted transport slots. Validate fixture/rubric
  hashes, fixed model, candidate/operator/artifact hashes and source identity
  mapping. Export source IDs/indices, never private memory/receipt/attempt IDs,
  namespaces, paths, credentials, provider IDs/headers or arbitrary error text.
- CE2: Preserve every proposed edge and pre/post/cold graph, receipt endpoint
  mapping, read statuses, review counters and failure/not-run status. Do not
  replace unavailable or malformed output with an empty successful proposal.
  Fixed fixture text is available by reference; full raw evidence remains
  private. Unsupported and unexpected edges must not disappear in projection.
- CE3: Report six requests, 30,000 microUSD reservation, 1,243 microUSD known
  generation usage estimate and three unknown-cost count calls separately.
  The reservation is not an invoice. Verify deltas against the actual ledger;
  retain zero unsettled and cumulative ceiling without resetting it.
- CE4: Offline tests demonstrate deterministic complete projection, rejection
  of wrong fixture/case/source provenance, preservation of bad/extra edges and
  failures, and exclusion/rejection of sensitive extra fields. Run contributor
  and ordinary live-offline gates on both Node22.16/24. No paid calls.
- CE5: Publish the synthetic JSON plus source-by-source nonblind independent
  semantic assessment, including legitimate alternative links, ambiguities,
  missed premises, temporal-direction failures and the three-case limitations.
  Disclose same-family agent review. No broad accuracy, natural capture/recall,
  self-correction reasoning, user-benefit or default-promotion claim.

Primary owns final judgment, actual ledger accounting, artifact projection
execution and report approval. One implementation worker owns the pure exporter,
tests and draft report; separate reviewers inspect final fixed evidence/code.
No runtime/schema/prompt/default changes, merge, release, deployment or user data.

## Verification record

The implementation worker (Sol/high) supplied the pure exporter and tests;
the primary generated the public projection from the retained actual report,
six request/response pairs and a read-only cumulative ledger query. The primary
checked all eleven proposals and the known/unknown accounting separately.
No provider requests were made for projection or verification.

On Node 22.16.0 and 24.15.0, primary verification passed:
`node --test evaluation/live/test/rationale-correction-evidence.test.mjs`
(3/3 each), `npm run test:live-evidence-offline`, `npm test`,
`npm run validate`, and `npm run validate --prefix tools/plugin-validation`
(plugin and marketplace strict checks). Strict plugin tooling required its normal
install scripts; an initial script-disabled tooling install was insufficient
and was corrected before both strict gates were rerun successfully.
The generated artifact digest is
`319d78841d738b0949b76e11a18c99576b5e7f49d7749a27490c3d7615e79e3f`.
Fixed-candidate independent Spec and Standards review and remote CI follow;
their final commit-bound outcomes belong in the PR record.
