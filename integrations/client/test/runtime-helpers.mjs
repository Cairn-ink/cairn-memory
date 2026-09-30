import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createTestWorkspace } from "../../../tools/testing/workspace.mjs";
import { createRuntimeGuard } from "../runtime-usage.mjs";

export async function usageFixture(t, extra = {}) {
  const ws = createTestWorkspace(t, { prefix: "cx3-usage-" });
  const home = join(ws.path, "home");
  await mkdir(home, { mode: 0o700 });
  let clock = Date.parse("2026-09-30T12:00:00Z");
  const config = {
    root: home,
    targetId: "a".repeat(64),
    mode: "api-key",
    dailyCap: 10,
    now: () => clock,
    ...extra,
  };
  return {
    ws,
    home,
    root: home,
    config,
    guard: createRuntimeGuard(config),
    advance: (ms) => (clock += ms),
    now: () => clock,
  };
}
