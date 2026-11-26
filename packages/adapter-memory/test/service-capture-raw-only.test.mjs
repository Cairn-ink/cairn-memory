import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "../../core/src/index.mjs";
import { assertDeleted, assertUnavailable, scenarios } from "../../core/test/helpers/service-capture-raw-only.mjs";

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
  test(`memory Raw-only capture ${name}`, t => scenario(t, createMemoryAdapter({ capabilities: { rawArchive: true } })));
}

test("memory Raw-only capture is unavailable without rawArchive", () =>
  assertUnavailable(createMemoryAdapter({ capabilities: { rawArchive: false } })));

test("strict memory Raw-only capture does not restore a conversation deleted before run", t =>
  assertDeleted(t, strictAdapter(t), false));

test("strict memory Raw-only capture does not restore a conversation deleted after screening", t =>
  assertDeleted(t, strictAdapter(t), true));
