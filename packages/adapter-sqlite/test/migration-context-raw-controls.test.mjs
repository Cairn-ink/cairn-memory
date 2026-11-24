import assert from "node:assert/strict";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { openMemoryCore } from "../../../core/index.mjs";
import { defaultRawOptions } from "../../../core/local-defaults.mjs";
import { rawRequest, splitRaw } from "../../../core/testing/raw-fixtures.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, ok, personal, prepareInput } from "./migration-fixtures.mjs";

const paused = { ...personal, scope: "project", projectId: "orchard" };
const disabled = { ...paused, projectId: "garden" };
const restrictedSamples = [[paused, "apple"], [disabled, "pear"]];
const samples = [...restrictedSamples, [personal, "plum"]];
const readSetFor = namespace => ({ owner: personal.ownerId,
  namespaces: [coreScope(personal).namespace, coreScope(namespace).namespace], accessGenerations: [1, 1] });
const search = { query: "albatross", types: ["memory"], intent: "current", semantic: false, deadlineMs: 5000 };
const readOptions = { capabilities: { contextRead: true, contextRawRead: true } };
const legacyOptions = { rawSearch: false, rawConversations: { ...defaultRawOptions(), interpretation: "host" } };

async function migrate(directory, legacy, name) {
  const input = { ...prepareInput(directory, legacy),
    destination: join(directory, `${name}.sqlite`), backupDirectory: join(directory, `${name}-backup`) };
  await createLegacyBackup(input);
  assert.equal((await migrateLegacyStore(input)).archived.rawMessages, samples.length);
  return openSqliteAdapter(input.destination, readOptions);
}

function service(storage) {
  return createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
}

const rawBodies = result => result.assembly.items.filter(item => item.layer === "Raw").map(item => item.body);
const body = sentinel => `albatross ${sentinel}`;

async function setControls(path, restrict) {
  const engine = openMemoryCore({ path, ...legacyOptions });
  try {
    ok(engine.setCapturePaused({ namespace: paused, expectedGeneration: "initial", paused: restrict }));
    ok(engine.setProjectCapture({ namespace: disabled, expectedGeneration: "initial", enabled: !restrict }));
  } finally {
    await engine.close();
  }
}

test("Context Read withholds Raw from paused and disabled migrated namespaces", async t => {
  const directory = scratch(t);
  const legacy = await fixture(directory, 29, { localPrivacy: true });
  const engine = openMemoryCore({ path: legacy.path, ...legacyOptions });
  const memoryText = "An albatross observation was logged";
  let memory;
  try {
    for (const [namespace, sentinel] of samples) {
      const [message] = splitRaw(body(sentinel), { id: sentinel });
      const { raw } = ok(await engine.captureRaw(rawRequest(message, { namespace, sessionId: sentinel })));
      assert.equal(raw.parts[0].reason, null);
    }
    memory = admit(engine, memoryText);
  } finally {
    await engine.close();
  }

  // Both source copies retain the same store identity. Update the same two
  // controls once in each so the Raw witnesses have matching namespace epochs.
  const enabledLegacy = { ...legacy, path: join(directory, "enabled-legacy.sqlite") };
  copyFileSync(legacy.path, enabledLegacy.path);
  await setControls(enabledLegacy.path, false);
  const enabled = await migrate(directory, enabledLegacy, "enabled");
  const witnesses = new Map();
  try {
    for (const [namespace, sentinel] of restrictedSamples) {
      const readSet = readSetFor(namespace);
      const { turns } = await enabled.uow.run(readSet.owner, { readOnly: true }, tx =>
        enabled.contextRead.raw.search(tx, readSet, search.query, { limit: 24, lexicalOnly: true }));
      assert.deepEqual(turns.map(turn => turn.messageId).sort(), [sentinel, "plum"]);
      witnesses.set(sentinel, turns);
    }
  } finally {
    await enabled.close();
  }

  await setControls(legacy.path, true);
  const restricted = await migrate(directory, legacy, "restricted");
  try {
    const { contextRead } = restricted;
    for (const [namespace, sentinel] of restrictedSamples) {
      const readSet = readSetFor(namespace);
      const control = namespace === paused ? "paused" : "disabled";
      await t.test(`search withholds ${control} Raw`, async () => {
        const api = service(restricted);
        const found = await api.findCandidates(readSet, search);
        const refs = found.items.map(item => item.ref);
        assert.deepEqual(refs.map(ref => ref.id), [memory.id]);
        const fetched = await api.fetchEvidence(readSet, { refs, intent: search.intent });
        assert.deepEqual(fetched.items.map(item => item.text), [memoryText]);
        assert.deepEqual(rawBodies(await api.readContext(readSet, search)), [body("plum")]);
      });
      await t.test(`final delivery refuses a previously enabled ${control} Raw witness`, async () => {
        for (const turn of witnesses.get(sentinel)) {
          // Replay a real search witness so final delivery must check the migrated controls.
          const api = service({ ...restricted, contextRead: { ...contextRead, raw: { ...contextRead.raw,
            search: async () => ({ turns: [turn], coverage: "included" }),
          } } });
          assert.deepEqual(rawBodies(await api.readContext(readSet, search)),
            turn.messageId === "plum" ? [body("plum")] : [], turn.messageId);
        }
      });
    }
  } finally {
    await restricted.close();
  }
});
