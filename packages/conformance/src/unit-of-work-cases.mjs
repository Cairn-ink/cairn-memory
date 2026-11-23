// Compare port results by projecting the needed fields into plain tuples or objects.
// Documented plain shapes may be compared whole when every field is asserted. Dumps are JSON-only.
import { assertAdapterCapabilities, ERROR_CODES, NEAR_DUPLICATE_DISTANCE, toCoreError } from "@cairn-ink/core";
import { bounded, caught, check, DEFAULT_TIMEOUT_MS, equal, gate, observe, readDump, rejects, row, wait } from "./support.mjs";

/** @type {import("./index.d.mts").ConformanceCase[]} */
export const unitOfWorkCases = [
  {
    id: "K-UOW-1", title: "rolls back callback and port failures", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const first = await row(ctx, "first");
      const second = await row(ctx, "second");
      const before = await readDump(harness);
      const failure = new Error("callback failure");
      check(await caught(() => uow.run(owner, {}, async (tx) => {
        await memories.insert(tx, scope, first, [], 1);
        await memories.insert(tx, scope, second, [], 2);
        throw failure;
      })) === failure, "Callback error identity changed");
      equal(await readDump(harness), before, "Callback failure did not roll back");

      /** @type {unknown} */
      let portError;
      const runError = await caught(() => uow.run(owner, {}, async (tx) => {
        const { id } = await memories.insert(tx, scope, first, [], 1);
        try {
          await memories.replaceContent(tx, scope, id, 2, second, null, 2);
        } catch (error) {
          portError = error;
          throw error;
        }
      }));
      check(runError === portError, "Port error identity changed");
      await rejects(async () => { throw runError; }, "revision_conflict");
      equal(await readDump(harness), before, "Port failure did not roll back");
    },
  },
  {
    id: "K-UOW-2", title: "serializes writers per owner", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner, otherOwner, timeoutMs = DEFAULT_TIMEOUT_MS } = ctx;
      const scope = ctx.scope(null);
      const otherScope = { ...scope, owner: otherOwner };
      const content = await row(ctx, "serialized");
      const otherContent = ctx.adapter.capabilities.embeddingRequiredOnInsert ? await row(ctx, content.text) : content;
      /** @type {ReturnType<typeof gate<string>>} */
      const inserted = gate();
      const release = gate();
      try {
        await bounded(async () => {
          const first = observe(uow.run(owner, {}, async (tx) => {
            const { id } = await memories.insert(tx, scope, content, [], 1);
            inserted.release(id);
            await release.promise;
          }));
          const id = await Promise.race([inserted.promise, first.then(() => inserted.promise)]);
          let entered = false;
          const second = observe(uow.run(owner, {}, async (tx) => {
            entered = true;
            return memories.get(tx, scope, id);
          }));
          const other = await uow.run(otherOwner, {}, (tx) => memories.insert(tx, otherScope, otherContent, [], 1));
          check(!entered, "Second writer entered before the first writer released");
          release.release(undefined);
          await first;
          equal((await second)?.id, id, "Second writer did not see the first commit");
          const persisted = await uow.run(otherOwner, { readOnly: true }, (tx) => memories.get(tx, otherScope, other.id));
          equal(persisted?.id, other.id, "Another owner's committed row was lost");
        }, "Concurrent runs", timeoutMs);
      } finally {
        release.release(undefined);
      }
    },
  },
  {
    id: "K-UOW-3r", title: "takes the pause lock for read-only runs", needs: [],
    async run({ adapter: { uow }, owner, settleMs = 100, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const phaseMs = timeoutMs + settleMs;
      const readerStarted = gate();
      const releaseReader = gate();
      try {
        await bounded(async () => {
          const reader = observe(uow.run(owner, { pauseLock: true, readOnly: true }, async () => {
            readerStarted.release(undefined);
            await releaseReader.promise;
          }));
          await Promise.race([readerStarted.promise, reader]);
          let pausedEntered = false;
          const paused = observe(uow.run(owner, { pauseLock: true }, async () => { pausedEntered = true; }));
          // Give the paused writer time to reach its lock waits before starting the plain writer.
          await wait(settleMs);
          check(!pausedEntered, "Pause-lock writer entered while the reader held the pause lock");
          let writerEntered = false;
          await uow.run(owner, {}, async () => { writerEntered = true; });
          check(writerEntered, "Plain writer did not enter while the reader held the pause lock");
          check(!pausedEntered, "Pause-lock writer entered while the reader held the pause lock");
          releaseReader.release(undefined);
          await Promise.all([reader, paused]);
          check(pausedEntered, "Pause-lock writer did not enter after the reader released");
        }, "Concurrent runs", phaseMs);
      } finally {
        releaseReader.release(undefined);
      }
    },
  },
  {
    id: "K-UOW-3", title: "serializes writers with the pause and write locks", needs: [],
    async run({ adapter: { uow }, owner, otherOwner, settleMs = 100, timeoutMs = DEFAULT_TIMEOUT_MS }) {
      const phaseMs = timeoutMs + settleMs;
      const started = gate();
      const release = gate();
      try {
        await bounded(async () => {
          const first = observe(uow.run(owner, { pauseLock: true }, async () => {
            started.release(undefined);
            await release.promise;
          }));
          await Promise.race([started.promise, first]);
          const entered = [];
          const second = observe(uow.run(owner, {}, async () => { entered.push("write"); }));
          const third = observe(uow.run(owner, { pauseLock: true }, async () => { entered.push("pause"); }));
          await uow.run(otherOwner, { pauseLock: true }, async () => {});
          await wait(settleMs);
          equal(entered.length, 0, "Another writer entered while the first held both locks");
          release.release(undefined);
          await Promise.all([first, second, third]);
          equal(entered.length, 2, "Both waiting writers should finish");
        }, "Concurrent runs", phaseMs);
      } finally {
        release.release(undefined);
      }
    },
  },
  {
    id: "K-UOW-4", title: "keeps a read-only snapshot across a concurrent commit", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner, timeoutMs = DEFAULT_TIMEOUT_MS } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "snapshot");
      /** @type {ReturnType<typeof gate<string>>} */
      const inserted = gate();
      const releaseWriter = gate();
      const snapshotRead = gate();
      const releaseReader = gate();
      try {
        await bounded(async () => {
          const writer = observe(uow.run(owner, {}, async (tx) => {
            const { id } = await memories.insert(tx, scope, content, [], 1);
            inserted.release(id);
            await releaseWriter.promise;
          }));
          const id = await Promise.race([inserted.promise, writer.then(() => inserted.promise)]);
          await uow.run(owner, { readOnly: true }, async (tx) => {
            check(await memories.get(tx, scope, id) === null, "Reader saw an uncommitted row");
          });
          const reader = observe(uow.run(owner, { readOnly: true }, async (tx) => {
            check(await memories.get(tx, scope, id) === null, "Snapshot started with an uncommitted row");
            snapshotRead.release(undefined);
            await releaseReader.promise;
            check(await memories.get(tx, scope, id) === null, "Snapshot changed after a concurrent commit");
          }));
          await Promise.race([snapshotRead.promise, reader]);
          releaseWriter.release(undefined);
          await writer;
          releaseReader.release(undefined);
          await reader;
          await uow.run(owner, { readOnly: true }, async (tx) => {
            equal((await memories.get(tx, scope, id))?.id, id, "A new snapshot missed the commit");
          });
        }, "Concurrent runs", timeoutMs);
      } finally {
        releaseWriter.release(undefined);
        releaseReader.release(undefined);
      }
    },
  },
  {
    id: "K-UOW-7", title: "rejects forged, expired, read-only and wrong-owner handles", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner, otherOwner } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "handle");
      const { id } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, content, [], 1));
      const expired = await uow.run(owner, { readOnly: true }, async (tx) => {
        equal((await memories.get(tx, scope, id))?.id, id, "A live handle could not read the committed row");
        const forged = Object.freeze({ ...tx });
        await rejects(() => memories.get(forged, scope, id), "internal_error");
        await rejects(() => memories.readRevision(forged, scope, id), "internal_error");
        await rejects(() => memories.findDuplicates(forged, scope, [{ textHash: content.textHash }],
          { nearDistance: NEAR_DUPLICATE_DISTANCE }), "internal_error");
        await rejects(() => memories.get(tx, { ...scope, owner: otherOwner }, id), "internal_error");
        await rejects(() => memories.insert(tx, scope, content, [], 1), "internal_error");
        return tx;
      });
      await rejects(() => memories.get(expired, scope, id), "internal_error");
    },
  },
  {
    id: "K-ERR-1", title: "normalizes native error codes", needs: [],
    async run({ nativeErrorMap, busyNativeCodes }) {
      for (const [code, mapped] of Object.entries(nativeErrorMap)) {
        check(Object.hasOwn(ERROR_CODES, mapped), "Native mapping must be an own core error code");
        equal(toCoreError({ code }, nativeErrorMap).code, mapped, "Wrong native error mapping");
      }
      for (const code of busyNativeCodes) {
        check(Object.hasOwn(nativeErrorMap, code), "Busy native code is missing from the map");
        equal(toCoreError({ code }, nativeErrorMap).kind, "retryable", "Busy native code must be retryable");
      }
      let code = "unmapped_native";
      while (Object.hasOwn(nativeErrorMap, code)) code += "_";
      const unmapped = toCoreError({ code }, nativeErrorMap);
      equal(unmapped.code, "internal_error", "Unmapped error code");
      equal(unmapped.message, unmapped.code, "Error message leaked the native code");
    },
  },
  {
    id: "K-CAP-0", title: "aligns optional ports with capability flags", needs: [],
    async run({ adapter }) {
      assertAdapterCapabilities(adapter);
    },
  },
];
