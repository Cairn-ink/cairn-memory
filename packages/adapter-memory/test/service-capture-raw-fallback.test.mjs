import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "../../core/src/index.mjs";
import { assertDeleted, assertTimeout, assertUnavailableArchive, scenarios } from "../../core/test/helpers/service-capture-raw-fallback.mjs";

function strictAdapter(t) {
  const storage = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const { claim, assertEligible } = storage.capture;
  let claimedContents;
  const staleAssertions = [];
  storage.capture.claim = async (tx, key, messages, options) => {
    const result = await claim(tx, key, messages, options);
    if (result.status === "claimed") claimedContents = messages.map(({ content }) => content);
    return result;
  };
  storage.capture.assertEligible = async (tx, key, positions) => {
    if (positions.length) {
      const { scope, client, sessionId, eventId } = key;
      const current = await storage.capture.load(tx, { scope, client, sessionId, eventId });
      const stale = positions.filter(position => {
        const content = current?.messages[position]?.content;
        return !content || content !== claimedContents?.[position];
      });
      if (stale.length) {
        staleAssertions.push(...stale);
        throw new CoreError("suppressed");
      }
    }
    return assertEligible(tx, key, positions);
  };
  t.after(() => assert.deepEqual(staleAssertions, [], "Core asserted withdrawn positions"));
  return storage;
}

for (const [name, scenario] of Object.entries(scenarios)) {
  test(`memory Raw fallback ${name}`, t => scenario(t, createMemoryAdapter({ capabilities: { rawArchive: true } })));
}

test("strict memory Raw fallback withdraws a conversation deleted during extraction", t =>
  assertDeleted(t, strictAdapter(t), false));

test("keyed memory Raw fallback archives screened messages after timeout", t =>
  assertTimeout(t, createMemoryAdapter({ capabilities: { rawArchive: true, fingerprintKey: true } })));

test("memory Raw fallback keeps the original failure without Raw storage", t =>
  assertUnavailableArchive(t, createMemoryAdapter({ capabilities: { rawArchive: false } })));
