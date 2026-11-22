import { assertAdapterCapabilities, ERROR_CODES, toCoreError } from "@cairn-ink/core";
import { bounded, caught, check, equal, gate, observe, rejects, row } from "./support.mjs";

/** @type {import("./index.d.mts").ConformanceCase[]} */
export const unitOfWorkCases = [
  {
    id: "K-UOW-1", title: "rolls back callback and port failures", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const first = await row(ctx, "first");
      const second = await row(ctx, "second");
      const before = await harness.dump();
      const failure = new Error("callback failure");
      check(await caught(() => uow.run(owner, {}, async (tx) => {
        await memories.insert(tx, scope, first, [], 1);
        await memories.insert(tx, scope, second, [], 2);
        throw failure;
      })) === failure, "Callback error identity changed");
      equal(await harness.dump(), before, "Callback failure did not roll back");

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
      equal(await harness.dump(), before, "Port failure did not roll back");
    },
  },
  {
    id: "K-UOW-2", title: "serializes writers per owner", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner, otherOwner } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "serialized");
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
          await uow.run(otherOwner, {}, async (tx) => {
            await memories.insert(tx, { ...scope, owner: otherOwner }, content, [], 1);
          });
          check(!entered, "Second writer entered before the first writer released");
          release.release(undefined);
          await first;
          equal((await second)?.id, id, "Second writer did not see the first commit");
        });
      } finally {
        release.release(undefined);
      }
    },
  },
  {
    id: "K-UOW-3", title: "serializes writers that take the pause lock", needs: [],
    async run({ adapter: { uow }, owner, otherOwner }) {
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
          equal(entered.length, 0, "Another writer entered while the first held both locks");
          release.release(undefined);
          await Promise.all([first, second, third]);
          equal(entered.length, 2, "Both waiting writers should finish");
        });
      } finally {
        release.release(undefined);
      }
    },
  },
  {
    id: "K-UOW-4", title: "keeps a read-only snapshot across a concurrent commit", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner } = ctx;
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
            equal(await memories.get(tx, scope, id), null, "Reader saw an uncommitted row");
          });
          const reader = observe(uow.run(owner, { readOnly: true }, async (tx) => {
            equal(await memories.get(tx, scope, id), null, "Snapshot started with an uncommitted row");
            snapshotRead.release(undefined);
            await releaseReader.promise;
            equal(await memories.get(tx, scope, id), null, "Snapshot changed after a concurrent commit");
          }));
          await Promise.race([snapshotRead.promise, reader]);
          releaseWriter.release(undefined);
          await writer;
          releaseReader.release(undefined);
          await reader;
          await uow.run(owner, { readOnly: true }, async (tx) => {
            equal((await memories.get(tx, scope, id))?.id, id, "A new snapshot missed the commit");
          });
        });
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
      const expired = await uow.run(owner, {}, async (tx) => {
        await rejects(() => memories.get(Object.freeze({ ...tx }), scope, "missing"), "internal_error");
        await rejects(() => memories.get(tx, { ...scope, owner: otherOwner }, "missing"), "internal_error");
        return tx;
      });
      await rejects(() => memories.get(expired, scope, "missing"), "internal_error");
      await uow.run(owner, { readOnly: true }, async (tx) => {
        await rejects(() => memories.insert(tx, scope, content, [], 1), "internal_error");
      });
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
