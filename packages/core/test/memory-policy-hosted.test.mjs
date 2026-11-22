import assert from "node:assert/strict";
import { test } from "node:test";
import { decideWrite } from "../src/memory-policy/index.mjs";

// Hosted src/memory/storage.ts:148–150 orders matches. Lines 186–212 decide the write.
const old = 18000000000000000n;
const recent = old + 1n;
const stored = (id, match = "exact", distance = 0, writeTimeUs = old) =>
  ({ kind: "stored", id, match, distance, writeTimeUs, revision: 1 });
const prior = (batchIndex, match = "exact", distance = 0, writeTimeUs = old) =>
  ({ kind: "prior", batchIndex, match, distance, writeTimeUs });
const progress = (writeTimes, inserted = []) => ({ writeTimes: new Map(writeTimes), inserted: new Map(inserted) });
const suppressed = { status: "suppressed" };
const saved = { status: "saved" };
const duplicate = id => ({ status: "duplicate", id });

const cases = [
  // Line 193: session and position suppression take precedence over any duplicate.
  { name: "blocked session suppresses the write", matches: [stored("visible")], blockedSession: true, expected: suppressed },
  { name: "blocked position suppresses the write", matches: [stored("visible")], blockedPositions: [1], expected: suppressed },
  // Lines 196–199: even a hidden exact behind a visible exact still owns the hash.
  { name: "hidden exact vetoes a visible exact", matches: [stored("visible", "exact", 0, recent), stored("hidden", "exact", 0.07)],
    hiddenIds: ["hidden"], expected: suppressed },
  { name: "hidden exact suppresses with no other matches", matches: [stored("hidden")], hiddenIds: ["hidden"], expected: suppressed },
  { name: "hidden near is skipped", matches: [stored("hidden", "near", 0.01), stored("visible", "near", 0.06)],
    hiddenIds: ["hidden"], expected: duplicate("visible") },
  // Lines 148–150 and 206–210: preserve rank when the match class or distance differs.
  { name: "exact beats near", matches: [stored("exact", "exact", 0.07), prior(0, "near", 0.01)],
    progress: progress([["near", recent]], [[0, "near"]]), expected: duplicate("exact") },
  { name: "smaller distance wins", matches: [stored("closer", "near", 0.01), prior(0, "near", 0.02)],
    progress: progress([["farther", recent]], [[0, "farther"]]), expected: duplicate("closer") },
  { name: "the store's write time order breaks ties", matches: [stored("a", "near", 0.02, recent), stored("z", "near", 0.02)],
    expected: duplicate("a") },
  { name: "the store's ID order breaks equal-time ties", matches: [stored("z"), stored("a")], expected: duplicate("z") },
  // Lines 186–189 and 201–210: consult progress for exact microsecond and ID tie-breaks.
  { name: "a more recent prior wins on an exact distance tie", matches: [stored("z"), { kind: "prior", batchIndex: 0, match: "exact", distance: 0 }],
    progress: progress([["a", recent]], [[0, "a"]]), expected: duplicate("a") },
  { name: "a prior uses the recorded insert time over the match time", matches: [stored("a", "exact", 0, recent), prior(0, "exact", 0, recent + 1n)],
    progress: progress([["z", old]], [[0, "z"]]), expected: duplicate("a") },
  { name: "a prior wins a near-distance tie when its stale match time is older", matches: [stored("z", "near", 0.02, recent), prior(0, "near", 0.02, old)],
    progress: progress([["a", recent + 1n]], [[0, "a"]]), expected: duplicate("a") },
  { name: "a prior without an inserted ID is skipped", matches: [prior(0), stored("visible", "near", 0.03)],
    progress: progress([["visible", recent]]), expected: duplicate("visible") },
  { name: "a prior without progress is skipped", matches: [prior(0)], expected: saved },
  { name: "a prior without a recorded insert time is skipped", matches: [prior(0)],
    progress: progress([], [[0, "prior"]]), expected: saved },
  { name: "a later stored match written in this batch can win", matches: [stored("a", "exact", 0, recent), stored("b")],
    progress: progress([["b", recent + 1n]]), expected: duplicate("b") },
  { name: "the first match's in-batch write time is used", matches: [stored("a", "exact", 0, recent), stored("z")],
    progress: progress([["a", old - 1n]]), expected: duplicate("z") },
  { name: "equal microseconds use descending ID order", matches: [stored("a"), prior(0)],
    progress: progress([["z", old]], [[0, "z"]]), expected: duplicate("z") },
  { name: "equal microseconds use UTF-8 byte order for imported IDs", matches: [stored("～"), prior(0)],
    progress: progress([["😀", old]], [[0, "😀"]]), expected: duplicate("😀") },
  { name: "zero is a recorded write time", matches: [stored("z", "exact", 0, -1n), prior(0)],
    progress: progress([["a", 0n]], [[0, "a"]]), expected: duplicate("a") },
  // Line 212: no eligible matches leaves a new save.
  { name: "no matches saves", matches: [], blockedPositions: [0], expected: saved },
  { name: "only hidden near matches saves", matches: [stored("hidden", "near", 0.04)], hiddenIds: ["hidden"], expected: saved },
];

for (const { name, matches, progress, expected, blockedPositions = [], blockedSession = false, hiddenIds = [] } of cases) {
  test(name, () => {
    const policy = { matches: [[stored("other position")], matches], blockedPositions, blockedSession, hiddenIds };
    assert.deepEqual(decideWrite(policy, 1, progress), expected);
  });
}
