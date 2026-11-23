import { test } from "node:test";
import { CASES, runCase } from "./index.mjs";

/** @param {import("./factory.d.ts").AdapterFactory} factory */
export function defineConformanceTests(factory) {
  for (const testCase of CASES) {
    test(`${factory.name} ${testCase.id} ${testCase.title}`, async (t) => {
      const reason = await runCase(factory, testCase);
      if (reason !== null) t.skip(reason);
    });
  }
}
