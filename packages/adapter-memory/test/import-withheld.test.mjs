import assert from "node:assert/strict";
import { test } from "node:test";
import { engineLegacyDigest } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { serviceFake } from "../../core/test/helpers/service-fake.mjs";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { IMPORT_ARCHIVE_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const mutants = [
  {
    name: "ignores withheld positions", id: "K-IMP-RAW-8",
    failure: /Import must archive only the positions outside the withheld list/,
    change(raw) {
      const { importArchive } = raw;
      raw.importArchive = (tx, scope, session, messages) => importArchive(tx, scope, session, messages);
    },
  },
  {
    name: "drops withheld positions before checking for forks", id: "K-IMP-RAW-7",
    failure: /A withheld anchor must fence the whole fork/,
    change(raw) {
      const { importArchive } = raw;
      raw.importArchive = async (tx, scope, session, messages, { withheld = [] } = {}) => {
        const retained = messages.filter((_, position) => !withheld.includes(position));
        const counts = await importArchive(tx, scope, session, retained);
        return { ...counts, withheld: counts.withheld + withheld.length };
      };
    },
  },
  {
    name: "counts withheld positions twice", id: "K-IMP-RAW-9",
    failure: /Every import position must contribute exactly one outcome/,
    change(raw) {
      const { importArchive } = raw;
      raw.importArchive = async (...args) => {
        const counts = await importArchive(...args);
        return { ...counts, withheld: counts.withheld + (args[4]?.withheld?.length ?? 0) };
      };
    },
  },
  {
    name: "indexes withheld positions without storing them", id: "K-IMP-RAW-8",
    failure: /Raw search must exclude the withheld row/,
    change(raw) {
      const { importArchive, raw: search } = raw;
      const indexed = [];
      raw.importArchive = async (tx, scope, session, messages, options) => {
        const counts = await importArchive(tx, scope, session, messages, options);
        for (const position of options?.withheld ?? []) {
          const { id: messageId, role, content, occurredAtMs } = messages[position];
          indexed.push({ ...session, messageId, role, content, occurredAtMs, score: 1,
            ref: { type: "raw", namespace: scope.namespace, id: messageId } });
        }
        return counts;
      };
      raw.raw = async (tx, scope, query, intent, options) => {
        const result = await search(tx, scope, query, intent, options);
        const leaked = indexed.filter(({ content }) => content === query);
        return { ...result, segments: [...result.segments, ...leaked] };
      };
    },
  },
];

for (const { name, id, failure, change } of mutants) {
  test(`${id} rejects an adapter that ${name}`, async () => {
    const testCase = IMPORT_ARCHIVE_CASES.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    assert.equal(await runCase(rawFactory(), testCase), null);
    const factory = rawFactory({ create(options) {
      const adapter = createMemoryAdapter(options);
      change(adapter.raw);
      return adapter;
    } });
    await assert.rejects(runCase(factory, testCase), failure);
  });
}

test("raw import preserves core withholding and uses a withheld anchor to refuse a fork", async () => {
  const scope = { owner: "owner", namespace: null };
  const source = { client: "client", sessionId: "source" };
  const wording = `The gate config is {"client_secret": "${"example".repeat(5)}"}.`;
  const anchor = { id: "anchor", role: "user", content: wording, occurredAtMs: 10 };
  const preparedAnchor = { ...anchor, content: 'The gate config is {"client_secret": "[REDACTED]"}.' };
  const turn = { id: "turn", role: "user", content: "The gate is open.", occurredAtMs: 20 };

  const storage = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const service = createMemoryService({ ...serviceFake().deps, storage });
  const { raw, uow, harness } = storage;
  await harness.seedFact(scope.owner, {
    ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forget-text",
    text: { digests: [await engineLegacyDigest(wording)] },
  });
  assert.deepEqual(await service.importRawMessages(scope, [{ ...source, messages: [anchor, turn] }]),
    { imported: 1, duplicate: 0, suppressed: 1, invalid: 0 });

  const key = { ...source, scope, eventId: "event", payloadDigest: "a".repeat(64) };
  await uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    await raw.recordLineage(tx, key, [preparedAnchor]);
    await raw.fenceSession(tx, scope, source);
    await raw.deleteConversation(tx, scope, source);
  });
  const fork = { ...source, sessionId: "fork", messages: [turn, anchor] };
  assert.deepEqual(await service.importRawMessages(scope, [fork]),
    { imported: 0, duplicate: 0, suppressed: 2, invalid: 0 });
  assert.deepEqual((await service.listRawMessages(scope, { limit: 10, cursor: null })).items, []);
});

test("raw import copies withheld descriptors once before asynchronous eligibility checks", async () => {
  const scope = { owner: "owner", namespace: null };
  const session = { client: "client", sessionId: "session" };
  const batch = ["cedar", "maple"].map((content) => ({ id: content, role: "user", content, occurredAtMs: 10 }));
  const { raw, uow, harness } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const positions = [1];
  const reads = [];
  const target = { withheld: new Proxy(positions, {
    get(array, key) {
      reads.push(key);
      return Reflect.get(array, key);
    },
  }) };
  const options = new Proxy(target, {
    get(object, key) {
      reads.push(key);
      return Reflect.get(object, key);
    },
  });
  await uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    const pending = raw.importArchive(tx, scope, session, batch, options);
    positions[0] = 0;
    target.withheld = [0];
    assert.deepEqual(await pending, { archived: 1, existing: 0, withheld: 1 });
  });
  assert.deepEqual(reads, ["withheld", "length", "0"]);
  const before = await harness.dump();
  assert.deepEqual(before[0].rawRows.map(({ messageId }) => messageId), ["cedar"]);

  let accessorReads = 0;
  const accessor = () => { accessorReads++; return [0]; };
  const invalid = [
    null, [], 1, { extra: true }, Object.create({ withheld: [0] }), { get withheld() { return accessor(); } },
    { withheld: Object.defineProperty([0], "0", { get: accessor }) },
    new Proxy({ withheld: [0] }, { get: () => [1] }),
    { withheld: new Proxy([0], { get: (array, key) => key === "0" ? 1 : Reflect.get(array, key) }) },
  ];
  await uow.run(scope.owner, { pauseLock: true }, async (tx) => {
    for (const options of invalid) {
      await assert.rejects(raw.importArchive(tx, scope, session, batch, options), { code: "invalid_input" });
    }
  });
  assert.equal(accessorReads, 0);
  assert.deepEqual(await harness.dump(), before);
});
