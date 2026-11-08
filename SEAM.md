# Shared Card lineage v1 host seam

Unmigrated stores have no public API signature, grant, output, statement or
behavior change. Opening a store does not migrate it. The existing installer
legacy-policy gate remains closed: the installer and CLI do not select lineage.
The engine Document, job, manifest, automatic-read and aggregate APIs are absent.

The following changes apply only after explicit offline migration:

| Public engine surface | Installed lineage-v1 behavior |
| --- | --- |
| `migrateCardLineage` from `core/content-safety-migration.mjs` | New offline API. Takes the existing migration envelope (`path`, independent `backupPath`, expected `storeId`/`base`, all quiescence attestations); an already suppressed store also requires its expected `suppressionDomain`. Only bases 23/33 are accepted. Preserves receipt-time selection and the suppression domain. Returns the installed tuple and legacy classification counts. Failure rolls back. |
| Existing-store content-safety pin | `cardLineageRevision: 1` is accepted only for the exact complete v1 package on family 52/base 23 or family 53/base 33, suppression revision 1 and receipt-time bit 0/1. No engine column is accepted. |
| All private Card mutation methods, including source-note and organization mutations | Authority requests add `auditVersion: 'card-action-audit-v1'`. The trusted grant must add that value, `actorId`, canonical ISO `authorizedAt` and `authorizationKind` to its existing closed fields. Audit fields come from the host authority, never caller input. Recheck preserves the grant and generation. Read grants keep their existing grammar. |
| Card mutation replay / `inspectCardOperation` | New mutation claims are owner/action-wide, bound to namespace, method, target, actor and payload. Matching retries retain the first timestamp. Conflicting claims or legacy receipts without trusted actor evidence refuse replay. Stored operation outputs retain their existing public shape. |
| `createCardDraft`, `editCardDraft`, `editKnowledgeCard`, `confirmCardDraft` | Drafts start at body revision 1. Title/body changes allocate a new body; binding-only edits union durable sources. Confirmation preserves the body/provenance identity. Explicit human `authored-input`, `keep-as-own` or `user-rewrite` authority can establish own writing; keep/rewrite always allocates a new body, including identical bytes. Ordinary operation authority cannot establish own writing. Empty presentation bindings do not establish authorship. |
| `forget`, `correct`, `deleteConversation`, `deleteSourceNote` and Raw exclusion paths | Source privacy commits even when a dependent draft/confirmed Card is already denied. Retains dependent state/body bytes while updating invalidation metadata; canonical denial hides that body everywhere. Real write/COMMIT failures still fail and roll back. |
| Card direct/list/source/evidence/history/organization/context/semantic/role/method surfaces | The maximum body and latest cumulative provenance, exact byte commitments, authorization and complete source ancestry are required. Missing/unknown lineage denies content and identifier-bearing metadata, including at zero suppression facts. Final publication checks detect same-body source growth across gaps even when Card/Memory epochs are unchanged. Intact supersession remains available to history; correction does not. Standalone authorized sources remain independent reads. |
| Legacy authored Cards | Canonical legacy observations are seeded with unknown provenance and positive evidence only. Their title/body bytes remain unchanged, but their old body is denied until a complete new body revision. Surviving or empty bindings are never inferred to be complete or own writing. |
| `isSuppressed` | A negative Card answer can now be established only by the same complete sealed body and the supplied full ancestor closure. Unknown/missing lineage cannot establish a negative answer. The existing input/grant grammar is unchanged. |

The exact affected method inventory is:

- Audited Card mutations (14): `submitSourceNote`, `deleteSourceNote`,
  `createCardDraft`, `editCardDraft`, `confirmCardDraft`, `cancelCardDraft`,
  `editKnowledgeCard`, `deleteKnowledgeCard`, `applyCardPlacement`,
  `refreshCardTopic`, `proposeEvidenceMapping`, `reviewEvidenceMapping`,
  `declareCardCurrentDependencies`, `revalidateCardCurrentDependencies`.
- Card-bearing reads and audit outputs (9): `getCard`, `listCards`,
  `inspectCardOperation`, `listCardEffects`, `selectEvidence`, `fetchEvidence`,
  `revalidateEvidence`, `mapEvidence`, `listEvidenceMappings`. Standalone
  `getSource`, `resolveSourceReferences` and note usage retain their independent
  source authorization and output contracts.
- Context publication and delivery (5): `findCandidates`, `refreshContextIndex`,
  `fetchCandidateEvidence`, `contextRead`, `getContextIndexStatus`.
- Method reason/attachment checks and publication cursors (18):
  `importMethodVersion`, `getMethodVersion`, `listMethodManifest`,
  `readMethodFile`, `listMethodPackages`, `listMethodVersions`,
  `compareMethodVersions`, `deleteMethodVersion`, `deleteMethodPackage`,
  `listMethodEffects`, `getMethodPackageUsage`, `adoptMethodVersion`,
  `disableMethodBinding`, `resolveMethod`, `resolveMethodsForRole`,
  `listMethodBindingEvents`, `checkMethodReasonRefs`, `readMethodAttachmentBytes`.
  These keep the existing method grant grammar; Card references require the
  canonical predicate and cursors include the namespace lineage fence.
- Other affected entries: `readRoleTaskContext`, `isSuppressed`, `forget`,
  `correct`, `supersede`, `deleteConversation`, `setRawCaptureControl`,
  `migrateCardLineage`, and the existing-store openers `openMemoryCore`,
  `openRawCaptureCore`, `openMemoryReader`, `openContextReader`,
  `openContextProductReader`, `openContextIndexMaintainer`,
  `openContentSuppressionReader` when accepting the installed pin. Supersession retains intact
  history while current intent still requires current support.

The in-tree MCP service grant producer supplies a trusted service actor/time for
permitted operation-only mutations. The terminal review command supplies its
authenticated local human actor/time after approval. Embedded hosts must supply
the mutation audit variant before selecting an installed lineage store.

An installed-lineage `editCardDraft` with empty declared bindings requests the
explicit-user action class so a host can issue a dedicated human own-writing
grant. An operation-only grant still preserves the old derived source union;
empty bindings alone never confer authorship.

No product-side repository was inspected. Installer policy approval and any
host-side grant rollout remain coordination decisions; neither is inferred from
the availability of the offline core migration.
