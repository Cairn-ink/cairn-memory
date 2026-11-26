import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { disabledText, enabledText, forgottenText, rawImportControlsCase } from "@cairn-ink/conformance/raw-import-controls";
import { openMemoryCore } from "../../../core/index.mjs";
import { createSqliteAdapter } from "../src/adapter.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { openStorage } from "../src/schema/open.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { coreScope, createLegacyBackup, ok, personal, prepareInput, project, service } from "./migration-fixtures.mjs";
import { seedFact, testAccess } from "./storage-fixtures.mjs";

const testCase = rawImportControlsCase(coreScope(project));
const migratedWindowText = "Indigo migrated window import sentinel";

test(`sqlite ${testCase.id} ${testCase.title}`, async t => {
  const directory = scratch(t);
  const input = prepareInput(directory, await fixture(directory, 29, { localPrivacy: true }));
  const legacy = openMemoryCore({ path: input.path, rawSearch: false });
  try {
    const { generation } = ok(legacy.getCaptureControl({ namespace: project }));
    ok(legacy.setProjectCapture({ namespace: project, expectedGeneration: generation, enabled: false }));
  } finally {
    await legacy.close();
  }
  editFixture(input.path, db => db.prepare(
    "INSERT INTO local_raw_hide_windows VALUES (?, 'personal', '', 10, 20)").run(personal.ownerId));
  await createLegacyBackup(input);
  await migrateLegacyStore(input);

  const storage = await openStorage(input.destination);
  const adapter = createSqliteAdapter(storage);
  const dump = () => testAccess({ adapter, port: storage.port }, coreScope(project), {}, db => ({
    messages: db.prepare("SELECT * FROM cairn_raw_messages").all(),
    privacy: db.prepare("SELECT * FROM cairn_migrated_raw_privacy").all(),
  }));
  try {
    const api = service(adapter);
    const windowScope = coreScope(personal);
    const windowMessage = { id: "migrated-window", role: "user", content: migratedWindowText, occurredAtMs: 20 };
    assert.deepEqual(await api.importRawMessages(windowScope, [{
      client: "codex", sessionId: "migrated-window-session", messages: [windowMessage],
    }]), { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
    const windowPage = await api.listRawMessages(windowScope, { cursor: null, limit: 10 });
    assert.deepEqual(windowPage.items, []);

    const reason = await runCase({
      name: "migrated sqlite",
      async open() {
        return {
          adapter, sessionRefs: "hashed", embeddingDimensions: null,
          harness: { seedFact: (_owner, fact) => seedFact(adapter, fact), dump },
          async close() {},
        };
      },
    }, testCase);
    assert.equal(reason, null);
    const messages = [{ id: "service-turn", role: "user", content: disabledText, occurredAtMs: 20 }];
    assert.deepEqual(await api.importRawMessages(coreScope(project), [{ client: "codex", sessionId: "service-import", messages }]),
      { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
  } finally {
    await adapter.close();
  }
  const bytes = readFileSync(input.destination);
  assert.equal(bytes.includes(forgottenText), false);
  assert.equal(bytes.includes(migratedWindowText), false);
  assert.equal(bytes.includes(disabledText), false);
  assert.equal(bytes.includes(enabledText), true);
});
