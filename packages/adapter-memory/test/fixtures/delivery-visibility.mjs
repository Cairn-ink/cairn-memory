import assert, { AssertionError } from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest, decisionContext, isCoreError, placePendingCardsBatch } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";

export const scope = { owner: "fixture", namespace: null };
export const selection = { owner: scope.owner, namespaces: [scope.namespace] };
export const client = "fixture";
const support = "supports-decision";
const challenge = "challenges-premise";
export const ROOT_ASSERTION = "The hidden root must contribute no rationale paths";
export const ENDPOINT_ASSERTION = "The hidden non-root endpoint must contribute no rationale paths";
const sha256Hex = async (value) => createHash("sha256").update(value).digest("hex");

export function deliveryFactory(create = createMemoryAdapter) {
  return {
    name: "memory delivery visibility",
    async open({ capabilities }) {
      const adapter = create({ capabilities });
      return {
        adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap, sessionRefs: "plain",
        busyNativeCodes: [], embeddingDimensions: null, async close() {},
      };
    },
  };
}

export function memoryFixture(capabilities, create = createMemoryAdapter) {
  const adapter = create({ capabilities });
  const read = (fn) => adapter.uow.run(scope.owner, { readOnly: true }, fn);
  const write = (fn) => adapter.uow.run(scope.owner, { pauseLock: true }, fn);
  async function archive(sessionId, content) {
    const message = { id: "message", role: "user", occurredAtMs: 1, content };
    const capture = { scope, client, sessionId, eventId: sessionId, payloadDigest: await sha256Hex(content) };
    assert.deepEqual(await write((tx) => adapter.raw.archive(tx, capture, [message])), { archived: 1 });
    return message;
  }
  async function insert(text, receipts = []) {
    const digest = await coreDigest(text);
    return write((tx) => adapter.memories.insert(tx, scope, {
      kind: "fact", origin: "explicit", text, textHash: `sha256:${digest.value}`, embedding: null, confidence: 1,
      source: { kind: "mcp", client: null, sessionId: null },
    }, receipts, 1));
  }
  async function excludeText(text) {
    await adapter.harness.seedFact(scope.owner, {
      ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "exclude-text", text: { digests: [await coreDigest(text)] },
    });
  }
  return { adapter, read, write, archive, insert, excludeText };
}

const guard = ({ id, contentHash }) => ({ cardId: id, contentHash });
const memoryRef = ({ memoryId: id }) => ({ type: "memory", id, namespace: scope.namespace });

