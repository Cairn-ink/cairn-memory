import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock } from "./context-assembly-cases.mjs";
import { caught, check, equal, evidence, rejects, row, source } from "./support.mjs";

/** @import { InsertRow, ProceduralTag, ProceduralTagStore, Receipt, SaveOptions, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {CaseContext["adapter"] & { proceduralTags?: ProceduralTagStore }} Adapter */

const text = "Use 🧭 before leaving.";
const span = { receiptIndex: /** @type {const} */ (0), start: 4, end: 6 };
const clock = assemblyClock();

/** @param {string} messageId */
function receipt(messageId) {
  return { ...evidence(messageId, 1), role: /** @type {const} */ ("user") };
}

/** @param {string} messageId @returns {SaveOptions} */
function options(messageId) {
  return { receipt: receipt(messageId), procedural: { anchors: [span] } };
}

/** @param {CaseContext} ctx @returns {ProceduralTagStore} */
function tagsOf({ adapter }) {
  const tags = /** @type {Adapter} */ (adapter).proceduralTags;
  check(tags && typeof tags.write === "function" && typeof tags.clear === "function" &&
    typeof tags.read === "function", "proceduralTags requires a port with write, clear and read");
  return tags;
}

/** @param {CaseContext} ctx @param {Partial<Adapter>} [overrides] */
function service(ctx, overrides) {
  const countTokens = () => 0;
  return createMemoryService({
    storage: { name: "conformance", ...ctx.adapter, ...overrides },
    clock, config: {},
    model: { model: "unused", contextWindow: 1, countTokens,
      async call() { throw new Error("Procedural save used the model"); } },
    embedder: null,
    gate: { async assertOpen() {} },
    tokens: { countTokens },
  });
}

/** @template T @param {CaseContext} ctx @param {Scope} scope @param {(tx: Tx) => Promise<T>} work */
function write(ctx, scope, work) {
  return ctx.adapter.uow.run(scope.owner, { pauseLock: true }, work);
}

/** @template T @param {CaseContext} ctx @param {Scope} scope @param {(tx: Tx) => Promise<T>} work */
function read(ctx, scope, work) {
  return ctx.adapter.uow.run(scope.owner, { readOnly: true }, work);
}

/** @param {CaseContext} ctx @param {Scope} scope */
function revision(ctx, scope) {
  const { memories } = ctx.adapter;
  const start = memories.indexRevision?.bind(memories);
  check(start, "Expected memories.indexRevision");
  return read(ctx, scope, start);
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} scenario */
async function emptyScope(ctx, scope, scenario) {
  const { items } = await read(ctx, scope, tx =>
    ctx.adapter.memories.exportPage(tx, scope, { cursor: null, limit: 1 }));
  equal(items, [], `${scenario} must leave the scope empty`);
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} id */
async function storedReceipts(ctx, scope, id) {
  const { inspect } = ctx.adapter;
  check(inspect, "Inspect is needed to verify the stored receipt IDs");
  const { item } = await read(ctx, scope, tx => inspect.item(tx, scope, id, { limit: 10, includeQualification: false }));
  check(item, "Expected Inspect to return the stored memory");
  return item.receipts;
}

/** @param {string} receiptId @param {string} excerpt @returns {Promise<Omit<ProceduralTag, "tagRevision">>} */
async function positiveTag(receiptId, excerpt) {
  return {
    positive: true, origin: "explicit",
    anchors: [{ receiptId, digest: await clock.sha256Hex(excerpt), start: span.start, end: span.end }],
  };
}

/** @param {ProceduralTag | null} actual @param {Omit<ProceduralTag, "tagRevision">} expected */
function assertTag(actual, expected) {
  check(actual, "Expected a stored procedural tag");
  const { tagRevision, ...fields } = actual;
  check(Number.isSafeInteger(tagRevision) && tagRevision > 0, "Expected a positive integer tagRevision");
  equal(fields, expected, "Stored procedural tag must match its positive flag, origin and receipt anchors");
  return tagRevision;
}

