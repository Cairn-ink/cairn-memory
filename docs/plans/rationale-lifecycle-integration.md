# Integrate rationale correction with filing and direct-challenge reads

Public main base: 3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9.
Combine reviewed PR136 (54036d9d4002c6b2334d4b9867aa63cb7ff6cffc), PR139
(819f60bcc32dbdffd142602f08654734e9949ea9), and the dependent correction stack
(PR140, PR141 and selective-correction diagnostics) in one isolated candidate.
Local branch integration only: no GitHub merge, publication, deployment or paid calls.

## Acceptance
- LI1: Preserve both production intents: source-bound proposals survive strictly
  filing-only placement/revision changes; explicit replace-reviewed changes only
  the guarded in-scope proposal set. Source edits, receipt changes, forget,
  retirement and arbitrary revision writes still invalidate links. No schema or
  provider change, additional engine, automatic replacement or new relation types.
- LI2: Preserve PR136 direct incoming challenge reads, exact-edge deduplication,
  existing complete-result bounds and source/namespace/revision guards. The new
  independently enabled MCP correction tool and keyless inspection remain intact.
- LI3: New cross-feature public-API regression: seed support + mistaken challenge
  plus out-of-scope crossing evidence, file endpoints, use inspected new refs to
  remove only the mistaken link, refile and cold reopen. Source/receipt/
  qualification preservation, correct revision rebindings, no duplicates or
  resurrection, stale old-ref rejection and unchanged crossing evidence required.
- LI4: After replacement and filing, correction and forgetting invalidate related
  links; later filing cannot resurrect them, unrelated graph stays. An in-flight
  replacement crossed by filing-only revision/epoch change must reject without
  overwriting the independently committed placement or restored valid links.
- LI5: Preserve migration lifecycle diagnostics from PR139 and all prior negative
  model evidence verbatim. Resolve docs to distinguish pure filing preservation
  from material-source invalidation. No passed semantic-quality claim.
- LI6: Primary runs combined full core, MCP, artifact, generic, live-evidence
  offline, JSON and strict plugin gates on22.16/24 plus relevant demos; inspect
  actual installed correction and new lifecycle traces. Independent Standards
  and Spec review same final aggregate candidate before PR; exact-head all CI,
  mergeability and source identities required before ready.
- LI7: Clearly document combined PR supersession/merge shape. Do not close earlier
  PRs or change their branch histories. PR137/138 are independent experiment
  evidence and not required runtime dependencies; do not duplicate or rerun them.

One bounded Sol/high worker owns local merge conflict resolution and interaction
tests/docs. Primary owns fixed commits, integration intent, acceptance and gates.
Use resolving-merge-conflicts for any actual conflicts, preserving both intent.

The diagnostic-only candidate `6afc11b19114ab3b93a6c7eb6c3354e0e4941939`
passed primary full-core/generic/targeted gates on both runtimes and independent
Standards/Spec review. It is an internal dependency checkpoint, not another PR
the owner must merge: ship it with this combined lifecycle candidate. The
combined final diff must still pass fresh integration gates and both reviews.

## Integration record

The Sol/high worker made local merge commits `023ea2b` (PR136) and `4d3f94f`
(PR139). Conflicts in the rationale storage module, MCP inspection description,
automatic-loop documentation and changelog were resolved by preserving both
explicit replacement and filing/read semantics. Runtime wiring now supplies
the filing helpers and still forwards the explicit replacement mode. No schema,
provider prompt, default tool configuration or paid report was changed.

Four new public-API tests cover filing/replacement/refiling, correction and
forgetting without resurrection, and the in-flight filing epoch fence. Primary
inspection required writer closure and an environment-scrubbed keyless reader.
Qualification intentionally retains its original source-bound revision and
anchors across pure filing; rationale endpoint guards instead advance to the
current memory revision. These two version roles are not interchangeable.

Worker focused44 and primary targeted4 tests passed on Node22.16/24. Primary
full MCP/artifact suites also passed both runtimes, with store/MOC/capture/recall
demos. Remaining complete core/live-offline gates, final independent reviews
and exact-head CI are recorded in the final delivery PR. No provider call or
GitHub main merge occurred during this integration.
