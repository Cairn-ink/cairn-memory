import { caught, check, equal, row } from "./support.mjs";

/** @import { CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const needsRevision = "needs memories.committedIndexRevision";

/** @param {CaseContext} ctx */
function revisionRuns({ adapter: { uow, memories }, owner }) {
  if (!memories?.indexRevision || !memories.committedIndexRevision) return null;
  const startRevision = memories.indexRevision.bind(memories);
  const committedRevision = memories.committedIndexRevision.bind(memories);

  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const write = work => uow.run(owner, { pauseLock: true }, work);
  const read = () => uow.run(owner, { readOnly: true }, startRevision);

  /** @param {Tx} tx @param {string} scenario @param {(tx: Tx) => Promise<unknown>} [work] */
  async function observe(tx, scenario, work) {
    const start = await startRevision(tx);
    if (work) await work(tx);
    const pinned = await startRevision(tx);
    equal(pinned, start, `${scenario}: start revision changed within the run (${start} to ${pinned})`);
    return { start, committed: await committedRevision(tx) };
  }

  /** @param {string} scenario @param {(tx: Tx) => Promise<unknown>} [work] */
  async function commit(scenario, work) {
    const { start, committed } = await write(tx => observe(tx, scenario, work));
    if (!work) equal(committed, start, `${scenario}: committed revision before writes (${committed}) must equal start (${start})`);
    const next = await read();
    equal(next, committed, `${scenario}: next start (${next}) must equal committed revision (${committed}); run start was ${start}`);
    if (work) check(committed !== start, `${scenario}: committed revision must differ from start (${start})`);
  }

  return { write, read, observe, commit };
}

const rawSession = () => ({ client: "test-client", sessionId: crypto.randomUUID() });

