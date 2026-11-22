import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

test("adapter src stays independent of Node and the test driver", async () => {
  const src = new URL("../src/", import.meta.url);
  for (const entry of await readdir(src, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const filename = `${entry.parentPath}/${entry.name}`;
    assert.doesNotMatch(await readFile(filename, "utf8"), /node:|\b(?:pg|fs|process|Buffer)\b/, entry.name);
  }
});
