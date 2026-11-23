import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

test("find keeps the memory layer ok when a failed query embed falls back to lexical search", async () => {
  const row = memory("lexical-match");
  const { deps, hooks, calls } = serviceFake({ rows: [row], recall: true, semantic: true });
  hooks.embedQuery = () => { throw new CoreError("embedding_failed"); };
  hooks.lexicalScore = () => 1;

  const result = await createMemoryService(deps).find(scope, "query", { kinds: ["memory"] });

  assert.deepEqual(result.memories, [row]);
  assert.deepEqual(result.layers.memory, { status: "ok", count: 1 });
  assert.equal(calls.filter(([method]) => method === "embedQuery").length, 1);
  assert.equal(calls.some(([method]) => method === "vector.vector"), false);
});

const predecessor = "The parcel is on the shelf.";
const replacement = "The parcel was moved to the office.";
const search = { mode: "search" };
const source = { kind: "web", client: null, sessionId: null };

function correctionFixture() {
  const row = {
    ...memory("parcel", { text: predecessor }),
    textHash: "sha256:" + createHash("sha256").update(predecessor.toLowerCase()).digest("hex"),
  };
  const fake = serviceFake({ rows: [row], recall: true, writes: true });
  fake.hooks.lexicalScore = () => 1;
  return { ...fake, row, service: createMemoryService(fake.deps) };
}

const routes = [
  ["recall", async service => (await service.recall(scope, "parcel", search)).items],
  ["query find", async service => (await service.find(scope, "parcel", {})).memories],
  ["no-query find", async service => (await service.find(scope, null, {})).memories],
  ["recent", async service => (await service.recent(scope)).items],
  ["export", async service => (await service.exportMemories(scope)).items],
  ["read", async (service, id) => {
    const result = await service.read(scope, { type: "memory", id });
    assert.equal(result.status, "found");
    return [result.item];
  }],
];

for (const [route, deliver] of routes) {
  test(`${route} withholds the predecessor when correct commits before delivery`, async () => {
    const { service, storage, row, committed } = correctionFixture();
    if (route === "export") {
      // Model a stable index token so the export cursor check does not mask the row-level race.
      const indexToken = "export-position";
      storage.snapshot.stateToken = async () => indexToken;
      storage.snapshot.assertUnchanged = async (_tx, _scope, token) => assert.equal(token, indexToken);
    }
    const run = storage.uow.run;
    let reads = 0;
    let correcting = false;
    storage.uow.run = async (owner, options, fn) => {
      if (!correcting && options.readOnly && ++reads === 2) {
        correcting = true;
        const result = await service.correct(scope, row.id, row.revision, replacement, source);
        correcting = false;
        assert.equal(result.status, "saved");
        assert.equal(result.item.text, replacement);
        assert.equal(result.item.revision, row.revision + 1);
      }
      return run(owner, options, fn);
    };

    const items = await deliver(service, row.id);
    assert.equal(committed(scope.owner).facts.length, 1, "correct committed the predecessor suppression");
    assert.deepEqual(items.map(({ text }) => text), route === "read" ? [replacement] : []);
  });
}

test("recall delivers the row hydrated in the same snapshot as the fence", async () => {
  const { service, storage } = correctionFixture();
  const hydrate = storage.hydrate.hydrate;
  const assertVisible = storage.fence.assertVisible;
  const hydrated = [];
  let fenceTx;
  storage.hydrate.hydrate = async (tx, ...args) => {
    const [{ ref, memory }] = await hydrate(tx, ...args);
    const row = { ...memory };
    hydrated.push({ tx, row });
    return [{ ref, memory: row }];
  };
  storage.fence.assertVisible = async (tx, ...args) => {
    fenceTx = tx;
    return assertVisible(tx, ...args);
  };

  const { items } = await service.recall(scope, "parcel", search);
  assert.equal(hydrated.length, 2);
  assert.notStrictEqual(hydrated[0].tx, fenceTx);
  assert.strictEqual(hydrated[1].tx, fenceTx);
  assert.strictEqual(items[0], hydrated[1].row);
});
