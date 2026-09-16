# Read-only disposition comparison integration

Fixed base: `4e9044e6bb00fc884c3029af3f1d79add3dd7219` (DS v2).
Integrate independently reviewed DC `082e0736121ffd43cd3bb2000d14e9341e690f80`
and DP `7cf0d9e506bfd8237a3ba294e971d2ba884871a3`, then the separately frozen
DF fixture. The primary owns integration; workers own the original slices and
private operator implementation. This does not merge any GitHub PR or main.

## Acceptance

- DI1: Preserve the exact reviewed runtime bytes from DS, DC and DP. The only
  initial conflict is adjacent explanatory paragraphs in
  `docs/rationale-disposition-review.md`; retain both the v2 instruction
  description and the separate comparison capability. No new runtime behavior.
- DI2: Integrate the frozen source-only six-case DF fixture and separate rubric
  only after their independent reviews. Record their hashes and provenance.
  Do not expose evaluator labels or IDs to the model.
- DI3: Run affected source tests, full core, adapter, artifact, budget/guard,
  live-offline, generic, JSON and strict plugin gates on Node22.16/24.15. Include
  opt-in installed rationale wire gate and required core/adapter/budget demos.
  Serialize heavy adapter/artifact suites. No typecheck gate exists here.
- DI4: Build a local archive and install it into a fresh private temporary
  project. Pin archive, installed/source executable bytes and dependencies for
  the private operator rehearsal. Use only synthetic data and fake transport.
  Independently verify exact arm inputs and unchanged sources/graphs after a
  separate keyless cold subprocess. Test malformed output and transport failure
  without retries or repair, and duplicate intent, pin mismatch and occupied
  paths without new sends. Rehearsal does not establish semantic accuracy.
- DI5: Before any paid call, freeze and independently review operator/fixture/
  rubric/prompts/artifact and confirm settled shared campaign checkpoint and
  remaining headroom. A distinct opt-in grant and fresh persistent intent permit
  at most 24 HTTP / 120000 microUSD reserved, baseline model only, within the
  pre-existing US$50 cumulative budget. No existing experiment is rerun.
  No key is loaded by workers or written to artifacts. Failure evidence stays
  retained; uncertain transport halts remaining requests without refund.
- DI6: Independently judge protocol coverage, historical support preservation,
  false withdrawal, definitely wrong retained edges, genuine challenge coverage
  and appropriate uncertainty. Report exact-node coverage separately from
  defensible alternative source-supported targeting. Results do not establish
  extraction, MOC recall, end-user behavior, general reliability or superiority.
  No write/default promotion follows automatically from this diagnostic.
- DI7: Final combined candidate requires primary acceptance and separate
  Standards/Spec reviews, scoped PR and all latest-head CI checks. No package
  publication, deployment, user/production data changes or automatic writes.

## Integration checkpoint

Primary combined DS/DC/DP at `584dade` after preserving both documentation
paragraphs. Both Node22.16 and24.15 passed all45 focused core/adapter/control/
guard/attempt tests. No actual provider calls were made. Fixture, operator,
full combined gates and independent integrated review remain pending.

DF `1c65c94a8d8cfa5f9073345974abacd550193958` was integrated after both
independent axes passed and primary generic139/JSON/strict-plugin checks passed
on both runtimes. Its fixture/rubric hashes remain those in the DF plan.
Fourteen integrated runtime/test/fixture files were byte-compared with the
reviewed original slices. The local archive SHA-256 is
`546d16d5458dc2b6997a3d3f6d3d1bb3dce3503542f8ba79bb8a7ce76681cdd9`;
it was installed offline into a fresh private temporary project.

A worker-owned documentation-only correction at `07c090d` removes attribution
of observed failures to a preparation-only comparison page. It distinguishes
the earlier pre-fix natural-development read observation, its later offline
fix without a paid rerun, and planned chronology comparison. Generic139/JSON
passed both runtimes after that correction. No runtime bytes changed.

At this source freeze, primary full core698, adapter198, artifact70, budget15,
guard98 and their applicable demos pass on both runtimes. Node22 additionally
passed live-offline265 (30 intentional installed skips), explicit installed
rationale4, generic139, JSON and strict-plugin gates. The corresponding final
Node24 checks, private operator rehearsal and independent integrated review
are still pending; they must be recorded before delivery, not inferred from
these partial results. No real comparison request or new campaign grant has
been made during this integration preparation.
