import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { serialize } from "node:v8";
import { findFixture, options, query, scope, stripCursors }
  from "../../packages/core/test/helpers/find-layer-cursor-fixture.mjs";

assert.equal(process.argv.length, 3, "Supply an unmodified baseline find.mjs.");
const baseline = await readFile(process.argv[2], "utf8");
const serviceDirectory = new URL("../../packages/core/src/service/", import.meta.url);
const source = baseline.replace(/from "(\.\.?\/[^"]+)";/gu,
  (_match, specifier) => `from "${new URL(specifier, serviceDirectory)}";`);
const { findMethod } = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));

let comparisons = 0;
for (const semantic of [false, true]) {
  for (const text of [query, null, " \n "]) {
    for (const kinds of [options.kinds, ["raw"], ["card"], ["memory"]]) {
      const old = await findMethod(findFixture({ semantic }).deps)(scope, text, { ...options, kinds });
      const current = await findFixture({ semantic }).service.find(scope, text, { ...options, kinds });
      assert.deepEqual(serialize(stripCursors(current)), serialize(old));
      comparisons++;
    }
  }
}
console.log(`${comparisons} first-page byte comparisons passed`);
