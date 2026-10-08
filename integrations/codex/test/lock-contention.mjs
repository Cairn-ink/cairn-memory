export { withHeldLock as withHeldDispatch } from "../../client/testing/lock-contention.mjs";

import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// Observe the work that Promise.race leaves running after a hook deadline.
// Only this isolated source copy gains a join handle; behavior/imports are real.
export async function observedHook(directory) {
  const original = new URL("../hook.mjs", import.meta.url);
  const source = await readFile(original, "utf8");
  const call = "processHook(input,{clientOptions,targetId,launch,qualifiedCreatorVersion},\n" +
    "      ()=>expired || now()-start>=budget)";
  assert.equal(source.split(call).length, 2, "hook work observation seam must match once");
  const instrumented = source.replace(call, `observeHookWork(${call})`)
    .replace(/from (['"])(\.\.?\/[^'"]+)\1/g,
      (_, quote, specifier) => `from ${quote}${new URL(specifier, original).href}${quote}`);
  const path = join(directory, "observed-hook.mjs");
  await writeFile(path, instrumented + `
const hookWork = new Set();
function observeHookWork(work) {
  hookWork.add(work);
  work.then(() => hookWork.delete(work), () => hookWork.delete(work));
  return work;
}
export async function drainHookWork() { await Promise.all([...hookWork]); }
`, { mode: 0o600 });
  return import(pathToFileURL(path).href);
}
