import { createMemoryService } from "@cairn-ink/core/service";
import { testAdapterFindPaging } from "../../core/test/helpers/adapter-find-layer-cursors.mjs";
import { fixture } from "./storage-fixtures.mjs";

testAdapterFindPaging(async t => {
  const { adapter, close } = await fixture();
  t.after(close);
  return {
    storage: adapter,
    scope: { owner: "owner", namespace: null },
    otherOwner: { owner: "another-owner", namespace: null },
    embedding: null,
  };
}, createMemoryService);