/** @param {CaseContext} ctx */
async function portFixture(ctx) {
  const scope = ctx.scope(null);
  const tags = tagsOf(ctx);
  const { memories } = ctx.adapter;
  const input = /** @type {InsertRow} */ ({ ...await row(ctx, text), kind: "instruction" });

  /** @param {Tx} tx */
  async function seed(tx) {
    const { id, receiptIds } = await memories.insert(tx, scope, input, [{ ...receipt("first"), excerpt: text }], 1);
    check(receiptIds?.length === 1 && receiptIds[0], "Procedural insert must return its stored receipt ID");
    return { id, tag: await positiveTag(receiptIds[0], text) };
  }

  /** @param {string} id */
  const readTag = id => read(ctx, scope, tx => tags.read(tx, scope, id));
  async function tagged() {
    return write(ctx, scope, async tx => {
      const { id, tag } = await seed(tx);
      await tags.write(tx, scope, id, tag);
      return { id, tag };
    });
  }
  return { scope, tags, seed, tagged, readTag };
}

/** @param {CaseContext} ctx */
async function saveInstruction(ctx) {
  const scope = ctx.scope(null);
  const saved = await service(ctx).save(scope, text, source, "instruction", options("first"));
  check(saved.status === "saved", `Expected a saved instruction, got ${saved.status}`);
  return { scope, item: saved.item };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} id */
function clearingService(ctx, scope, id) {
  const tags = tagsOf(ctx);
  const { memories } = ctx.adapter;
  /** @type {Tx | undefined} */
  let clearTx;
  /** @type {Tx | undefined} */
  let rowTx;
  const memory = service(ctx, {
    proceduralTags: { ...tags, async clear(tx, target, memoryId) {
      equal(target, scope, "Expected clear to target the memory's scope");
      equal(memoryId, id, "Expected clear to target the changed memory");
      await tags.clear(tx, target, memoryId);
      clearTx = tx;
    } },
    memories: { ...memories,
      async replaceContent(...args) {
        rowTx = args[0];
        return memories.replaceContent(...args);
      },
      async erase(...args) {
        rowTx = args[0];
        return memories.erase(...args);
      },
    },
  });
  return {
    memory,
    assertCleared() {
      check(clearTx && clearTx === rowTx, "Expected the service to clear the tag in the memory write transaction");
    },
  };
}

