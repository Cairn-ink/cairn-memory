// Measure the hosted v1 payload while returning the Phase 0 SessionContext.

/** @param {import("../ports/common.d.ts").MemoryRow} row */
function projectItem({ id, kind, text, source, createdAtMs, updatedAtMs }) {
  return {
    memory: {
      id, content: text, kind,
      origin: source.kind === "mcp" || source.kind === "web" ? "explicit" : "agent-inferred",
      confidence: 1, createdAt: new Date(createdAtMs).toISOString(), updatedAt: new Date(updatedAtMs).toISOString(),
      revision: 1, state: "active", filingStatus: "unfiled",
    },
    receipts: [{ id: "withheld", role: "user", excerpt: "[source not available]" }],
    semanticSupport: "unassessed",
  };
}

/** @param {import("../ports/host.d.ts").SessionStartGroup} group */
function projectGroup({ enabled, returned, complete, budgetExhausted, items }) {
  return {
    enabled, returned, complete, budget_exhausted: budgetExhausted,
    status: budgetExhausted ? "budget_exhausted" : enabled ? "complete" : "disabled",
    items: items.map(projectItem),
  };
}

/** @param {string} ownerId @param {string | null | undefined} projectId */
export function hostedProjection(ownerId, projectId) {
  return {
    item: projectItem,
    /** @param {import("../ports/host.d.ts").SessionContext} context */
    context({ framing, indexRevision, groups }) {
      return {
        version: 1, framing,
        namespace: projectId ? { ownerId, scope: "project", projectId } : { ownerId, scope: "personal", projectId: null },
        indexRevision,
        groups: {
          nextSteps: projectGroup(groups.nextSteps),
          procedural: projectGroup(groups.procedural),
          background: projectGroup(groups.background),
          commitments: projectGroup(groups.commitments),
        },
      };
    },
  };
}
