import { createMemoryService } from "@cairn-ink/core/service";
import { createMemoryAdapter } from "../src/index.mjs";
import { testAdapterFindPaging, testMemoryFindDelivery, testMemoryFindTieOrder }
  from "../../core/test/helpers/adapter-find-layer-cursors.mjs";

async function open(_t, hybrid = false) {
  let nextId = 0;
  return {
    storage: createMemoryAdapter({
      newId: () => `item-${String(nextId++).padStart(3, "0")}`,
      now: () => 10_000,
      documentCardSearch: true,
      capabilities: { documentCards: true, rawArchive: true, inspect: true, semanticRetrieval: hybrid },
    }),
    scope: { owner: "owner", namespace: null },
    otherOwner: { owner: "another-owner", namespace: null },
    embedding: hybrid ? { model: "fixture-model", vector: [1, 0] } : null,
  };
}

testAdapterFindPaging(open, createMemoryService);
testMemoryFindDelivery(open, createMemoryService);
testMemoryFindTieOrder(open, createMemoryService);
