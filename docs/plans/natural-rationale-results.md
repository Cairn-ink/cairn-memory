# Natural rationale development pilot: public evidence contract

Base `f2a79f9e6bf0be638945606e84a31f659917496c`. The once-only raw report
is private. This packet is read-only with respect to the experiment: no provider
calls, ledger writes, credential reads, reruns, or changed pilot inputs.

## Acceptance

1. Export a closed, reproducible projection of the exact frozen synthetic
   report. It retains four development cases, ten source events, four questions,
   every capture and read-arm status (including failures/not-run), all ten
   relation candidate windows and five proposed edges, source-linked lifecycle
   snapshots before/after/cold reopen, and returned source IDs. Preserve
   unmatched/ambiguous provenance as such; never manufacture a source ID.
2. Carry exact reviewed source/operator and live-candidate hashes plus budget
   before/after and attempt delta: request count, conservative reservations,
   known usage and unknown-cost attempts. Keep reservations distinct from an
   invoice or measured semantic quality. Reject mismatched schedule, arithmetic,
   missing arms, malformed proposals or incomplete provenance rather than
   silently dropping observations.
3. The public projection is an allowlist of synthetic fields. Drop unselected
   raw metadata and reject unsafe values in retained fields: private paths,
   credentials, authorization headers, client/session IDs, memory UUIDs and
   provider IDs. Do not publish the raw report, provider
   requests/responses, local databases or private fixture archive. Tests pin
   the exact projection and demonstrate privacy rejection and failure retention.
4. Document the two supported, two unsupported and one ambiguous proposals
   after source review, including missing self-supports and the read-arm gaps.
   The review is nonblind development inspection, not benchmark scoring,
   installed-MCP behavior, host answers or a product reliability claim. No
   retry or retrospective source/fixture/prompt adjustment is allowed.

Implementation and independent review remain under the worktree/PR workflow;
the primary owns final comparison to private evidence and publication decisions.

The underlying live candidate `f2a79f9e6bf0be638945606e84a31f659917496c`
received final dual-runtime checks before the paid run: trace/decision-evolution
focused 20/20, core 651, generic 114, live-offline 248 pass with 30 existing
skips, plus independent Standards and Spec PASS. These supersede earlier
pre-correction counts; they are not a verification result for this evidence
exporter. Dependent PRs #133–135 were not merged at the time of this packet.
No automatic merge, release or deployment is authorized.