/** @type {readonly ConformanceCase[]} */
export const COMMITTED_INDEX_CASES = [
  {
    id: "K-IDX-COMMIT-1", title: "reports the committed revision of an empty run and a memory insert", needs: [],
    async run(ctx) {
      const runs = revisionRuns(ctx);
      if (!runs) return needsRevision;
      await runs.commit("No writes");

      const { memories } = ctx.adapter;
      if (!memories.insert) return;
      const scope = ctx.scope(null);
      const content = await row(ctx, "A stored memory");
      await runs.commit("Memory insert", tx => memories.insert(tx, scope, content, [], 1));
    },
  },
  {
    id: "K-IDX-COMMIT-2", title: "reports the committed revision after memory changes and supported Raw and card writes", needs: [],
    requests: { rawArchive: true, documentCards: true },
    async run(ctx) {
      const runs = revisionRuns(ctx);
      if (!runs) return needsRevision;
      const { capabilities, memories, raw, documentCards } = ctx.adapter;
      const scope = ctx.scope(null);
      if (memories.insert && memories.replaceContent) {
        const original = await row(ctx, "A memory to correct");
        const replacement = await row(ctx, "The corrected memory");
        const { id, revision } = await runs.write(tx => memories.insert(tx, scope, original, [], 1));
        await runs.commit("Memory correction", async tx => {
          const result = await memories.replaceContent(tx, scope, id, revision, replacement, null, 2);
          equal(result.outcome, "changed", "Expected to change the stored memory during correction");
        });
      }
      if (memories.insert && memories.touchDuplicate) {
        const content = await row(ctx, "A memory to merge");
        const { id, revision } = await runs.write(tx => memories.insert(tx, scope, content, [], 1));
        await runs.commit("Memory duplicate merge", async tx => {
          const result = await memories.touchDuplicate(tx, scope, id, [], { confidence: 0.9 }, 2);
          equal(result.outcome, "changed", "Expected the duplicate merge to change the stored memory");
          check(result.revision > revision, "Expected the duplicate merge to advance the memory revision");
        });
      }
      if (memories.insert && memories.erase) {
        const content = await row(ctx, "A memory to erase");
        const { id } = await runs.write(tx => memories.insert(tx, scope, content, [], 1));
        await runs.commit("Memory erase", async tx => {
          equal(await memories.erase(tx, scope, id), true, "Expected to erase the stored memory");
        });
      }

      if (capabilities.rawArchive && raw?.fenceSession) {
        const session = rawSession();
        await runs.commit("Raw fence", tx => raw.fenceSession(tx, scope, session));
      }
      if (capabilities.rawArchive && raw?.archive) {
        const conversation = rawSession();
        const key = { ...conversation, scope, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) };
        /** @type {CaptureMessage} */
        const message = { id: crypto.randomUUID(), role: "user", content: "The shelf is oak.", occurredAtMs: 1 };
        await runs.commit("Raw archive", async tx => {
          const { archived } = await raw.archive(tx, key, [message]);
          equal(archived, 1, "Expected to archive the new message");
        });
        if (raw.deleteConversation) {
          await runs.commit("Raw delete", async tx => {
            const { rawDeleted } = await raw.deleteConversation(tx, scope, conversation);
            equal(rawDeleted, 1, "Expected to delete the archived message");
          });
        }
      }

      if (capabilities.documentCards && documentCards?.put && documentCards.hide) {
        const body = "Cabinet inventory";
        const cardId = crypto.randomUUID();
        const contentHash = await ctx.hash(body);
        const { status } = await runs.write(tx => documentCards.put(tx, scope, {
          id: cardId, scope, origin: "manual", title: "Filed notes", body, contentHash, date: null,
          sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
        }));
        equal(status, "inserted", "Expected a stored card to hide");
        await runs.commit("Card hide", tx => documentCards.hide(tx, scope, cardId, "forget"));
      }
    },
  },
  {
    id: "K-IDX-COMMIT-3", title: "reports one committed revision after several writes in a run", needs: [],
    requests: { rawArchive: true },
    async run(ctx) {
      const runs = revisionRuns(ctx);
      if (!runs) return needsRevision;
      const { capabilities, memories, raw } = ctx.adapter;
      if (!memories.insert || !memories.erase) return;
      const scope = ctx.scope(null);
      const original = await row(ctx, "A memory to remove");
      const replacement = await row(ctx, "A memory to retain");
      const session = rawSession();
      const { id } = await runs.write(tx => memories.insert(tx, scope, original, [], 1));
      await runs.commit("Mixed writes", async tx => {
        await memories.insert(tx, scope, replacement, [], 2);
        equal(await memories.erase(tx, scope, id), true, "Expected to erase the stored memory during mixed writes");
        if (capabilities.rawArchive && raw?.fenceSession) await raw.fenceSession(tx, scope, session);
      });
    },
  },
  {
    id: "K-IDX-COMMIT-4", title: "rolls back a write and keeps the next start revision unchanged", needs: [],
    async run(ctx) {
      const runs = revisionRuns(ctx);
      if (!runs) return needsRevision;
      const { memories, uow } = ctx.adapter;
      if (!memories.insert) return;
      const scope = ctx.scope(null);
      const content = await row(ctx, "A memory to roll back");
      const before = await runs.read();
      const abort = new Error("Roll back the fixture run");
      /** @type {number | undefined} */
      let aborted;
      /** @type {string | undefined} */
      let insertedId;
      const error = await caught(() => runs.write(async tx => {
        const { start, committed } = await runs.observe(tx, "Rollback", async tx => {
          ({ id: insertedId } = await memories.insert(tx, scope, content, [], 1));
        });
        equal(start, before, `Rollback: run start (${start}) must equal prior start (${before})`);
        aborted = committed;
        throw abort;
      }));
      if (error !== abort) throw error;
      const next = await runs.read();
      equal(next, before, `Rollback: next start (${next}) must equal pre-run start (${before}); aborted revision was ${aborted}`);
      check(insertedId !== undefined, "Expected to insert a memory before rollback");
      const id = insertedId;
      const stored = await uow.run(ctx.owner, { readOnly: true }, tx => memories.get(tx, scope, id));
      equal(stored, null, "Rollback: the inserted memory must be absent after abort");
    },
  },
];
