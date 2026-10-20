# Private engine V1 completion

Status: implementation in progress, not a passing result. User requested the
complete usable system on 2026-10-20 after the local Card slice merged.
Fixed starting main: `9a00e82de25243f0d87a4304e0e9cbb6c42a2add`.
Product integration and deployment remain the product team's responsibility.

## Outcome and delivery order

One engine owns sources, Memories and private Cards. A normal Memory write
never silently creates or publishes a Card. A person can deliberately curate a
Card, inspect its evidence, change the underlying Memory, and open another
session without receiving the stale Card as current evidence.

1. **Source and interpretation links.** Reuse existing retained Memory receipts
   without copying them into a new source archive. Bind Card dependencies to
   exact Memory revisions and receipt identities. Correction, retirement and
   forgetting invalidate dependents transactionally, including feature-off
   writers and restart. Existing submitted-note behavior stays compatible.
2. **Common evidence reads and typed organization.** One authorized read facade
   serves distinguishable Memory/Card records, including unfiled records.
   Canonical source/version checks exclude unsupported current Cards; history
   can inspect retained authored artifacts with explicit qualifications.
   Card routing does not put Card IDs into the old Memory MOC DTO. Mapping and
   traversal are navigation, never permission or proof of truth.
3. **Installed MCP and trusted confirmation.** Expose the bounded capabilities,
   exercise actual stdio calls, confirm through an independent local trusted
   action channel, restart the installed process, then read/change/forget.
   A model-supplied confirmation flag is never authorization.
4. **Handoff.** Publish exact engine commit, capabilities, installation/run
   commands, limitations and observed results to the existing product issue.
   No product UI, production database, deployment or registry release here.

Each runtime slice is independently reviewable. Do not call the whole contract
complete because one slice or its tests passed. Record remaining Raw, hosted,
semantic-quality and product gates separately.

## Selected bounded source behavior

The full-V1 contract's full-original-backed drafting requirement is unchanged:
an excerpt is not full Raw and cannot satisfy that requirement.

Add a separately explicit **retained-receipts-v1** drafting option to the local
preview. With this option, a caller may curate a private Card from 1–6 existing
same-namespace current Memory refs. The engine resolves 1–16 actual retained
receipts across those Memories, or refuses atomically if that complete selected
set exceeds the bound. It does not select a convenient silent prefix. Each ref
is core-issued, content-bound and marked `completeness:'excerpt-only'`;
conversation coverage remains unknown. This is useful bounded source support,
not completion of full conversation capture or source completeness.

Memory interpretation is a required dependency, distinct from the receipt's
attributed words. References contain actual Memory ID/revision and receipt ID;
receipts have no invented independent revision. No Memory text or receipt copy
is persisted in dependency rows, effects or action receipts. The authored Card
has the existing independent current-body retention policy. Confirmation is
private curation, not adoption, semantic verification or publication.

The default note-only input remains unchanged. Unsupported full-Raw requests
continue to refuse. No capture policy, default retention, remote model call,
provider budget, encryption claim or automatic memory-to-card promotion changes.
Future full Raw still requires its existing controls and prerequisite evidence.

## Slice 1 acceptance: Memory-to-Card support

- **L01 Compatibility:** default construction and old Memory DTOs unchanged;
  existing note lifecycle passes. New receipt path is explicitly selected and
  accurately advertised. No silent fallback from full-source requests.
- **L02 Provenance:** authored draft from exact current Memory refs resolves the
  actual complete bounded receipt set, has no model calls, identifies excerpt
  coverage and required interpretation dependencies. Foreign, stale, deleted,
  historical or awaiting Memory refs refuse; zero receipts or too many receipts
  refuse without a partial draft or new retained text.
- **L03 Identity and bounded reads:** source refs bind store, exact namespace,
  Memory ID/revision, actual receipt ID and exact retained content. Tampering,
  another store/scope and deleted sources refuse. Reads are bounded and preserve
  exact retained receipt text; no source text in metadata-only pages/effects.
- **L04 Transactional invalidation:** correct, forget/reject, supersede,
  qualified retirement and every other Memory revision mutation invalidate
  dependent interpretation support in the same transaction. Drafts become
  content-free cancelled tombstones exactly once. Confirmed authored bodies
  remain inspectable but have unavailable/needs-review support. Source-only
  note Cards and unrelated namespaces are unaffected.