/** @type {readonly ConformanceCase[]} */
export const PROCEDURAL_TAG_CASES = [
  {
    id: "K-PROC-1", title: "advertises procedural tags with a complete write, clear and read port", needs: ["proceduralTags"],
    async run(ctx) {
      tagsOf(ctx);
    },
  },
  {
    id: "K-PROC-2", title: "reads back a tag, advances its revision and shares the memory insert's index advance",
    needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, tags, seed, readTag } = await portFixture(ctx);
      const { memories } = ctx.adapter;
      const forecast = memories.committedIndexRevision?.bind(memories);
      check(forecast, "Expected memories.committedIndexRevision");
      const before = await revision(ctx, scope);
      const { id, tag, tagRevision } = await write(ctx, scope, async tx => {
        const { id, tag } = await seed(tx);
        const inserted = await forecast(tx);
        check(inserted !== before, "Memory insert must advance the owner revision");
        await tags.write(tx, scope, id, tag);
        equal(await forecast(tx), inserted, "A tag written with the memory must share its index advance");
        return { id, tag, tagRevision: assertTag(await tags.read(tx, scope, id), tag) };
      });
      const nextTag = { ...tag, origin: /** @type {const} */ ("inferred") };
      await write(ctx, scope, tx => tags.write(tx, scope, id, nextTag));
      check(assertTag(await readTag(id), nextTag) > tagRevision, "A second write must advance tagRevision");
    },
  },
  {
    id: "K-PROC-3", title: "isolates tag reads and clears by owner and namespace", needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, tags, tagged, readTag } = await portFixture(ctx);
      const { id, tag } = await tagged();
      const originalRevision = assertTag(await readTag(id), tag);
      for (const [label, other] of [
        /** @type {const} */ (["owner", { ...scope, owner: ctx.otherOwner }]),
        /** @type {const} */ (["namespace", ctx.scope("project\0other")]),
      ]) {
        equal(await read(ctx, other, tx => tags.read(tx, other, id)), null, `Tag read leaked across ${label}`);
        await write(ctx, other, tx => tags.clear(tx, other, id));
        equal(assertTag(await readTag(id), tag), originalRevision, `Tag clear crossed ${label}`);
      }
    },
  },
  {
    id: "K-PROC-4", title: "rolls back a tag, memory row and owner index revision together", needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, tags, seed, readTag } = await portFixture(ctx);
      const before = await revision(ctx, scope);
      const abort = new Error("Roll back the tag and memory");
      let insertedId = "";
      const error = await caught(() => write(ctx, scope, async tx => {
        const { id, tag } = await seed(tx);
        insertedId = id;
        await tags.write(tx, scope, id, tag);
        assertTag(await tags.read(tx, scope, id), tag);
        throw abort;
      }));
      if (error !== abort) throw error;
      equal(await readTag(insertedId), null, "Rolled-back tag must be absent");
      equal(await read(ctx, scope, tx => ctx.adapter.memories.get(tx, scope, insertedId)), null,
        "Rolled-back memory must be absent");
      equal(await revision(ctx, scope), before, "Rollback must preserve the owner revision");
    },
  },
  {
    id: "K-PROC-5", title: "leaves no positive tag and no receipt anchors after clearing a stored tag", needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, tags, tagged, readTag } = await portFixture(ctx);
      const { id } = await tagged();
      await write(ctx, scope, tx => tags.clear(tx, scope, id));
      // A cleared tag may read back as absent or as a negative marker; neither keeps an anchor.
      const cleared = await readTag(id);
      if (cleared !== null) assertTag(cleared, { positive: false, origin: null, anchors: [] });
    },
  },
  {
    id: "K-PROC-6", title: "clears an untagged memory without changing the tag or owner revision", needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, tags, seed, readTag } = await portFixture(ctx);
      const { id } = await write(ctx, scope, seed);
      const before = await revision(ctx, scope);
      await write(ctx, scope, tx => tags.clear(tx, scope, id));
      equal(await readTag(id), null, "Clear must leave an untagged memory untagged");
      equal(await revision(ctx, scope), before, "Clearing an untagged memory must be a no-op");
    },
  },
  {
    id: "K-PROC-7", title: "saves instructions and preferences with stored receipt anchors and the committed index revision",
    needs: ["proceduralTags"], requests: { inspect: true },
    async run(ctx) {
      const scope = ctx.scope(null);
      const tags = tagsOf(ctx);
      const memory = service(ctx);
      for (const kind of /** @type {const} */ (["instruction", "preference"])) {
        const content = `${text} Keep this ${kind} handy.`;
        const before = await revision(ctx, scope);
        const saved = await memory.save(scope, content, source, kind, options(kind));
        check(saved.status === "saved", `Expected a saved ${kind}, got ${saved.status}`);
        equal(saved.item.kind, kind, "Expected the saved memory kind");
        const after = await revision(ctx, scope);
        check(after !== before, "Procedural save must advance the owner revision");
        equal(saved.indexRevision, after, "Save must report the next run's index revision");
        const { id } = saved.item;
        const receipts = await storedReceipts(ctx, scope, id);
        equal(receipts.length, 1, "Expected a single stored explicit receipt");
        equal(receipts[0].messageId, kind, "Expected the explicit receipt at input index zero");
        assertTag(await read(ctx, scope, tx => tags.read(tx, scope, id)),
          await positiveTag(receipts[0].id, receipts[0].excerpt));
      }
    },
  },
  {
    id: "K-PROC-8", title: "rejects invalid procedural options without writing memory, tags or index revision",
    needs: ["proceduralTags"],
    async run(ctx) {
      const scope = ctx.scope(null);
      const tags = tagsOf(ctx);
      let tagWrites = 0;
      const { save } = service(ctx, { proceduralTags: { ...tags,
        async write(...args) {
          tagWrites++;
          await tags.write(...args);
        },
      } });
      const before = await revision(ctx, scope);
      /** @type {readonly [string, readonly { receiptIndex: number, start: number, end: number }[]][]} */
      const invalid = [
        ["zero anchors", []],
        ["five anchors", Array(5).fill(span)],
        ["receipt index one", [{ ...span, receiptIndex: 1 }]],
        ["empty span", [{ ...span, end: span.start }]],
        ["end beyond excerpt", [{ ...span, end: text.length + 1 }]],
        ["fractional offset", [{ ...span, start: 4.5 }]],
        ["split surrogate at start", [{ ...span, start: 5 }]],
        ["split surrogate at end", [{ ...span, end: 5 }]],
        ["fact kind", [span]],
        ["no explicit receipt", [span]],
      ];
      for (const [label, anchors] of invalid) {
        const kind = label === "fact kind" ? "fact" : "instruction";
        const input = { ...(label !== "no explicit receipt" && { receipt: receipt("invalid") }), procedural: { anchors } };
        const result = await save(scope, text, source, kind, /** @type {SaveOptions} */ (input));
        equal(result.status, "invalid", `Expected invalid status for ${label}, got ${result.status}`);
        await emptyScope(ctx, scope, label);
        equal(tagWrites, 0, `Invalid input must never write a tag (${label})`);
        equal(await revision(ctx, scope), before, `Invalid input must preserve the owner revision (${label})`);
      }
    },
  },
  {
    id: "K-PROC-9", title: "clears a positive tag when correct changes the memory text", needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, item: { id, revision } } = await saveInstruction(ctx);
      const { memory, assertCleared } = clearingService(ctx, scope, id);
      const tags = tagsOf(ctx);
      const readTag = () => read(ctx, scope, tx => tags.read(tx, scope, id));
      check((await readTag())?.positive, "Expected a positive tag before correction");
      const replacement = "Use a map before leaving.";
      const corrected = await memory.correct(scope, id, revision, replacement, source);
      check(corrected.status === "saved", `Expected a saved correction, got ${corrected.status}`);
      equal(corrected.item.text, replacement, "Correct must save the replacement text");
      const cleared = await readTag();
      if (cleared !== null) assertTag(cleared, { positive: false, origin: null, anchors: [] });
      assertCleared();
    },
  },
  {
    id: "K-PROC-10", title: "clears the tag on forget and leaves no tag to read", needs: ["proceduralTags"],
    async run(ctx) {
      const { scope, item: { id } } = await saveInstruction(ctx);
      const { memory, assertCleared } = clearingService(ctx, scope, id);
      const tags = tagsOf(ctx);
      const readTag = () => read(ctx, scope, tx => tags.read(tx, scope, id));
      check((await readTag())?.positive, "Expected a positive tag before forget");
      equal((await memory.forget(scope, id, source)).status, "forgotten", "Expected the memory to be forgotten");
      equal(await readTag(), null, "The forgotten memory's tag must be absent");
      assertCleared();
    },
  },
  {
    id: "K-PROC-11", title: "binds a procedural duplicate to the new receipt's stored ID",
    needs: ["proceduralTags"], requests: { inspect: true },
    async run(ctx) {
      const { scope, item: { id } } = await saveInstruction(ctx);
      const tags = tagsOf(ctx);
      const duplicate = await service(ctx).save(scope, text, source, "instruction", options("second"));
      check(duplicate.status === "duplicate", `Expected duplicate status, got ${duplicate.status}`);
      equal(duplicate.item.id, id, "Expected the duplicate to match the existing memory");
      const receipts = await storedReceipts(ctx, scope, id);
      equal(receipts.length, 2, "Expected both explicit receipts");
      const first = receipts.find(item => item.messageId === "first");
      const second = receipts.find(item => item.messageId === "second");
      check(first && second && first.id !== second.id, "Expected distinct stored IDs for both receipts");
      assertTag(await read(ctx, scope, tx => tags.read(tx, scope, id)), await positiveTag(second.id, second.excerpt));
    },
  },
  {
    id: "K-PROC-12", title: "reuses the stored receipt ID and writes a tag when a procedural duplicate repeats its receipt",
    needs: ["proceduralTags"], requests: { inspect: true },
    async run(ctx) {
      const { scope, item: { id } } = await saveInstruction(ctx);
      const tags = tagsOf(ctx);
      const repeated = options("second");
      equal((await service(ctx).save(scope, text, source, "instruction", repeated)).status, "duplicate",
        "Expected to attach the new receipt before replay");
      const before = await storedReceipts(ctx, scope, id);
      const original = before.find(item => item.messageId === "second");
      check(original, "Expected the stored receipt to replay");
      const expected = await positiveTag(original.id, original.excerpt);
      const readTag = () => read(ctx, scope, tx => tags.read(tx, scope, id));
      const initial = assertTag(await readTag(), expected);
      const { memories } = ctx.adapter;
      /** @type {readonly string[] | undefined} */
      let receiptIds;
      const { save } = service(ctx, { memories: { ...memories,
        async touchDuplicate(...args) {
          const result = await memories.touchDuplicate(...args);
          receiptIds = result.receiptIds;
          return result;
        },
      } });
      const duplicate = await save(scope, text, source, "instruction", repeated);
      check(duplicate.status === "duplicate", `Expected repeated receipt to return duplicate, got ${duplicate.status}`);
      equal(duplicate.item.id, id, "Expected the duplicate to match the existing memory");
      equal(receiptIds, [original.id], "Expected touchDuplicate to return the reused stored receipt ID");
      const after = await storedReceipts(ctx, scope, id);
      equal(after.map(item => item.id).sort(), before.map(item => item.id).sort(), "Replay must reuse the stored receipt");
      check(assertTag(await readTag(), expected) > initial, "Replay must write a new tag revision for the same receipt");
    },
  },
  {
    id: "K-PROC-13", title: "exposes no procedural tag port and refuses procedural saves before writing when disabled",
    needs: [], needsOff: ["proceduralTags"],
    async run(ctx) {
      check(/** @type {Adapter} */ (ctx.adapter).proceduralTags == null, "Disabled proceduralTags must have no tag port");
      const scope = ctx.scope(null);
      const before = await revision(ctx, scope);
      await rejects(() => service(ctx).save(scope, text, source, "instruction", options("disabled")), "capability_unavailable");
      await emptyScope(ctx, scope, "Capability refusal");
      equal(await revision(ctx, scope), before, "Capability refusal must preserve the owner revision");
    },
  },
];

