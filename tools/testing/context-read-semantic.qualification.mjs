import { createMemoryAdapter } from "../../packages/adapter-memory/src/index.mjs";
import { assemblyClock, fixtureCount, formatAssembly } from "../../packages/conformance/src/context-assembly-cases.mjs";
import { createMemoryService } from "../../packages/core/src/service/index.mjs";

// Emit deterministic responses so the same command can be compared across revisions.
const scope = { owner: "fixture-owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const input = { query: "petrel", types: ["memory"], intent: "current" };
const now = () => 1;
const clock = { ...assemblyClock(now), nowMs: now };
const adapter = createMemoryAdapter({ capabilities: { contextRead: true, inspect: true, semanticRetrieval: true },
  newId: () => "fixture-memory", now });
const storage = { ...adapter, contextRead: { ...adapter.contextRead,
  async identity() { return { storeId: "fixture-store", cursorKey: new Uint8Array(32).fill(1) }; },
} };
const options = { storage, clock, contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly };
const keyless = createMemoryService({ ...options, profile: "keyless-local" });
const lexical = createMemoryService({ ...options, config: {}, gate: { async assertOpen() {} }, tokens: { countTokens: () => 0 },
  embedQuery: { async embedQuery() { throw new Error("Lexical qualification dispatched an embedding"); } },
});

await adapter.uow.run(scope.owner, { pauseLock: true }, tx => adapter.memories.insert(tx, scope, {
  kind: "fact", origin: "explicit", text: "The petrel nests on a cliff.", textHash: "sha256:" + "a".repeat(64),
  confidence: 1, source: { kind: "import", client: null, sessionId: null },
  embedding: { model: "fixture", vector: [1, 0, 0, 0] },
}, [], 1));

for (const [service, semantic] of [[keyless, undefined], [keyless, false], [lexical, false]]) {
  const found = await service.findCandidates(readSet, { ...input, semantic });
  const read = await service.readContext(readSet, { ...input, semantic });
  const fetched = await service.fetchEvidence(readSet, { snapshot: read.snapshot });
  process.stdout.write(JSON.stringify({ found, read, fetched }) + "\n");
}
for (const method of ["findCandidates", "readContext"]) {
  try {
    await keyless[method](readSet, { ...input, semantic: true });
    throw new Error("Expected keyless semantic refusal");
  } catch (error) {
    if (error.code !== "invalid_input") throw error;
    process.stdout.write(JSON.stringify({ code: error.code, diagnostics: error.diagnostics }) + "\n");
  }
}
