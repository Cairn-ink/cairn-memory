import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDocumentCard, documentCardVisible, visibleDocumentCardRows } from "../src/routing/index.mjs";

const scope = { owner: "owner", namespace: null };
const sourceMessage = { client: "client", sessionId: "session", messageId: "message" };
const body = "Maintenance guide";
const { card: built } = await buildDocumentCard({ id: sourceMessage.messageId, role: "user", content: body },
  { scope, client: sourceMessage.client, canonicalSessionKey: sourceMessage.sessionId });
const linked = { id: "memory", revision: 2 };
const corrected = { status: "visible", revision: 5, correctedRevisions: [2, 4] };
const uncertain = { visible: false, reason: "uncertain" };
const withheld = { visible: false, reason: "source_memory_corrected" };

function visibilityInput(origin, state = corrected, source = linked) {
  const card = { origin, scope, title: built.title, body, sourceMemories: [source],
    ...(origin === "router"
      ? { id: built.id, sourceMessage, canonicalSessionKey: sourceMessage.sessionId }
      : { id: origin, sourceMessage: null }) };
  return { card, requestedScope: scope, memoryStates: new Map([[linked.id, state]]), sourceWithheld: false, textFacts: [] };
}

test("a corrected citation withholds every origin without authorizing purge", async () => {
  for (const origin of ["router", "import", "manual"]) {
    const input = visibilityInput(origin);
    assert.deepEqual(await documentCardVisible(input), withheld);
    assert.deepEqual(await documentCardVisible(input, { definiteOnly: true }), uncertain);
    const { card } = input;
    const rows = [{ ref: { type: "card", id: card.id, namespace: scope.namespace } }];
    assert.deepEqual(await visibleDocumentCardRows(rows, () => input), {
      rows: [], drops: { source_memory_corrected: 1 },
    });
    assert.deepEqual(await documentCardVisible(visibilityInput(origin, corrected, { ...linked, revision: 5 })),
      { visible: true, reason: null });
  }
});

test("revision gaps do not become correction evidence", async () => {
  const input = visibilityInput("router", { ...corrected, status: "historical" }, { ...linked, revision: 3 });
  assert.deepEqual(await documentCardVisible(input), { visible: true, reason: null });
  for (const origin of ["import", "manual"]) {
    assert.deepEqual(await documentCardVisible(visibilityInput(origin, corrected, { ...linked, revision: 3 })),
      { visible: false, reason: "source_memory_not_visible" });
  }
});

test("missing or malformed correction evidence fails closed", async () => {
  for (const origin of ["router", "import", "manual"]) {
    for (const correctedRevisions of [undefined, null, 2, ["2"], [-1], [5], Array(1)]) {
      const input = visibilityInput(origin, { ...corrected, correctedRevisions });
      assert.deepEqual(await documentCardVisible(input), uncertain);
      assert.deepEqual(await documentCardVisible(input, { definiteOnly: true }), uncertain);
    }
  }
});

test("independent forget evidence still authorizes purge of a correction-withheld card", async () => {
  const input = visibilityInput("router");
  input.card.sourceMemories.push({ id: "forgotten", revision: 1 });
  input.memoryStates.set("forgotten", { status: "forgotten" });
  assert.deepEqual(await documentCardVisible(input, { definiteOnly: true }),
    { visible: false, reason: "source_memory_forgotten" });
});
