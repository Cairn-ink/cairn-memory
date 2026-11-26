import { check, equal, readDump } from "./support.mjs";

/** @import { CaptureMessage, Scope } from "@cairn-ink/core/ports" */
/** @import { ConformanceCase } from "./index.d.mts" */

export const forgottenText = "Saffron window import sentinel";
export const disabledText = "Cobalt disabled import sentinel";
export const enabledText = "Juniper enabled import sentinel";
export const missingCaptureDisable = "needs a namespace capture-disable control";

/** @param {Scope} [disabledScope] @returns {ConformanceCase} */
export function rawImportControlsCase(disabledScope) {
  return {
    id: "K-IMP-RAW-11",
    title: "Raw import honours namespace capture-disable and window forget",
    needs: ["rawArchive", "rawWindowHide"],
    async run({ adapter: { raw, uow }, harness, owner, otherOwner }) {
      check(raw, "Raw archive requires the raw port");
      const importArchive = raw.importArchive?.bind(raw);
      check(importArchive, "Raw import requires raw.importArchive");
      const enabled = { owner: disabledScope?.owner ?? owner, namespace: "project\0enabled-project" };
      const session = { client: "codex", sessionId: "archive-session" };
      /** @param {Scope} selection @param {CaptureMessage[]} messages */
      const importMessages = (selection, messages) => uow.run(selection.owner, { pauseLock: true },
        tx => importArchive(tx, selection, session, messages));
      /** @param {Scope} scope @param {string} query */
      const search = ({ owner, namespace }, query) => uow.run(owner, { readOnly: true },
        tx => raw.raw(tx, { owner, namespaces: [namespace] }, query, "search", { limit: 10 }));

      await harness.seedFact(enabled.owner, {
        ...enabled, actionId: "window-forget", origin: "forget",
        kind: "window", client: session.client, window: { startMs: 10, endMs: 20 },
      });
      /** @type {CaptureMessage} */
      const forgotten = { id: "window-turn", role: "user", content: forgottenText, occurredAtMs: 10 };
      const control = { ...forgotten, id: "enabled-turn", content: enabledText, occurredAtMs: 20 };
      equal(await importMessages(enabled, [forgotten, control]), { archived: 1, existing: 0, withheld: 1 },
        "An import must withhold the forgotten turn and archive the turn outside the window");
      const page = await uow.run(enabled.owner, { readOnly: true },
        tx => raw.listRaw(tx, { owner: enabled.owner, namespaces: [enabled.namespace] }, { cursor: null, limit: 10 }));
      equal(page.items.map(({ content }) => content), [enabledText], "Raw list must deliver only the enabled control turn");
      equal((await search(enabled, "saffron")).segments, [], "Raw search must withhold the forgotten turn");
      equal((await search(enabled, "juniper")).segments.map(({ content }) => content), [enabledText],
        "Raw search must deliver the enabled control turn");
      check(!JSON.stringify(await readDump(harness)).includes(forgottenText), "The forgotten turn must never reach storage");

      if (!disabledScope) return missingCaptureDisable;
      const disabled = { ...control, id: "disabled-turn", content: disabledText };
      const before = await readDump(harness);
      equal(await importMessages(disabledScope, [disabled]), { archived: 0, existing: 0, withheld: 1 },
        "A disabled namespace must withhold the entire import");
      equal(await readDump(harness), before, "A disabled import must leave committed storage unchanged");
      equal(await importMessages({ ...disabledScope, owner: otherOwner }, [control]), { archived: 1, existing: 0, withheld: 0 },
        "The other owner must be able to import into a namespace with the same name");
    },
  };
}
