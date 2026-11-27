import { test } from "node:test";
import { scenarios } from "../../core/test/helpers/service-capture-raw-fallback.mjs";
import { captureFixture } from "./capture-fixtures.mjs";

for (const [name, scenario] of Object.entries(scenarios)) {
  test(`SQLite Raw fallback ${name}`, async t => {
    const fixture = await captureFixture();
    t.after(fixture.close);
    await scenario(t, fixture.adapter);
  });
}
