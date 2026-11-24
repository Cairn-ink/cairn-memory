import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { RAW_LEDGER_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const adapterURL = new URL("../src/index.mjs", import.meta.url);
const rawURL = new URL("./raw.mjs", adapterURL);
const [purgeCase] = RAW_LEDGER_CASES;
const mutants = [
  ["skips blanking", 'message.content !== "" && await matches(key, message)', "false",
    /Purge must count one Raw row and one ledger slot/],
  ["drops the slot", 'message.content = "";', "messages.splice(messages.indexOf(message), 1);",
    /Purge must preserve both slot identities/],
  ["double counts", "blanked++;", "blanked += 2;",
    /Purge must count one Raw row and one ledger slot/],
];

for (const [name, before, after, expected] of mutants) {
  test(`${purgeCase.id} rejects a purge that ${name}`, async () => {
    assert.equal(await runCase(rawFactory(), purgeCase), null);
    const adapter = new URL(adapterURL);
    const raw = new URL(rawURL);
    adapter.searchParams.set("variant", name);
    raw.searchParams.set("variant", name);
    const original = readFileSync(rawURL, "utf8");
    assert.equal(original.split(before).length - 1, 1, "Expected one mutation site");
    const source = original.replace(before, () => after);
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        if (context.parentURL === adapter.href && specifier === "./raw.mjs") return nextResolve(raw.href, context);
        return nextResolve(specifier, context);
      },
      load(url, context, nextLoad) {
        if (url === raw.href) return { format: "module", shortCircuit: true, source };
        return nextLoad(url, context);
      },
    });
    let create;
    try {
      ({ createMemoryAdapter: create } = await import(adapter.href));
    } finally {
      hooks.deregister();
    }
    await assert.rejects(runCase(rawFactory({ create }), purgeCase), expected);
  });
}
