import { createMemoryService } from "@cairn-ink/core/service";
import { check, DEFAULT_EMBEDDING_DIMENSIONS, equal, readDump } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {"before capture" | "model call" | "embedder call"} DeleteTiming */

const client = "fixture-client";
const encoder = new TextEncoder();
const fixtures = [
  {
    preArchived: true,
    deleted: [
      ["The flour is in the green tin.", "Baking supplies are stored in a colored container."],
      ["The basket holds three clean towels.", "Fresh linens are ready to use."],
    ],
    control: ["The back step needs a coat of paint.", "The porch stairs need maintenance."],
  },
  {
    preArchived: false,
    deleted: [
      ["The spare buttons are in a glass jar.", "Sewing notions are kept together."],
      ["The curtains were taken down for washing.", "Window coverings are being cleaned."],
    ],
    control: ["The watering can is beside the shed.", "Garden equipment is kept outdoors."],
  },
];

/** @param {CaseContext["adapter"]} adapter @returns {CaseContext["adapter"] & {name: string}} */
function storageOf(adapter) {
  return /** @type {CaseContext["adapter"] & {name: string}} */ (new Proxy(adapter, {
    get(target, key) {
      const value = Reflect.get(target, key, target);
      return key === "name" && typeof value !== "string" ? "capture-fixture" : value;
    },
    has: (target, key) => key === "name" || Reflect.has(target, key),
  }));
}

/** @param {string[]} contents */
function conversation(contents) {
  const session = { client, sessionId: crypto.randomUUID() };
  /** @type {CaptureMessage[]} */
  const messages = contents.map((content, index) => ({ id: crypto.randomUUID(), role: "user", content, occurredAtMs: index + 1 }));
  return { session, selection: { ...session, eventId: crypto.randomUUID() }, messages };
}

/** @param {string} text */
const collapseWhitespace = text => text.replace(/\s+/gu, " ").trim();

/** @param {CaseContext} ctx @param {Map<string, string>} outputs @param {boolean} preArchived
 * @param {(stage: DeleteTiming) => Promise<void>} inject */
