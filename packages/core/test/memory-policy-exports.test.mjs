import { test } from "node:test";
import assert from "node:assert/strict";
import * as core from "../src/index.mjs";
import * as policy from "../src/memory-policy/index.mjs";

const NAMES = ["decideWrite", "planDuplicateMerge", "planCorrect", "planSupersede", "canonicalPair", "planConflictInsert", "RELATION_LIMIT"];

test("the package entry exports the memory write policy", () => {
  assert.deepEqual(Object.keys(policy).sort(), [...NAMES].sort());
  for (const name of NAMES) assert.equal(core[name], policy[name], name);
  assert.equal(core.RELATION_LIMIT, 5);
});
