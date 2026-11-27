import { createMemoryService } from "@cairn-ink/core/service";
import { createMemoryAdapter } from "../src/index.mjs";
import { testAdapterFindPaging, testAdapterFindVersions, testMemoryFindDelivery, testMemoryFindTieOrder }
  from "../../core/test/helpers/adapter-find-layer-cursors.mjs";

async function open(_t, hybrid = false) {
  let nextId = 0;
  const storage = createMemoryAdapter({
    newId: () => `item-${String(nextId++).padStart(3, "0")}`,
    now: () => 10_000,
    documentCardSearch: true,
    capabilities: { documentCards: true, rawArchive: true, inspect: true, semanticRetrieval: hybrid },
  });
  const scope = { owner: "owner", namespace: null };
  const session = "version-source";
  const seedRaw = message => storage.harness.seedClientlessRaw(scope, session, message);
  return {
    storage, scope, seedRaw,
    replaceRaw: ({ messageId: id, role, occurredAtMs }, content) => seedRaw({ id, role, occurredAtMs, content }),
    otherOwner: { owner: "another-owner", namespace: null },
    embedding: hybrid ? { model: "fixture-model", vector: [1, 0] } : null,
  };
}

testAdapterFindPaging(open, createMemoryService);
testAdapterFindVersions(open, createMemoryService, ["card", "memory", "raw"]);
testMemoryFindDelivery(open, createMemoryService);
testMemoryFindTieOrder(open, createMemoryService);
