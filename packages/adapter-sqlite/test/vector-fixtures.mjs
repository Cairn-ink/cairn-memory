import { setTimeout } from "node:timers/promises";

export async function waitForVectorCache(adapter, owner) {
  // The empty namespace is reserved and can never contain a stored row.
  const scope = { owner, namespaces: [""] };
  const stopAt = performance.now() + 5_000;
  while (performance.now() < stopAt) {
    const result = await adapter.uow.run(owner, { readOnly: true }, tx =>
      adapter.vector.vector(tx, scope, Float32Array.of(1), "test", 1));
    if (result.coverage.complete) return;
    await setTimeout(4);
  }
  throw new Error("Vector cache did not warm");
}