/** @param {CaseContext} ctx @param {Scope} scope @param {string} id @param {readonly Receipt[]} inputs
 * @param {readonly string[] | undefined} receiptIds @param {string} operation
 */
async function assertReceiptIds(ctx, scope, id, inputs, receiptIds, operation) {
  if (receiptIds === undefined) {
    check(ctx.adapter.capabilities.proceduralTags !== true, `${operation} must return receiptIds with proceduralTags enabled`);
    return `${operation} does not return receiptIds`;
  }
  const receipts = await storedReceipts(ctx, scope, id);
  const storedIds = inputs.map(input => {
    const stored = receipts.find(item => item.client === input.client &&
      item.sessionId === input.sessionId && item.messageId === input.messageId);
    check(stored?.id, `${operation} must store the receipt for ${input.messageId} with an ID`);
    return stored.id;
  });
  equal(new Set(storedIds).size, inputs.length, `${operation} must store distinct receipts under distinct IDs`);
  equal(receiptIds, storedIds, `${operation} must return stored receipt IDs in input order`);
}

/** @type {readonly ConformanceCase[]} */
export const RECEIPT_ID_CASES = [
  {
    id: "K-RID-1", title: "returns the stored IDs of inserted receipts in input order", needs: [], requests: { inspect: true },
    async run(ctx) {
      const scope = ctx.scope(null);
      const input = await row(ctx, text);
      const receipts = ["second", "first"].map(id => ({ ...receipt(id), excerpt: text }));
      const { id, receiptIds } = await write(ctx, scope, tx => ctx.adapter.memories.insert(tx, scope, input, receipts, 1));
      return assertReceiptIds(ctx, scope, id, receipts, receiptIds, "insert");
    },
  },
  {
    id: "K-RID-2", title: "returns the stored IDs of receipts newly attached by touchDuplicate in input order",
    needs: [], requests: { inspect: true },
    async run(ctx) {
      const scope = ctx.scope(null);
      const { memories } = ctx.adapter;
      const input = await row(ctx, text);
      const { id } = await write(ctx, scope, tx => memories.insert(tx, scope, input, [{ ...receipt("original"), excerpt: text }], 1));
      const receipts = ["second", "first"].map(id => ({ ...receipt(id), excerpt: text }));
      const { receiptIds } = await write(ctx, scope, tx => memories.touchDuplicate(tx, scope, id, receipts, { confidence: 1 }, 2));
      return assertReceiptIds(ctx, scope, id, receipts, receiptIds, "touchDuplicate");
    },
  },
];