- **L05 No escape through another opener:** reopen without the Card option and
  mutate a Memory; dependent invalidation still applies. Old binaries refuse
  the additive schema. Migration preserves existing v20 note/Card contents.
  Use only synthetic databases; no mixed-version user-store upgrade.
- **L06 Rebinding and replay:** stale confirmation refuses, successful original
  action replay is content-free and never revives a cancelled draft. An explicit
  confirmed edit may retain unavailable old bindings without claiming current
  support, or rebind to genuinely available sources. CAS and source changes
  during authority callbacks cannot commit stale dependencies.
- **L07 Bounds and purge:** at most 128 live dependent Cards per Memory/source,
  checked atomically. Mutation fanout is bounded; errors roll back Memory and
  Card changes together. Cancel/delete purge all dependency rows. Forgotten
  receipt text does not survive in auxiliary tables; current authored bodies
  are the documented exception, not hidden source copies.
- **L08 Evidence:** targeted and full relevant checks on Node 22.16 and 24.15,
  actual exit codes, owned temporary cleanup, fresh process restart and
  installed-package proof. Generic `npm test`/`validate` and current CI gates
  apply. No TypeScript gate exists. Fixed candidate receives independent
  Standards and Spec reviews before delivery.

## Routing and evidence

Primary owns this plan, integration and acceptance. Implementation is delegated
to GPT 6.1 Sol/high because this crosses persistence and permission boundaries.
Independent non-author Standards and Spec reviewers use GPT 6.1 Sol/high.
Commands/results and candidate SHAs are appended when observed; no planned
check counts as a pass. No paid experiments are part of this implementation.

## Parallel adapter packet: installed local confirmation

Build on the existing public core API without changing the core in this packet.
The agreed new drafting variant is
`{memoryRefs:[{type:'memory',namespace,memoryId,revision}],
sourcePolicy:'retained-receipts-v1',title,body}`.
The server fixes namespace at startup and inserts it into those typed refs.

- **H01 Default off:** an explicit `--private-cards local-v1` / equivalent
  server option enables the extra tools. Existing default startup/tools/strict
  payloads and stdout framing remain unchanged.
- **H02 Least authority:** new tools can inspect Cards/effects/source metadata,
  create a private draft from already retained Memory receipts, and cancel a
  draft. Startup grants only exact-scope read/draft operations. No serialized
  token, claimed user role or tool call grants `explicit-user` authority.
  Missing confirmation channel returns `approval_required`, never auto-confirms.
- **H03 Actual local review channel:** a separate local CLI command takes an
  exact Card ID/revision and configured DB/namespace, reads and displays the
  exact draft with untrusted-text terminal escaping, then asks the operator to
  confirm that revision. Confirmation requires a real TTY interaction. No
  `--yes`, environment approval or piped stdin bypass. The MCP process never
  reads prompts from its protocol stdin. Scope/payload/revision are bound to the
  issued opaque authority; source/revision changes while the prompt is open
  refuse. A negative/EOF response makes no confirming write.
- **H04 Installed restart proof:** from an actual installed artifact use real
  stdio MCP to remember, draft and inspect; use the separate terminal review
  command; restart MCP and inspect the confirmed Card; correct/forget the Memory
  and observe cancelled drafts/unsupported confirmed support. Independent
  terminal subprocess tests may simulate operator keystrokes on synthetic data,
  but do not claim any real user's approval or semantic-quality result.
- **H05 Safety/regression:** keys are unnecessary and provider calls zero;
  foreign namespace/model authority fields fail. Bound request/output/terminal
  display. Owned temporary cleanup and actual exit codes apply. Run MCP suites
  and installed artifact evidence on both required Node versions.

Common evidence-read tools will be added after the core common-read API is
implemented and fixed; the adapter packet does not invent a second read engine.

## Common-read packet: exact-namespace local V1

This bounded first API uses one exact `namespace` per call, matching the
standalone MCP host and existing Card authority port. It is not the prospective
multi-namespace `readSet` API, a semantic-ranking improvement, or full typed-MOC
delivery. Old Memory `recall` and its DTOs remain unchanged.

- **R01 API and compatibility:** extend the same optional facade with
  `selectEvidence`, `fetchEvidence`, `revalidateEvidence`. Strict inputs, opaque
  read authority and existing envelopes/whole-response 65,536-byte maximum.
  The finite capability descriptor advertises only the implemented subset.
  No separate canonical store, network, model or vector dependency.
