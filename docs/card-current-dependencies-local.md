# Current-dependent private Cards

A confirmed Card can record that its authored content describes the currently adopted method for a role and read-set context. This is an explicit user review, using the same authority as Card confirmation. It grants no access, execution permission or semantic accuracy guarantee.

Enable core authoring with `privateCards.currentDependencies:{version:'card-current-dependencies-v1'}` alongside configured method packages. Ordinary writable opening migrates supported stores atomically through prerequisites, v30, v31, frozen v32 and v33. Stop older binaries before upgrading: they refuse v33. Read-only and managed-existing openers validate without migrating; the exact managed option is `schema33-existing-v1`. Older exact schema31/schema32 options retain their meanings.

`confirmCardDraft` accepts optional `currentDependencies`. Standalone `declareCardCurrentDependencies` and `revalidateCardCurrentDependencies` take `namespace`, `cardId`, `actionId`, `expectedRevision`, `expectedDependencyRevision` and `currentDependencies`. The declaration is:

```js
{
  context: { readSet: [personalNamespace, projectNamespace], roleId: 'finance' },
  packages: [{ package: methodPackageRef, snapshot: reviewedResolution.snapshot }]
}
```

The context contains one exact namespace or the owner's personal namespace plus one project. The Card and all 1–16 distinct packages must belong to it. Obtain each authenticated snapshot with `resolveMethod` under that exact context and fresh read authority for every consulted namespace. Declaration requires available current winners. Use null dependency expectation only for the initial declaration; replacement and revalidation require the inspected positive revision. Revalidation reviews exactly the same context and complete package set. Unknown fields refuse.

Standalone review changes no title, body, Card revision or body revision. It advances the dependency revision and Card epoch. Exact action replay returns the original content-free outcome; changed payloads conflict. Card edits preserve the declaration and require fresh explicit review. Revalidation also requires valid source fences and never independently makes unsupported or historically applicable content current.

MCP enables this with `--private-cards local-v1 --method-packages local-v1 --private-card-current-dependencies local-v1`. Programmatic MCP configuration uses `privateCardCurrentDependencies:'local-v1'`. The two dependency tools always refuse `approval_required`. Configuration checks open no database.

For independent local terminal approval, create a JSON file containing the complete package-reference array and run:

```sh
cairn-memory review-card --db STORE --owner OWNER --card CARD --revision 2 \
  --dependencies PACKAGES.json --role finance --dependency-revision null \
  --dependency-operation declare
```

For revalidation use the inspected positive dependency revision and `--dependency-operation revalidate`. For project plus personal resolution, add `--project PROJECT --method-read-personal true`. The terminal fixes the authorized read set, displays the exact Card, complete resolutions, operation and both CAS expectations, requires the displayed phrase, and re-reads after interaction. No protocol input, `--yes` or environment switch approves it. Draft confirmation may include a declaration using the same terminal flow.

Reads always compare persisted observations with canonical resolution, even when dependency authoring is off. Importing an unadopted version leaves currentness intact. A changed consulted binding (including previously absent higher-priority bindings), same-version re-adoption, withdrawal, deletion or Card revision change produces effective `needs-review`; this is not a lifecycle state. No event drain or cache cleanup is required. Source support and revision-bound applicability remain separate checks.

Authorized metadata appears under `support.currentDependency`, with dependency `revision`, `context`, `status`, deterministic `reasons` and `versions` (each has `described` and readable `current` refs). Reasons are `binding_changed`, `binding_absent_now`, `binding_disabled`, `version_deleted` and `access_revoked`. If the complete context is unauthorized, only revision, `needs-review` and `access_revoked` are returned, with no denied-scope lookup or package/count disclosure.

Current evidence, candidate indexes, assembly, relations, organization/MOC members and title sources, and current role guidance exclude stale Cards. History retains authored bytes where source-retention rules allow and qualifies their dependency status. Historical adoption/profile change reasons retain exact-revision/source-availability semantics. Dependencies cannot reconstruct purged method or source content. Memory dependencies, generated summaries and automatic rewriting are outside this feature.

Method generations invalidate declaration-aware sidecars and continuations before ranking or publication; canonical comparison decides eligibility. With no declarations, method mutations introduce no dependency fields or freshness changes. Optional work stops at deadline expiry; bounded final validation still completes before delivery. Opt-in contention measurements live in `npm run measure:card-current-dependencies`, outside ordinary test suites.
