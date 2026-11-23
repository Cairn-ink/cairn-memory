// Provisional fact matching. This module will call the privacy module's policy functions when they exist.
import { SUPPRESSION_DISTANCE } from "@cairn-ink/core";
import { cosineDistance } from "./cosine.mjs";

/** @typedef {import("@cairn-ink/core").SuppressionFact} SuppressionFact */
/** @typedef {import("@cairn-ink/core").TextFact} TextFact */
/** @typedef {import("@cairn-ink/core/ports").DuplicateQuery} DuplicateQuery */
/** @typedef {import("@cairn-ink/core/ports").Scope} Scope */
/** @typedef {import("@cairn-ink/core/ports").MemoryRow} MemoryRow */
/** @typedef {import("@cairn-ink/core/ports").SourceRef} SourceRef */

/** @param {ReadonlyMap<string, import("@cairn-ink/core").StoredFact>} facts @param {Scope} scope @param {boolean} vectorSuppression */
export function factPolicy(facts, scope, vectorSuppression) {
  /** @type {SuppressionFact[]} */
  const scoped = [];
  for (const { fact } of facts.values()) {
    if (fact.namespace === undefined || fact.namespace === scope.namespace) scoped.push(fact);
  }
  const texts = scoped.filter((fact) => fact.kind === "text");

  /** @param {TextFact} fact @param {DuplicateQuery} query @param {"hash" | "full"} mode */
  function matchesText(fact, query, mode) {
    const hash = query.textHash.replace(/^sha256:/, "");
    const legacy = query.legacyHash?.replace(/^sha256:/, "");
    if (fact.text.digests.some(({ value }) => value === hash || value === legacy)) return true;
    const vector = fact.text.embedding;
    if (mode === "full" && fact.mode === "full" && vectorSuppression && vector && query.embedding) {
      const distance = cosineDistance(vector, query.embedding);
      return distance !== undefined && distance <= SUPPRESSION_DISTANCE;
    }
    return false;
  }

  return {
    /** @param {MemoryRow} row */
    hides(row) {
      return scoped.some((fact) => fact.kind === "identity" && fact.memoryId === row.id &&
        (fact.throughRevision === undefined || row.revision <= fact.throughRevision)) ||
        texts.some((fact) => matchesText(fact, { textHash: row.textHash, embedding: row.embedding?.vector }, "full"));
    },
    /** @param {DuplicateQuery} query @param {"hash" | "full"} mode */
    blocks(query, mode) {
      return texts.some((fact) => matchesText(fact, query, mode));
    },
    /** @param {SourceRef} source */
    blocksSession(source) {
      return source.client !== null && source.sessionId !== null &&
        scoped.some((fact) => fact.kind === "session" && "sessionId" in fact.session &&
          fact.session.client === source.client && fact.session.sessionId === source.sessionId);
    },
  };
}
