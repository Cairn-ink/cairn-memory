import { CoreError } from '../errors.mjs';

/** @import { PlacementItem } from './proposal.mjs' */
/** @import { CoalescedTopics } from './plan.mjs' */

/** @param {string} title */
export const titleKey = (title) => title.normalize('NFKC').toLocaleLowerCase('und');

/** @param {readonly PlacementItem[]} items @returns {CoalescedTopics} */
export function coalesceNewTopics(items) {
  /** @type {CoalescedTopics} */
  const { newL1, newL2 } = { newL1: new Map(), newL2: new Map() };
  for (const { memoryId, newL1: proposed } of items) {
    if (!proposed) continue;
    const l1Key = titleKey(proposed.title);
    let l1 = newL1.get(l1Key);
    if (!l1) {
      l1 = { title: proposed.title, sourceIds: new Set(), parentL2Ids: new Set(), newParentKeys: new Set() };
      newL1.set(l1Key, l1);
    }
    l1.sourceIds.add(memoryId);
    for (const id of proposed.parentL2Ids) l1.parentL2Ids.add(id);
    if (proposed.newL2Title) {
      const l2Key = titleKey(proposed.newL2Title);
      let l2 = newL2.get(l2Key);
      if (!l2) {
        l2 = { title: proposed.newL2Title, sourceIds: new Set() };
        newL2.set(l2Key, l2);
      }
      l2.sourceIds.add(memoryId);
      l1.newParentKeys.add(l2Key);
    }
  }
  for (const l1 of newL1.values()) {
    if (l1.parentL2Ids.size > 3) throw new CoreError('invalid_input');
  }
  return { newL1, newL2 };
}

/** @param {number} currentRevision @param {boolean} wasFiled @param {boolean} willBeFiled */
export function filingRevision(currentRevision, wasFiled, willBeFiled) {
  return currentRevision + Number(wasFiled !== willBeFiled);
}