- **R02 Explicit applicability:** existing `editKnowledgeCard` may record
  reviewed `current`, `historical`, `conflict` or `unknown` applicability.
  `confirmCardDraft` may accept the same explicitly reviewed optional
  applicability, atomically with confirmation; omission still means unknown.
  The terminal review command must display and bind this additional choice,
  not infer it from a generic confirmation or source availability.
  Neither source availability nor
  confirmation establishes adoption/truth. A current applicability label never
  overrides unavailable/stale required support. Preserve existing unknown-only
  calls. Bind applicability review to the exact Card revision; invalidation
  cannot carry that review forward silently.
- **R03 Selection:** query is 1–4,000 UTF-16 units; types are a unique nonempty
  subset of memory/card; intent is current/history. Enumerate filed and unfiled
  canonical records. Literal Unicode word overlap only, deterministic ties,
  fair interleaving of type streams before one shared scan allowance. Defaults:
  item limit 12 (max 24), scan rows 128 (max 1,024), scan body units 256,000
  (max 2,000,000), deadline 1,000 ms (max 5,000).
  Report each requested type's scanned/included/partial coverage. A bounded
  prefix is not complete recall; do not make model-relevance claims. Signed
  continuation binds namespace, store, query, intent, types, budgets and
  Memory/Card generations; changes make it stale.
- **R04 Eligibility:** current selects active visible Memories and confirmed
  Cards with eligible canonical support plus explicitly reviewed current
  applicability. No drafts, forgotten/awaiting/historical Memories, unsupported
  Cards or unknown/historical/conflict Cards as current assertions. History
  returns retained nondeleted Memory records and confirmed authored Cards with
  explicit state/support/applicability; it never retrieves purged old bodies or
  forgotten/deleted source text.
- **R05 Fetch:** 1–24 typed exact refs, no cross-scope or mixed-revision content.
  Return distinguishable canonical Memory/Card content, qualification and
  provenance coverage. Available provenance identifies actual sources and
  unassessed meaning; an unavailable historical Card does not return the
  missing source text. Source/excerpt reads remain separately bounded.
  Do not count copied receipts as independent corroboration.
- **R06 Final fence:** return a core-authenticated opaque bounded snapshot.
  Revalidation rereads canonical revisions/eligibility/namespace generations
  after host authority callbacks and returns fresh items or a fixed error with
  no stale body. Mutation after selection/fetch, wrong store/scope, changed
  source, revoked read authority and replay after restart are explicit tests.
  Do not persist private content in snapshots or action/effect logs.
- **R07 Migration:** additive schema after the receipt slice's v21, opt-in only;
  v18/v20/v21 retained data and feature-off reopening remain safe. No real data
  migration, no old-binary mixed writers. Feature-off Memory mutation still
  invalidates Cards. Applicability and source availability must compose.
- **R08 End-to-end evidence:** primary reruns source → Memory → draft →
  confirmation → reviewed current applicability → select/fetch/revalidate →
  Memory correction/forget → stale exclusion → fresh-process qualified history.
  Both Node versions, real installed imports and independent dual review.
  No semantic score claim. Typed Card MOC/mapping remains the next explicit
  organization packet, not claimed implemented by these reads.

## Typed organization packet

The canonical source/Memory/Card records remain one engine. Memory and Card
indexes are typed views, not independent memory systems. Shared evidence reads
work without filing or mappings; organization failure must not lose a write.
No new classifier/model call is required for this first deterministic interface.

- **M01 Typed map:** `mapEvidence({namespace,type:'memory'|'card',...})` exposes
  bounded, revisioned L2 → L1 → typed record navigation. Reuse the authoritative
  existing Memory MOC semantics; never insert Card IDs into old Memory DTOs or
  silently read stale Memory index generations. Card projection is additive,
  same-runtime/scope and confirmed Cards only. Unfiled records remain available
  through common selection.
- **M02 Guarded placement:** `applyCardPlacement` accepts explicit bounded Card
  refs and current index revision, with the existing placement grammar mapped
  from memoryId to cardId. Max 5 Cards and 3 parents per item, matching the reused
  validator rather than claiming a wider untested limit. All or nothing; wrong
  scope, stale Card/topic/index refs or unsupported source state refuse.
  Classification/filing is organization, not confirmation or adoption.
