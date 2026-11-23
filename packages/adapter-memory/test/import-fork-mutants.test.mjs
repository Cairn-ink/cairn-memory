import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { IMPORT_ARCHIVE_CASES, PROVEN_FORK_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const adapterURL = new URL("../src/index.mjs", import.meta.url);
const rawURL = new URL("./raw.mjs", adapterURL);
const cases = [...IMPORT_ARCHIVE_CASES, ...PROVEN_FORK_CASES];

async function variantFactory(name, replacements) {
  const adapter = new URL(adapterURL);
  const raw = new URL(rawURL);
  adapter.searchParams.set("variant", name);
  raw.searchParams.set("variant", name);
  let source = readFileSync(rawURL, "utf8");
  for (const [before, after] of replacements) {
    assert.equal(source.split(before).length - 1, 1, `Unexpected mutation sites for ${name}`);
    source = source.replace(before, () => after);
  }
  const hooks = registerHooks({
    resolve(request, context, nextResolve) {
      if (context.parentURL === adapter.href && request === "./raw.mjs") return nextResolve(raw.href, context);
      return nextResolve(request, context);
    },
    load(url, context, nextLoad) {
      if (url === raw.href) return { format: "module", source, shortCircuit: true };
      return nextLoad(url, context);
    },
  });
  try {
    return rawFactory({ create: (await import(adapter.href)).createMemoryAdapter });
  } finally {
    hooks.deregister();
  }
}

const sameClient = "const sessions = state.rawAnchors.get(session.client);";
const compareProof = "return recorded !== undefined && (digest === null || recorded.has(null) || recorded.has(digest));";
const wholeFork = /A proven fork must block the matching message and every new turn/;
const mutants = [
  ["omits the fork check", "K-FORK-1", wholeFork, [
    [sameClient, "const sessions = undefined;"],
  ]],
  ["uses ID alone even with a known digest", "K-FORK-2", /Different content must leave a reused ID eligible/, [
    [compareProof, "return recorded !== undefined;"],
  ]],
  ["treats a scrubbed incoming slot as a digest mismatch", "K-FORK-10", /Both outbox eligibility checks must refuse/, [
    [compareProof, "return recorded?.has(null) || (digest !== null && recorded?.has(digest));"],
  ]],
  ["compares anchors from other clients", "K-FORK-4", /Another client must remain eligible/, [
    ['["raw-lineage-content-v1", owner, client, id, content]', '["raw-lineage-content-v1", owner, id, content]'],
    [sameClient, "const sessions = new Map([...state.rawAnchors.values()].flatMap((sessions) => [...sessions]));"],
    ["for (const anchor of sessions.values())", "for (const [slot, anchor] of sessions)"],
    ["const source = { client: session.client, sessionId: anchor.sessionId };",
      "const source = { client: JSON.parse(slot)[1], sessionId: anchor.sessionId };"],
  ]],
  ["stores withheld messages", "K-IMP-RAW-1", /Import must never store withheld content/, [
    ["counts.withheld++;", "state.rawRows.set(id, entry); counts.withheld++; run.stateWritten = true;"],
  ]],
  ["stores a client-window refusal", "K-IMP-RAW-3", /Import must never store window refusal client-start/, [
    ["counts.withheld++;", `counts.withheld++;
              if (entry.messageId === "client-start") {
                state.rawRows.set(id, entry);
                run.stateWritten = true;
              }`],
  ]],
  ["counts existing IDs as archived", "K-IMP-RAW-1", /Import must count each outcome/, [
    ["counts.existing++;", "counts.archived++;"],
  ]],
];

for (const [name, id, failure, replacements] of mutants) {
  test(`${id} rejects an adapter that ${name}`, async () => {
    const testCase = cases.find((candidate) => candidate.id === id);
    assert.ok(testCase);
    assert.equal(await runCase(rawFactory(), testCase), null);
    const factory = await variantFactory(name, replacements);
    await assert.rejects(runCase(factory, testCase), failure);
  });
}

test("K-FORK-1 rejects blocking only the message that matches an anchor", async () => {
  const testCase = PROVEN_FORK_CASES.find(({ id }) => id === "K-FORK-1");
  assert.ok(testCase);
  assert.equal(await runCase(rawFactory(), testCase), null);
  const factory = rawFactory({ create(options) {
    const adapter = createMemoryAdapter(options);
    const { eligible } = adapter.capture;
    adapter.capture.eligible = async (tx, key, messages) => {
      const perMessage = await Promise.all(messages.map((message) => eligible(tx, key, [message])));
      return perMessage.flatMap((positions, index) => positions.length ? [index] : []);
    };
    return adapter;
  } });
  await assert.rejects(runCase(factory, testCase), wholeFork);
});
