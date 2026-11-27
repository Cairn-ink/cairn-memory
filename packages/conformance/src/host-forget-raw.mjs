// @ts-nocheck -- Node-only test helper shared by the adapter suites; the conformance typecheck has no Node types.
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createMemoryService } from "@cairn-ink/core/service";
import { syntheticHooks } from "./host-write-hooks-cases.mjs";

export const scope = { owner: "forget-owner", namespace: null };
export const sessionless = { kind: "mcp", client: null, sessionId: null };
export const text = "The archivist keeps the blue folio beneath the copper lantern.";
export const unrelated = "Three stools stand beside the front window.";
export const root = { client: "fixture", sessionId: "root" };
export const fork = { client: "fixture", sessionId: "fork" };

export const clock = {
  nowMs: () => 12_345, monotonicMs: () => 12_345,
  sha256Hex: value => createHash("sha256").update(value).digest("hex"),
  hmacHex: (key, value) => createHmac("sha256", key).update(value).digest("hex"),
};

export function service(storage, embedder = null, hostWriteHooks) {
  return createMemoryService({ storage, clock, embedder, hostWriteHooks,
    model: { model: "fixture", contextWindow: 32_768, countTokens: () => 1,
      async call() { assert.fail("Raw forget should not invoke the model"); } },
    gate: { assertOpen() {} }, tokens: { countTokens: () => 1 },
    config: { explicitWindowFence: { enabled: false } } });
}

export function makeRow(sessionId, messageId, occurredAtMs, content, role = "user") {
  return { client: "fixture", sessionId, messageId, role, occurredAtMs, content };
}

export function sourceTuple({ client, sessionId, messageId, role, occurredAtMs }) {
  return { client, sessionId, messageId, role, occurredAtMs };
}

export async function archive(storage, { client, sessionId, messageId, role, occurredAtMs, content }) {
  const capture = { scope, client, sessionId, eventId: messageId, payloadDigest: "0".repeat(64) };
  const message = { id: messageId, role, occurredAtMs, content };
  await storage.uow.run(scope.owner, { pauseLock: true }, async tx => {
    assert.deepEqual(await storage.raw.archive(tx, capture, [message]), { archived: 1 });
  });
}

const address = ({ client, sessionId, messageId }) => JSON.stringify([client, sessionId, messageId]);

function tombstoningHost(table, cards) {
  const bound = new Map(cards.map(row => [address(row), row]));
  let context;
  const hooks = syntheticHooks({
    async onForget(tx, ctx) {
      context = ctx;
      for (const source of ctx.affectedMessages) {
        const key = address(source);
        if (bound.has(key)) await table.put(tx, ctx.scope, key, { state: "tombstone" });
      }
    },
  });
  return { hooks, context: () => context };
}

async function tombstones(table, cards) {
  const states = await Promise.all(cards.map(row => table.inspect(scope, address(row))));
  return states.filter(state => state?.state === "tombstone").length;
}

export function rawForgetCases(test, fixture) {
  test("forget reports a containing Raw row without receipts or document cards", async t => {
    const f = await fixture(t);
    const row = makeRow("another-session", "turn", null, f.containingText);
    await archive(f.storage, row);
    const host = tombstoningHost(f.table, [row]);
    const api = f.createService(host.hooks);
    const saved = await api.save(scope, text, sessionless);
    assert.equal(saved.status, "saved");
    assert.equal((await api.forget(scope, saved.item.id, sessionless)).status, "forgotten");
    assert.deepEqual(await f.rawRows(), []);
    const ctx = host.context();
    assert.deepEqual(ctx.priorReceipts, []);
    assert.deepEqual(ctx.affectedSessions, []);
    assert.deepEqual(ctx.affectedMessages, [sourceTuple(row)]);
    assert.equal(await tombstones(f.table, [row]), 1);
  });

  test("forget reports Raw rows erased through the proven session closure", async t => {
    const f = await fixture(t);
    const rootRow = makeRow(root.sessionId, "turn", null, unrelated);
    const forkRow = makeRow(fork.sessionId, "turn", 1234, unrelated, "assistant");
    const retained = makeRow("unrelated", "turn", 5678, unrelated);
    const cards = [rootRow, forkRow, retained];
    for (const row of cards) await archive(f.storage, row);
    await f.proveFork();
    const host = tombstoningHost(f.table, cards);
    const api = f.createService(host.hooks);
    const source = { kind: "web", ...root };
    const saved = await api.save(scope, text, source);
    assert.equal(saved.status, "saved");
    assert.equal((await api.forget(scope, saved.item.id, source)).status, "forgotten");
    assert.deepEqual(await f.rawRows(), [sourceTuple(retained)]);
    const ctx = host.context();
    assert.deepEqual(ctx.priorReceipts, []);
    assert.deepEqual(new Set(ctx.affectedSessions), new Set([
      { ...root, effect: "erase" }, { ...fork, effect: "erase" },
    ]));
    assert.deepEqual(ctx.affectedMessages, [sourceTuple(forkRow), sourceTuple(rootRow)]);
    assert.equal(await tombstones(f.table, cards), 2);
  });

  test("forget orders all deleted Raw tuples and deduplicates predecessor selectors", async t => {
    const f = await fixture(t);
    const later = makeRow("z-session", "same-id", 50, f.containingText, "assistant");
    const earlier = makeRow("a-session", "same-id", 1234, text);
    const cards = [later, earlier];
    for (const row of cards) await archive(f.storage, row);
    const host = tombstoningHost(f.table, cards);
    const api = f.createService(host.hooks);
    const saved = await api.save(scope, text, sessionless, "fact", { receipt: sourceTuple(earlier) });
    assert.equal(saved.status, "saved");
    assert.equal((await api.forget(scope, saved.item.id, sessionless)).status, "forgotten");
    assert.deepEqual(await f.rawRows(), []);
    const ctx = host.context();
    assert.equal(ctx.priorReceipts.length, 1);
    assert.deepEqual(ctx.affectedMessages, [sourceTuple(earlier), sourceTuple(later)]);
    assert.equal(await tombstones(f.table, cards), 2);
  });
}
