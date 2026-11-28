import assert from "node:assert/strict";
import nodeCrypto from "node:crypto";
import { syncBuiltinESMExports } from "node:module";
import { mock } from "node:test";

// Run only around fixture writes, after the runner has allocated its owners.
// Memory/Postgres generate IDs through Web Crypto, while SQLite uses node:crypto.
export async function withHostedTopicIds(ids, work) {
  let used = 0;
  const randomUUID = () => {
    assert.ok(used < ids.length, "Unexpected hosted fixture ID allocation");
    return ids[used++];
  };
  const web = mock.method(globalThis.crypto, "randomUUID", randomUUID);
  const node = mock.method(nodeCrypto, "randomUUID", randomUUID);
  syncBuiltinESMExports();
  try {
    const result = await work();
    assert.equal(used, ids.length, "Every hosted fixture ID must be allocated");
    return result;
  } finally {
    node.mock.restore();
    web.mock.restore();
    syncBuiltinESMExports();
  }
}
