import assert, { AssertionError } from "node:assert/strict";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest, decisionContext } from "@cairn-ink/core";

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

export function memoryFixture(capabilities) {
  const adapter = createMemoryAdapter({ capabilities });
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
  const memoryRef = ({ memoryId: id }) => ({ type: "memory", id, namespace: scope.namespace });
  const requested = [memoryRef(hidden), memoryRef(premise)];
  assert.deepEqual(await read((tx) => fence.assertVisible(tx, selection, requested)), [memoryRef(premise)],
    "The real fence must exclude the fact-hidden source and admit the visible control");
  const retained = new Map(evidence.map((source) => [source.memory.id, source]));

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
          return bypassFence ? refs : fence.assertVisible(tx, selected, refs);
        },
      },
    },
  };
  const expected = { status: "unassessed", refs: hideRoot ? [] : [ref(premise, support)] };
  const message = hideRoot ? ROOT_ASSERTION : ENDPOINT_ASSERTION;
  return {
    baseline,
    async assertDelivery() {
      // Every path to a hidden root is inadmissible, so use a separate root for its positive control.
      assert.deepEqual(await decisionContext({ ...isolated, ...control }),
        { status: "unassessed", refs: [ref(controlPremise, support)] }, "The visible control path must survive");
      // Exact shape checks the surviving path count and status, and excludes extra IDs, receipt IDs and digests.
      const actual = await decisionContext({ ...isolated, ...root });
      if (!isDeepStrictEqual(actual, expected)) {
        throw new AssertionError({ message, actual, expected, operator: "decisionContext delivery" });
      }
    },
  };
}