function captureService(ctx, outputs, preArchived, inject) {
  const dimensions = ctx.embeddingDimensions ?? DEFAULT_EMBEDDING_DIMENSIONS;
  const embeddingTexts = [...outputs.values()].map(text => text.toLowerCase());
  const countTokens = () => 1;
  return createMemoryService({
    storage: storageOf(ctx.adapter),
    model: {
      model: "fixture-only", contextWindow: 16_384, countTokens,
      async call(_stage, request) {
        const { messages } = /** @type {{messages: {index: number, content: string}[]}} */ (request.input);
        await inject("model call");
        return { items: messages.map(({ index, content }) => ({
          kind: "fact", content: outputs.get(content), confidence: 0.9, sourceIndices: [index],
        })) };
      },
    },
    embedder: {
      model: "fixture-only", dimensions,
      async embed(texts) {
        await inject("embedder call");
        return texts.map(text => {
          const index = embeddingTexts.indexOf(text);
          check(index !== -1, "The embedder must receive a fixture extraction");
          const vector = new Float32Array(dimensions);
          // Keep the two control memories distinct even when near-duplicate matching is enabled.
          vector[index % dimensions] = preArchived ? 1 : -1;
          return vector;
        });
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: Date.now, monotonicMs: () => performance.now(),
      async hmacHex() { throw new Error("Unexpected HMAC"); },
      async sha256Hex(input) {
        const digest = await crypto.subtle.digest("SHA-256",
          typeof input === "string" ? encoder.encode(input) : new Uint8Array(input));
        return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      },
    },
    tokens: { countTokens },
    config: {},
  });
}

/** @param {CaseContext} ctx @param {DeleteTiming} timing */
async function captureDelete(ctx, timing) {
  const { capture, memories, raw, uow } = ctx.adapter;
  if (typeof capture.admit !== "function") return "needs capture.admit";
  const { load } = capture;
  check(typeof load === "function", "Capture admission requires capture.load");
  check(raw, "rawArchive requires the raw ports");
  const scope = ctx.scope(null);
  const { owner } = scope;
  const rawScope = { owner, namespaces: [scope.namespace] };
  const page = { cursor: null, limit: 20 };
  /** @param {ReturnType<typeof conversation>["session"]} session */
  const listRaw = session => uow.run(owner, { readOnly: true }, async tx =>
    (await raw.listRaw(tx, rawScope, page)).items.filter(row => row.client === session.client && row.sessionId === session.sessionId));
  /** @param {ReturnType<typeof conversation>["session"]} session */
  const remove = session => uow.run(owner, { pauseLock: true }, tx => raw.deleteConversation(tx, scope, session));
  /** @param {ReturnType<typeof conversation>} fixture */
  const archive = ({ session, messages }) => {
    /** @type {CaptureKey} */
    const key = { scope, ...session, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) };
    return uow.run(owner, { pauseLock: true }, tx => raw.archive(tx, key, messages));
  };
  const memoryTexts = () => uow.run(owner, { readOnly: true }, async tx =>
    (await memories.exportPage(tx, scope, page)).items.map(({ text }) => text).sort());
  const unrelated = [];

  for (const { preArchived, deleted, control } of fixtures) {
    const label = `${timing}, ${preArchived ? "previously archived" : "without prior archive"}`;
    const target = conversation(deleted.map(([text]) => text));
    const [controlInput, controlOutput] = control;
    const survivor = conversation([controlInput]);
    const outputs = new Map(deleted.map(([input, output]) => [input, output]));
    outputs.set(controlInput, controlOutput);
    /** @type {Awaited<ReturnType<typeof listRaw>> | undefined} */
    let rawAfterDelete;
    /** @param {DeleteTiming} stage */
    const inject = async stage => {
      if (stage !== timing || rawAfterDelete !== undefined) return;
      await remove(target.session);
      rawAfterDelete = await listRaw(target.session);
    };
    const service = captureService(ctx, outputs, preArchived, inject);

    const untouched = conversation(["The spare key hangs near the door."]);
    equal((await archive(untouched)).archived, 1, `The unrelated fixture must be archived (${label})`);
    unrelated.push({ untouched, label });
    if (preArchived) {
      const { archived } = await archive(target);
      equal(archived, target.messages.length, `The fixture must be archived (${label})`);
    }
    equal((await listRaw(target.session)).map(({ messageId }) => messageId).sort(),
      preArchived ? target.messages.map(({ id }) => id).sort() : [], `Unexpected Raw rows before capture (${label})`);
    const before = await memoryTexts();
    equal((await service.enqueueCapture(scope, { ...target.selection, messages: target.messages })).status,
      "accepted", `The target capture must be admitted (${label})`);
    const admitted = JSON.stringify(await readDump(ctx.harness));
    check(deleted.every(([input]) => admitted.includes(input)), `The store dump must expose the admitted text (${label})`);
    await inject("before capture");
    await service.runCapture(scope, target.selection);

    check(rawAfterDelete !== undefined, `The deletion must commit at the requested timing (${label})`);
    equal(rawAfterDelete, [], `Conversation deletion must remove its Raw rows (${label})`);
    /** @param {string} checkpoint @param {boolean} physical */
    const checkTarget = async (checkpoint, physical) => {
      equal(await listRaw(target.session), [], `Deleted conversation must leave no Raw rows (${checkpoint})`);
      const snapshot = await readDump(ctx.harness);
      const dump = JSON.stringify(snapshot).toLowerCase();
      const collapsedDump = JSON.stringify(snapshot, (_key, value) =>
        typeof value === "string" ? collapseWhitespace(value) : value).toLowerCase();
      /** @param {string} text */
      const contains = text => dump.includes(JSON.stringify(text).slice(1, -1).toLowerCase()) ||
        collapsedDump.includes(JSON.stringify(collapseWhitespace(text)).slice(1, -1).toLowerCase());
      for (const [input, output] of deleted) {
        check(!contains(input), `Deleted message text must be absent from the store (${checkpoint})`);
        check(!contains(output), `Deleted extraction text must be absent from the store (${checkpoint})`);
      }
      const admission = await uow.run(owner, { readOnly: true }, tx => load.call(capture, tx, { scope, ...target.selection }));
      check(admission === null || admission.messages.every(({ content }) => content === ""),
        `Deleted capture must leave no message text in the ledger (${checkpoint})`);
      // A second delete clears whatever it finds, so it runs only after the control capture,
      // where it cannot mask a write-back that the control's archive would trigger.
      if (physical) {
        equal((await remove(target.session)).rawDeleted, 0,
          `Deleted conversation must leave no physically stored Raw rows (${checkpoint})`);
      }
    };
    await checkTarget(label, false);
    equal(await memoryTexts(), before, `Deleted conversation must leave no memory (${label})`);

    equal((await service.enqueueCapture(scope, { ...survivor.selection, messages: survivor.messages })).status,
      "accepted", `The control capture must be admitted (${label})`);
    await service.runCapture(scope, survivor.selection);
    await checkTarget(`${label}, after control capture`, true);
    equal(await memoryTexts(), [...before, controlOutput].sort(), `The control capture must store its memory (${label})`);
    equal((await listRaw(survivor.session)).map(({ messageId, content }) => [messageId, content]),
      [[survivor.messages[0].id, controlInput]], `The control capture must store its Raw row (${label})`);
  }
  for (const { untouched, label } of unrelated) {
    equal((await listRaw(untouched.session)).map(({ messageId, content }) => [messageId, content]),
      [[untouched.messages[0].id, untouched.messages[0].content]],
      `The unrelated conversation must keep its listed Raw row (${label})`);
    equal((await remove(untouched.session)).rawDeleted, 1,
      `The unrelated conversation must keep its physically stored Raw row (${label})`);
  }
}

/** @type {readonly ConformanceCase[]} */
export const CAPTURE_DELETE_CASES = [
  {
    id: "K-CAP-DEL-1", title: "deletion between admission and capture leaves no conversation content",
    needs: ["rawArchive"], run: ctx => captureDelete(ctx, "before capture"),
  },
  {
    id: "K-CAP-DEL-2", title: "deletion during extraction leaves no conversation content",
    needs: ["rawArchive"], run: ctx => captureDelete(ctx, "model call"),
  },
  {
    id: "K-CAP-DEL-3", title: "deletion during embedding leaves no conversation content",
    needs: ["rawArchive"], run: ctx => captureDelete(ctx, "embedder call"),
  },
];