export async function assertPlacementDelivery(exclusion, create) {
  const linkedSession = exclusion === "linked-session";
  const messageBacked = exclusion === "session" || linkedSession;
  const { adapter, read, write, archive, insert, excludeText } =
    memoryFixture({ documentCards: true, placement: true, rawArchive: messageBacked }, create);
  const { uow, documentCards, placement, fence, raw } = adapter;
  const sourceText = "The spare tiles are on the bottom shelf.";
  const sourceSession = (label) => `${label}-memory`;
  const dependent = await card("dependent", sourceText);
  const control = await card("control", "The spare hinges are in the small box.");

  async function card(label, text) {
    const receipts = [];
    if (linkedSession) {
      const sessionId = sourceSession(label);
      const { id: messageId, role, occurredAtMs } = await archive(sessionId, text);
      receipts.push({ client, sessionId, messageId, role, occurredAtMs });
    }
    const { id, revision } = await insert(text, receipts);
    const title = `Filing note ${label}`;
    const body = `Use the ${label} folder.`;
    let record = { id: label, scope, origin: "import", title, body, date: null, sourceMessage: null,
      sourceMemories: [{ id, revision }], sentences: [], stale: [] };
    if (messageBacked) {
      const sessionId = `${label}-message`;
      const message = await archive(sessionId, `${title}\n\n${body}`);
      const { card: routed } = await buildDocumentCard(message, { scope, client, canonicalSessionKey: sessionId });
      assert.ok(routed);
      record = { ...record, id: routed.id, origin: "router", title: routed.title, body: routed.body, date: routed.date,
        sourceMessage: { client, sessionId, messageId: message.id } };
    }
    const { value } = await coreDigest(record.body);
    const stored = { ...record, contentHash: `sha256:${value}` };
    assert.equal((await write((tx) => documentCards.put(tx, scope, stored))).status, "inserted");
    return stored;
  }

  if (exclusion === "text") {
    await excludeText(sourceText);
  } else if (exclusion === "identity") {
    await adapter.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget",
      actionId: "exclude-identity", memoryId: dependent.sourceMemories[0].id });
  } else if (exclusion === "session") {
    const { sessionId } = dependent.sourceMessage;
    await write((tx) => raw.fenceSession(tx, scope, { client, sessionId }));
  } else {
    await adapter.harness.seedFact(scope.owner, { ...scope, kind: "session", origin: "forget",
      actionId: "exclude-linked-session", session: { client, sessionId: sourceSession("dependent") } });
    const linkedRefs = [dependent, control].map(({ sourceMemories: [{ id }] }) => memoryRef({ memoryId: id }));
    assert.deepEqual(await read((tx) => fence.assertVisible(tx, selection, linkedRefs)), [linkedRefs[1]],
      "Only the linked control memory stays visible");
    const { items } = await read((tx) => raw.listRaw(tx, selection, { cursor: null, limit: 10 }));
    const { sessionId, messageId } = dependent.sourceMessage;
    assert.ok(items.some((item) => item.client === client && item.sessionId === sessionId && item.messageId === messageId),
      "The card's own Raw message stays visible");
  }

  const offered = [dependent, control];
  const fenceCalls = [];
  const classified = [];
  const result = await placePendingCardsBatch({
    uow, documentCards, scope,
    // Supply both guards so the test exercises the core fence regardless of queue eligibility.
    placement: { ...placement, async pendingCards() { return offered.map(guard); } },
    fence: {
      async assertVisible(tx, selection, refs) {
        fenceCalls.push(refs.map(({ id }) => id));
        return fence.assertVisible(tx, selection, refs);
      },
    },
    async classify({ cards }) {
      classified.push(cards);
      return { items: cards.map(({ cardId }) => ({ cardId, parentIds: [] })) };
    },
  });
  assert.deepEqual(fenceCalls[0], offered.map(({ id }) => id), "Both cards must reach the core fence");
  assert.deepEqual(classified, [[{ ...guard(control), content: `${control.title}\n\n${control.body}` }]],
    "Only the visible card must reach the classifier");
  assert.deepEqual(result, { status: "applied", placed: [{ cardId: control.id, topicIds: [] }] });
}

export async function assertRootDelivery(readContext, fenceCalls, rootRef) {
  let actual;
  try {
    actual = await readContext();
  } catch (error) {
    if (isCoreError(error) && error.code === "memory_not_found") return "pass";
    throw error;
  }
  // Core fences the root before reading or caching it, so any returned value must be empty.
  const expected = { status: "unassessed", refs: [] };
  if (!isDeepStrictEqual(actual, expected)) {
    throw new AssertionError({ message: ROOT_ASSERTION, actual, expected, operator: "decisionContext delivery" });
  }
  return "pass";
}

