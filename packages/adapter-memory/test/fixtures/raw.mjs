import { createHash } from "node:crypto";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

export function hashSessionKey(client, sessionId) {
  return createHash("sha256").update(JSON.stringify([client, sessionId])).digest("hex");
}

export function rawFactory({ sessionRefs = "plain", required = false, flags = {}, create = createMemoryAdapter } = {}) {
  return {
    name: `memory raw (${sessionRefs}, embedding required: ${required})`,
    async open({ capabilities }) {
      const adapter = create({
        capabilities: { ...capabilities, embeddingRequiredOnInsert: required, ...flags },
        sessionRefs, hashSessionKey: sessionRefs === "hashed" ? hashSessionKey : undefined,
      });
      return {
        adapter, sessionRefs,
        harness: { ...adapter.harness, hashSessionKey },
        nativeErrorMap: adapter.nativeErrorMap, busyNativeCodes: [], embeddingDimensions: null,
        async close() {},
      };
    },
  };
}
