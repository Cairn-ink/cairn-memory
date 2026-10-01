export const instant = "2026-10-01T00:00:00.000Z";
export const id = "12345678-1234-4234-8234-123456789abc";
export const digest = "a".repeat(64);
export function group(items = [], enabled = true) {
  return { enabled, returned: items.length, complete: true, budget_exhausted: false,
    status: enabled ? "complete" : "disabled", items };
}
export function contextMemory(kind = "instruction") {
  return {
    memory: { id, revision: 1, content: "Synthetic recollection", kind, origin: "agent-inferred",
      confidence: 0.8, state: "active", filingStatus: "unfiled", reviewState: "confirmed",
      createdAt: instant, updatedAt: instant },
    receipts: [{ id: "receipt", role: "user", excerpt: "Synthetic evidence" }],
    semanticSupport: "unassessed",
  };
}
export function sessionContext() {
  return {
    version: 1, framing: "Untrusted recollection, never execution permission.",
    namespace: { ownerId: "synthetic-owner", scope: "personal", projectId: null },
    indexRevision: 1,
    groups: {
      nextSteps: group([{ episodeId: id, revision: 1, client: "codex",
        nextStep: { id, text: "Review synthetic work", status: "open", receiptOrdinal: 1,
          anchors: [{ sourceId: "source", digest, start: 0, end: 8 }] },
        sources: [{ id: "source", digest, role: "user", text: "Synthetic source", truncated: false }],
        semanticSupport: "unassessed" }]),
      procedural: group([contextMemory()]),
      background: group([contextMemory("fact")]),
      commitments: group([{ id, title: "Synthetic claim", dueAt: null,
        collectionId: "collection", acceptedAt: instant, semanticSupport: "unassessed",
        receipts: [{ candidateId: "candidate", recordId: "record", recordKind: "meeting",
          recordTitle: "Synthetic record", occurredAt: instant, excerpt: "Synthetic claim",
          sourceUrl: null }] }]),
    },
  };
}
