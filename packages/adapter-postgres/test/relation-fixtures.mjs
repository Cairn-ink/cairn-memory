import assert from "node:assert/strict";
import { coreDigest, decideWrite, planDuplicateMerge } from "@cairn-ink/core";
import { query } from "../src/index.mjs";

// The hosted hash key is owner-wide. K-REL-6 needs distinct rows in both
// namespaces and only uses the supplied text as fixture data.
export function withDistinctNamespaceText(memories) {
  return {
    ...memories,
    async insert(tx, scope, row, receipts, nowMs) {
      if (scope.namespace === null) return memories.insert(tx, scope, row, receipts, nowMs);
      const text = `${row.text} (project fixture)`;
      const { value } = await coreDigest(text);
      return memories.insert(tx, scope, { ...row, text, textHash: `sha256:${value}` }, receipts, nowMs);
    },
  };
}

// K-REL-10/11 cover the memory-write portion of a single capture finish. The
// hosted finish port is a separate slice. Drive the real memory ports using
// the core planner and the source of a real, dispatched Postgres claim.
export function withRelationCaptureFinish(capture, memories) {
  return {
    ...capture,
    async finish(tx, token, items) {
      assert.equal(items.length, 1);
      const { rows: [claim] } = await query(tx, `SELECT client, session_id FROM capture_events
        WHERE user_id = $1 AND core_lease_token = $2 AND core_dispatched AND core_namespace IS NULL`, [tx.owner, token]);
      assert.ok(claim, "Expected a dispatched personal capture");
      const scope = { owner: tx.owner, namespace: null };
      const source = { kind: "capture", client: claim.client, sessionId: claim.session_id };
      const [{ content: text, receipts, ...item }] = items;
      const row = { ...item, text, source, origin: "inferred" };
      const policy = await memories.readWritePolicy(tx, scope, [{
        textHash: row.textHash, digests: row.digests, embedding: row.embedding?.vector,
      }], source, "full");
      const decision = decideWrite(policy, 0);
      const now = Date.now();
      const written = [];
      if (decision.status === "saved") {
        const { id, revision } = await memories.insert(tx, scope, row, receipts, now);
        written.push({ id, revision, outcome: "inserted" });
      } else if (decision.status === "duplicate") {
        const { id } = decision;
        const existing = await memories.get(tx, scope, id);
        assert.ok(existing);
        const { merge } = planDuplicateMerge(existing, row);
        written.push({ id, ...await memories.touchDuplicate(tx, scope, id, receipts, merge, now) });
      }
      const { rows: [state] } = await query(tx, "SELECT index_revision FROM core_owner_state WHERE user_id = $1", [tx.owner]);
      return { memories: written, duplicateCount: Number(decision.status === "duplicate"),
        suppressedCount: Number(decision.status === "suppressed"), indexRevision: Number(state?.index_revision ?? 0), counters: {} };
    },
  };
}
