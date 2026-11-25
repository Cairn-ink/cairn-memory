import { factIncarnationBody, hostedV1Digest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { captureService, extract, message } from "./capture-documents-support.mjs";
import { assemblyClock, fixtureCount, formatAssembly } from "./context-assembly-cases.mjs";
import { check, equal, source } from "./support.mjs";

/** @import { TextFact } from "@cairn-ink/core" */
/** @import { MemoryServiceConfig } from "@cairn-ink/core/service" */
/** @import { ModelPort, Scope } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const forgotten = "The cedar gate opens at sunrise.";
const prefix = "The path crosses a river.";
const suffix = "The bridge is made of stone.";
const page = { cursor: null, limit: 10 };
const quote = `${forgotten} ${suffix}`;

/** @param {CaseContext} ctx @param {string} text @returns {Promise<TextFact>} */
async function textFact(ctx, text) {
  return {
    owner: ctx.owner, namespace: null, kind: "text", origin: "forget", mode: "full",
    actionId: crypto.randomUUID(), explicitSaveExemptAfterUs: String(BigInt(Date.now() - 60_000) * 1000n),
    text: { digests: [await hostedV1Digest(text)], keyId: null, shingles: null, embedding: ctx.vec(0) },
  };
}

/** @param {CaseContext} ctx @param {string} [text] */
async function seed(ctx, text = forgotten) {
  await ctx.harness.seedFact(ctx.owner, await textFact(ctx, text));
}

/** @param {CaseContext} ctx @param {MemoryServiceConfig} [config] @param {ModelPort["call"]} [call] */
function fixture(ctx, config = {}, call) {
  return captureService({ ...ctx, embeddingDimensions: ctx.vec(1).length, vec: () => ctx.vec(1) }, config, call);
}

/** @param {ReturnType<typeof fixture>} f @param {string} text */
async function expectSuppressed({ service, scope }, text) {
  equal((await service.save(scope, text, source)).status, "suppressed", "Explicit save must suppress the passage");
}

/** @param {ReturnType<typeof fixture>} f @param {Scope} [scope] @param {readonly string[]} [expected] */
async function expectList(f, scope = f.scope, expected = []) {
  equal((await f.service.recent(scope, page)).items.map(({ text }) => text), expected, "Recent list exposes saved text");
  equal((await f.service.exportMemories(scope, page)).items.map(({ text }) => text), expected, "Export exposes saved text");
}

/** @param {CaseContext} ctx @param {string} text */
async function expectVisible(ctx, text) {
  await seed(ctx);
  const f = fixture(ctx);
  equal((await f.service.save(f.scope, text, source)).status, "saved", "Unmatched text must be saved");
  await expectList(f, f.scope, [text]);
}

/** @type {readonly ConformanceCase[]} */
export const LEGACY_PASSAGE_CASES = [
  {
    id: "K-LEG-PASS-1", title: "an explicit save cannot restore a forgotten opening sentence",
    needs: [], requests: { contextRead: true, documentCards: true },
    async run(ctx) {
      await seed(ctx);
      const f = fixture(ctx);
      await expectSuppressed(f, quote);
      await expectList(f);
      const { service, scope } = f;
      equal((await service.recall(scope, "cedar gate", { ...page, mode: "search" })).items, [], "Recall is empty");
      if (ctx.adapter.capabilities.contextRead) {
        const { readContext } = createMemoryService({
          storage: { name: "conformance", ...ctx.adapter }, config: {}, clock: assemblyClock(), gate: { async assertOpen() {} },
          embedder: { model: "unused", dimensions: ctx.vec(1).length, async embed() { throw new Error("Context Read used the embedder"); } },
          tokens: { countTokens: fixtureCount }, contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly,
        });
        check(readContext, "Expected Context Read");
        const result = await readContext({ owner: scope.owner, namespaces: [null], accessGenerations: [1] },
          { query: "cedar gate", types: ["memory"], intent: "current", raw: false });
        equal(result.assembly.items, [], "Context Read is empty");
      }
      const cards = ctx.adapter.documentCards;
      if (cards) equal(await f.read(tx => cards.list(tx, scope)), [], "Card list is empty");
    },
  },
  {
    id: "K-LEG-PASS-2", title: "matches interior, final, CJK, lowercase and newline sentences", needs: [],
    async run(ctx) {
      await seed(ctx);
      await seed(ctx, "杉木門在早上開。");
      await seed(ctx, "橋在河上！");
      await seed(ctx, "船在水上？");
      await seed(ctx, "The wooden gate faces east");
      const f = fixture(ctx);
      for (const text of [
        `${prefix} ${forgotten} ${suffix}`, `${prefix} ${forgotten}`, `${prefix} ${forgotten.toLowerCase()} ${suffix}`,
        "杉木門在早上開。門是紅色的。", "橋在河上！橋很寬。", "船在水上？河水很深。",
        "The path crosses a river\nThe wooden gate faces east\r\nThe bridge is made of stone",
      ]) await expectSuppressed(f, text);
    },
  },
  {
    id: "K-LEG-PASS-3", title: "matches two- and six-sentence runs", needs: [],
    async run(ctx) {
      const f = fixture(ctx);
      for (const count of [2, 6]) {
        const passage = Array.from({ length: count }, (_, i) => `Locker ${count}-${i} is open.`).join(" ");
        await seed(ctx, passage);
        await expectSuppressed(f, `${prefix} ${passage} ${suffix}`);
      }
    },
  },
  {
    id: "K-LEG-PASS-4", title: "checks a 250-sentence save and suppresses over-cap text", needs: [],
    async run(ctx) {
      await seed(ctx);
      const f = fixture(ctx);
      await expectSuppressed(f, `${(prefix + " ").repeat(173)}${forgotten} ${(suffix + " ").repeat(76).trim()}`);
      await expectSuppressed(f, "Go. ".repeat(2_001).trim());
    },
  },
  {
    id: "K-LEG-PASS-5", title: "uses historical whitespace and Unicode normalization", needs: [],
    async run(ctx) {
      await seed(ctx, "Café table 4 is blue.");
      const f = fixture(ctx);
      for (const passage of ["CAFÉ  table 4 is blue.", "Café\ntable 4 is blue.", "Cafe\u0301 table ４ is blue."]) {
        await expectSuppressed(f, `${prefix} ${passage} ${suffix}`);
      }
    },
  },
  {
    id: "K-LEG-PASS-6", title: "checks the historical redacted spelling of an incoming passage", needs: [],
    async run(ctx) {
      const pass = "The fixture token was sk-NotARealSecret0123456789.";
      await seed(ctx, pass);
      const f = fixture(ctx);
      await expectSuppressed(f, `${prefix} ${pass} ${suffix}`);
    },
  },
  {
    id: "K-LEG-PASS-7", title: "withholds capture source text, capture outputs and imported rows", needs: [],
    async run(ctx) {
      await seed(ctx);
      let calls = 0;
      const f = fixture(ctx, {}, async () => {
        calls++;
        return { items: [extract(calls === 1 ? quote : "A model output from a withheld source.")] };
      });
      const captured = await f.capture("source-check", "quoted-message", [message("quoted", quote)]);
      equal(calls, 0, "A withheld source must be filtered before extraction");
      equal(captured?.memories, [], "Capture from a withheld source commits no memory");

      const extracted = await f.capture("output-check", "quoted-output", [message("unrelated", prefix)]);
      equal(calls, 1, "An unrelated source must reach extraction");
      equal(extracted?.memories, [], "A model output quoting the passage commits no memory");

      const imported = await f.service.importMemories(f.scope, [{ kind: "fact", text: quote }],
        { kind: "import", client: null, sessionId: null });
      equal(imported, { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 }, "Import suppresses the row");
      await expectList(f);
    },
  },
  {
    id: "K-LEG-PASS-7-router", title: "withholds a routed card when the passage fact arrives at finish",
    needs: ["documentCards", "rawArchive"],
    async run(ctx) {
      const { capture, documentCards, suppressions } = ctx.adapter;
      check(documentCards, "Expected document card storage");
      const passage = `${forgotten} ${suffix}`;
      const fact = await textFact(ctx, passage);
      const incarnation = (await ctx.hash(factIncarnationBody(fact))).slice(7);
      let puts = 0;
      let writeFactAtFinish = false;
      const f = fixture({ ...ctx, adapter: { ...ctx.adapter,
        capture: { ...capture, async finish(tx, token, items) {
          const result = await capture.finish(tx, token, items);
          if (writeFactAtFinish) await suppressions.writeFact(tx, fact, incarnation);
          return result;
        } },
        documentCards: { ...documentCards, async put(...args) {
          puts++;
          return documentCards.put(...args);
        } },
      } }, { documentCards: { enabled: true } });
      const introduction = "Remember this maintenance plan. " + (prefix + " ").repeat(7);
      await f.capture("route-control", "route-unrelated", [message("control", introduction.trim())]);
      equal(puts, 1, "Unrelated document is routed");
      writeFactAtFinish = true;
      await f.capture("route-check", "route-quote", [message("quoting", introduction + passage)]);
      equal(puts, 1, "The router never writes the card that quotes the passage");
      equal((await f.read(tx => documentCards.list(tx, f.scope))).map(card => card.sourceMessage?.messageId),
        ["control"], "Only the control card is listed");
    },
  },
  {
    id: "K-LEG-PASS-8", title: "refuses a correction and preserves the original memory", needs: [],
    async run(ctx) {
      await seed(ctx);
      const f = fixture(ctx);
      const saved = await f.service.save(f.scope, prefix, source);
      check(saved.status === "saved", "Original memory must be saved");
      const { id, revision } = saved.item;
      equal((await f.service.correct(f.scope, id, revision, quote, source)).status, "suppressed", "Correction is suppressed");
      const current = await f.service.read(f.scope, { type: "memory", id });
      check(current.status === "found", "Original memory remains readable");
      equal([current.item.text, current.item.revision], [prefix, revision], "Original text and revision are preserved");
    },
  },
  {
    id: "K-LEG-PASS-9", title: "still suppresses a whole-text digest match", needs: [],
    async run(ctx) {
      await seed(ctx);
      await expectSuppressed(fixture(ctx), forgotten);
    },
  },
  {
    id: "K-LEG-PASS-10", title: "matches only facts scoped to the writing owner", needs: [],
    async run(ctx) {
      await seed(ctx);
      const other = { owner: ctx.otherOwner, namespace: null };
      const f = fixture(ctx);
      equal((await f.service.save(other, quote, source)).status, "saved", "Another owner can save the text");
      await expectList(f, other, [quote]);

      const { suppressions } = ctx.adapter;
      const { passages } = await f.read(tx => suppressions.snapshot(tx, f.scope, {}));
      equal(passages.length, 1, "Expected one fact belonging to the first owner");
      const guarded = fixture({ ...ctx, vec: () => ctx.vec(2), adapter: { ...ctx.adapter, suppressions: { ...suppressions,
        async snapshot(tx, scope, candidates) {
          const snapshot = await suppressions.snapshot(tx, scope, candidates);
          return { ...snapshot, passages: [...snapshot.passages, ...passages] };
        },
      } } });
      equal((await guarded.service.save(other, `${quote} ${prefix}`, source)).status, "saved",
        "The write gate must ignore a foreign fact even if a snapshot incorrectly supplies it");
    },
  },
  {
    id: "K-LEG-PASS-N1", title: "admits unrelated text with a distant vector", needs: [],
    async run(ctx) { await expectVisible(ctx, `${prefix} ${suffix}`); },
  },
  {
    id: "K-LEG-PASS-N2", title: "admits partial or reordered sentences", needs: [],
    async run(ctx) { await expectVisible(ctx, "At sunrise the cedar gate opens. Someone painted the cedar gate."); },
  },
];