export async function rationaleFixture(exclusion, bypassFence = false) {
  const { adapter, read, write, archive, insert, excludeText } = memoryFixture({ rawArchive: true, rationaleEdges: true });
  const { uow, rationale, fence } = adapter;
  const rootText = "Keep the current room layout.";
  const challengerText = "The cabinet blocks the walkway.";
  async function seed(label, text) {
    const message = await archive(label, `Meeting note. ${text}`);
    const { id: memoryId, revision } = await insert(text, [{ client, sessionId: label, messageId: message.id,
      role: message.role, occurredAtMs: message.occurredAtMs }]);
    return { memoryId, revision };
  }
  const root = await seed("decision", rootText);
  const premise = await seed("premise", "The cabinet fits the room.");
  const challenger = await seed("challenge", challengerText);
  const control = await seed("control", "Keep the cabinet in the room.");
  const controlPremise = await seed("control-premise", "The cabinet holds the room supplies.");
  const evidence = await read((tx) => rationale.sourceEvidence(tx, scope, [root, premise, challenger, control, controlPremise]));
  const anchors = await Promise.all(evidence.map(async ({ memory, receipts: [{ id, role, excerpt }] }) => ({
    ...memory, receiptId: id, digest: await sha256Hex(JSON.stringify({ id, role, excerpt })),
  })));
  const [decisionAnchor, premiseAnchor, challengeAnchor, controlAnchor, controlPremiseAnchor] = anchors;
  await write(async (tx) => {
    for (const edge of [
      { from: premiseAnchor, to: decisionAnchor, relation: support },
      { from: challengeAnchor, to: decisionAnchor, relation: challenge },
      { from: challengeAnchor, to: premiseAnchor, relation: challenge },
      { from: controlPremiseAnchor, to: controlAnchor, relation: support },
    ]) assert.deepEqual(await rationale.insert(tx, scope, edge), { inserted: true });
  });

  const options = { uow, scope, store: rationale, retrieval: adapter };
  const ref = ({ memoryId: id, revision }, relation) => ({ id, revision, relation, direction: "incoming" });
  const baseline = {
    status: "reconfirmation-suggested",
    refs: [ref(premise, support), ref(challenger, challenge), ref(challenger, challenge)],
  };
  assert.deepEqual(await decisionContext({ ...options, ...root }), baseline, "Both challenge paths must start visible");

  const hideRoot = exclusion === "root";
  const hidden = hideRoot ? root : challenger;
  await excludeText(hideRoot ? rootText : challengerText);
  const requested = [memoryRef(hidden), memoryRef(premise)];
  assert.deepEqual(await read((tx) => fence.assertVisible(tx, selection, requested)), [memoryRef(premise)],
    "The real fence must exclude the fact-hidden source and admit the visible control");
  const retained = new Map(evidence.map((source) => [source.memory.id, source]));

  const fenceCalls = [];
  const isolated = {
    ...options,
    store: {
      ...rationale,
      // Hold receipt admission constant across the text fact so only the core fence can withhold paths.
      async sourceEvidence(_tx, _scope, refs) {
        return refs.map(({ memoryId, revision }) => {
          const source = retained.get(memoryId);
          assert.equal(source?.memory.revision, revision, "Expected a recorded fixture receipt");
          return source;
        });
      },
    },
    retrieval: {
      ...adapter,
      fence: {
        async assertVisible(tx, selected, refs) {
          fenceCalls.push(...refs.map((ref) => ({ ...ref })));
          return bypassFence ? refs : fence.assertVisible(tx, selected, refs);
        },
      },
    },
  };
  return {
    baseline,
    async assertDelivery() {
      // Every path to a hidden root is inadmissible, so use a separate root for its positive control.
      assert.deepEqual(await decisionContext({ ...isolated, ...control }),
        { status: "unassessed", refs: [ref(controlPremise, support)] }, "The visible control path must survive");
      fenceCalls.length = 0;
      const readContext = () => decisionContext({ ...isolated, ...root });
      if (hideRoot) return assertRootDelivery(readContext, fenceCalls, memoryRef(root));

      // Exact shape checks the surviving path count and status, and excludes extra IDs, receipt IDs and digests.
      const actual = await readContext();
      const expected = { status: "unassessed", refs: [ref(premise, support)] };
      if (!isDeepStrictEqual(actual, expected)) {
        throw new AssertionError({ message: ENDPOINT_ASSERTION, actual, expected, operator: "decisionContext delivery" });
      }
    },
  };
}
