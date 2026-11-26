import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { factIncarnationBody } from "../../core/src/index.mjs";
import { createPostgresMemoryCandidates, createPostgresUnitOfWork, factSlot } from "../src/index.mjs";

const owner = "vector-budget-owner";
const scope = { owner, namespaces: [null] };
const axis = new Float32Array(1536);
axis[0] = 1;

function candidate(i, { distance, updated = i, hidden = false }) {
  return { id: String(i).padStart(4, "0"), core_namespace: null, revision: 1, updated_us: String(updated),
    distance, vector_hidden: hidden, logical_hash: `sha256:${"1".repeat(64)}` };
}

async function vector(candidates, depth, annPools = []) {
  const hasSuppression = candidates.some(row => row.vector_hidden);
  const body = { kind: "text", namespace: null, origin: "forget", mode: "full", text: {
    digests: [{ alg: "sha256", keyId: null, pipeline: "core", redactionVersion: 1, value: "2".repeat(64) }],
    embedding: Array.from(axis),
  } };
  const fact = { ...body, owner, actionId: "forget" };
  const facts = hasSuppression ? [{
    fact_id: "vector-fact", action_id: fact.actionId, epoch: "1", created_at_us: "0", body,
    kind: body.kind, origin: body.origin, mode: body.mode, slot: factSlot(fact),
    incarnation: createHash("sha256").update(factIncarnationBody(fact)).digest("hex"),
  }] : [];
  const uow = createPostgresUnitOfWork({
    async connect() {
      return {
        release() {},
        async query(sql, values) {
          const result = rows => ({ command: "SELECT", rows });
          if (sql.startsWith("WITH owner_state")) return result(facts);
          if (sql.includes("AS eligible")) return result([{ eligible: candidates.length, embedded: candidates.length }]);
          if (sql.includes("current_setting")) return result([{ enable_sort: "on" }]);
          if (sql.includes("vector_norm(embedding) = 0")) return result([]);
          if (sql.startsWith("WITH candidates")) {
            if (hasSuppression) assert.match(sql, /FROM vector_facts f/u);
            const size = values[8];
            const sorted = candidates.slice().sort((a, b) => a.distance - b.distance);
            const order = (a, b) => a.distance - b.distance || Number(b.updated_us) - Number(a.updated_us) ||
              (a.id < b.id ? 1 : -1);
            if (sql.includes("ORDER BY embedding <=> $8::vector LIMIT $9")) {
              assert.match(sql, /ORDER BY c\.distance \+ 0, c\.updated_at DESC, c\.id COLLATE "C" DESC/u);
              annPools.push(values[9]);
              const excluded = new Set(values[9]);
              return result(candidates.filter(row => !excluded.has(row.id)).slice(0, size).sort(order));
            }
            if (!sql.includes("ROWS WITH TIES")) return result(sorted.slice(values[9], values[9] + size));
            assert.match(sql, /ORDER BY c\.distance, c\.updated_at DESC, c\.id COLLATE "C" DESC/u);
            const after = values[9];
            const pending = sorted.filter(row => after === null || row.distance > after);
            const cutoff = pending[size - 1]?.distance;
            return result(pending.filter(row => cutoff === undefined || row.distance <= cutoff).sort(order));
          }
          return { command: sql === "COMMIT" || sql === "DISCARD ALL" ? sql : "SET", rows: [] };
        },
      };
    },
  });
  return uow.run(owner, { readOnly: true },
    tx => createPostgresMemoryCandidates().vector.vector(tx, scope, axis, "test", depth));
}

test("P1-6 and P1-11 budget cannot report complete after skipping the only visible vector", async () => {
  const candidates = Array.from({ length: 3200 }, (_, i) => candidate(i, { distance: i / 4000, hidden: true }));
  const visible = candidate(3200, { distance: 0.9 });
  const annPools = [];
  const result = await vector([...candidates, visible], 50, annPools);
  assert.equal(result.coverage.eligible, 1);
  assert.equal(result.coverage.embedded, 1);
  assert.equal(annPools.length, 8);
  assert.deepEqual(result.rows, []);
  assert.equal(result.coverage.complete, false);
});

test("P1-11 depth one ranks an equal-distance group spanning an exact page by timestamp and ID", async () => {
  const candidates = Array.from({ length: 8 }, (_, i) => candidate(i, { distance: 0.5 }));
  candidates[6].updated_us = candidates[7].updated_us;
  const annPools = [];
  const result = await vector(candidates, 1, annPools);
  assert.equal(annPools.length, 0);
  assert.equal(result.coverage.complete, true);
  assert.deepEqual(result.rows.map(({ ref }) => ref.id), [candidates[7].id]);
});

test("an ANN extension re-ranks tied IDs from both pools", async () => {
  const hidden = Array.from({ length: 399 }, (_, i) => candidate(i, { distance: 0.5, hidden: true }));
  const first = candidate(900, { distance: 0.5, updated: 1 });
  const later = candidate(400, { distance: 0.5, updated: 1 });
  const newest = candidate(401, { distance: 0.5, updated: 2 });
  const annPools = [];
  const result = await vector([...hidden, first, later, newest], 2, annPools);
  assert.equal(annPools.length, 2);
  assert.deepEqual(annPools[0], []);
  assert.equal(annPools[1].length, 400);
  assert.deepEqual(new Set(annPools[1]), new Set([first.id, ...hidden.map(row => row.id)]));
  assert.deepEqual(result.rows.map(({ ref }) => ref.id), [newest.id, first.id]);
  assert.deepEqual(result.coverage, { eligible: 3, embedded: 3, complete: true });
});