- **M03 Source-bound labels:** topic titles record the exact supporting Card
  revisions. Changed/unavailable/deleted support hides stale derived titles and
  memberships immediately. No copied Card/source body in index tables. Changing
  filing does not rewrite Card authorship or evidence meaning.
- **M04 Mapping:** same-namespace, same-level Memory↔Card topic mappings have
  proposed/active/removed states, CAS and both endpoint/index versions.
  Activation/refresh/removal requires exact trusted explicit-user authority.
  Stale endpoints/indexes stop navigation until reviewed refresh. Max 16 active
  incident mappings per topic, bounded pages; no cross-level/cross-scope merge,
  permission expansion or inference of evidence support. Removed mappings do
  not reactivate.
- **M05 Bounded and optional:** whole-envelope 64 KiB, default20/max50 paging,
  authenticated cursors bound to store/scope/type/parent/generations.
  Incomplete scans explicitly report partial coverage. This version exposes
  mappings for explicit navigation; it does not claim implicit graph expansion
  in literal selection, generated summaries or measured retrieval improvement.
- **M06 Integration:** exact installed core/MCP can map both types and file an
  inspected Card with a bounded organization grant. Mapping activation stays a
  trusted host API until a separately verified user-action UI exists; MCP does
  not mint explicit-user authority. Test current/history retrieval before/after
  filing, stale/deleted source, mapping activation/revocation/staleness,
  scope isolation, restart, migrations and old Memory map compatibility on both
  Node versions. Independent dual review and final combined gates still apply.
- **M07 Reviewed topic recovery:** `refreshCardTopic` takes the exact existing
  topic ID/revision, expected Card index revision, an explicitly supplied title
  and 1–5 exact eligible Card refs under a bounded organization grant. Replace
  title-support bindings atomically, preserve the topic ID/level and refuse
  stale/foreign refs or a canonical title collision. Advance topic/index
  versions without editing Card content/applicability or auto-activating a
  mapping. Existing guarded hierarchy references follow the refreshed topic;
  changed Card memberships still require explicit placement. Test edit/rebind →
  stale topic → refresh same topic → place fresh Card → explicit mapping review,
  including CAS, authority callback races, replay, restart and installed MCP.

The M07 addition addresses an independently reproduced P2 on integrated
candidate `6e43240`: stale topic bindings had no recovery path, while replacing
the same title was correctly refused as a duplicate. It is a lifecycle repair,
not permission to reuse stale labels or silently refresh mapping authority.

## Observed implementation checkpoint

The first delivery diff is **L01–L08 only**, based on `9a00e82`. Its runtime
implementation is `08dfe24558e5de7ce203c6ab61af1fc514b8a079`; the primary adds
this acceptance record and the installed-artifact manifest/compatibility
updates. H/R/M above remain separately reviewable implementation packets,
not completed claims in the first delivery.

| Owner / model / effort | Observed evidence | Remaining gate |
| --- | --- | --- |
| Source worker / GPT 6.1 Sol / high | Both Node 22.16 and 24.15: 35 Card/source cases, 192 relevant regression cases and the synthetic close/reopen example; actual exit 0 for each | Independent fixed-diff review |
| Primary acceptance | Node 22.16: 35 Card/source cases and installed note compatibility (1 case); Node 24.15: 36 Card/source/installed cases and full core regression (1,171 cases); actual exit 0, no skipped cases | Generic/artifact matrix and latest-commit CI |
| Primary acceptance | Root validation, Claude plugin validation and the owned-runner private-Card example: actual exit 0 | No paid or semantic result claimed |

Source tests exercise real synthetic SQLite stores and processes. Installed
tests independently compare archive entries and runtime module bytes with the
source manifest. The primary's packaging edits are integration corrections,
not a separate engine implementation. The owned test runner removes only its
new scratch; no historical temporary directories or user stores were cleaned.

The existing MCP **development-only** client dependency has an npm high-severity
OAuth advisory; the current checks use synthetic keyless stdio, not OAuth.
`npm audit --prefix adapters/mcp --omit=dev --json` reported zero runtime
vulnerabilities (exit 0). The full dev audit returned exit 1. No forced SDK
upgrade or claim of a clean development dependency audit is included here.
