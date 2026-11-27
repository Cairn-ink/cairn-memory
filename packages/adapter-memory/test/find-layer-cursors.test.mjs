import { createMemoryService } from "@cairn-ink/core/service";
import { createMemoryAdapter } from "../src/index.mjs";
import { testAdapterFindPaging } from "../../core/test/helpers/adapter-find-layer-cursors.mjs";

testAdapterFindPaging(async () => ({
  storage: createMemoryAdapter({ documentCardSearch: true, capabilities: { documentCards: true, rawArchive: true, inspect: true } }),
  scope: { owner: "owner", namespace: null },
  otherOwner: { owner: "another-owner", namespace: null },
  embedding: null,
}), createMemoryService);
