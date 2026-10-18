import { fail } from './validation.mjs';

export const SOURCE_RANKING_VERSION = 'bounded-idf-v1';
const WORDS = /[\p{L}\p{N}]+/gu;

// Query-local, bounded slabs contain only passage match bits. Source strings
// are consumed during the scan and never retained here.
export function createSourceRanking(query) {
  if (typeof query !== 'string' || query.length > 4000) fail('invalid_input');
  const tokens = [...new Set(Array.from(query.matchAll(WORDS), match => match[0].toLowerCase()))].sort();
  const tokenIndex = new Map(tokens.map((token, index) => [token, index]));
  const words = Math.ceil(tokens.length / 32);
  const df = new Uint32Array(tokens.length);
  const union = new Uint32Array(words);
  const records = [];
  let maskBytes = 0;

  function slab(capacity) {
    const masks = new Uint32Array(capacity * 5 * words);
    maskBytes += masks.byteLength;
    return masks;
  }

  function add(masks, slot, memory, receipts) {
    const offset = slot * 5 * words;
    union.fill(0);
    const passages = [memory.content, ...receipts.map(receipt => receipt.excerpt)];
    for (let passage = 0; passage < passages.length; passage += 1) {
      const content = passages[passage];
      if (typeof content !== 'string' || content.length > 4000) fail('invalid_input');
      for (const match of content.matchAll(WORDS)) {
        const index = tokenIndex.get(match[0].toLowerCase());
        if (index === undefined) continue;
        const word = index >>> 5;
        const bit = 1 << (index & 31);
        masks[offset + passage * words + word] |= bit;
        union[word] |= bit;
      }
    }
    for (let word = 0; word < words; word += 1) {
      let bits = union[word];
      while (bits) {
        const bit = 31 - Math.clz32(bits & -bits);
        df[word * 32 + bit] += 1;
        bits &= bits - 1;
      }
    }
    records.push({ id: memory.id, revision: memory.revision, masks, offset,
      receiptIds: receipts.map(receipt => receipt.id) });
  }

  function top(limit) {
    const weights = Float64Array.from(df, count => Math.log1p((records.length - count + 0.5) / (count + 0.5)));
    const candidates = records.map(record => {
      let score = 0;
      let winner = 0;
      for (let passage = 0; passage <= record.receiptIds.length; passage += 1) {
        let passageScore = 0;
        for (let word = 0; word < words; word += 1) {
          let bits = record.masks[record.offset + passage * words + word];
          while (bits) {
            const bit = 31 - Math.clz32(bits & -bits);
            passageScore += weights[word * 32 + bit];
            bits &= bits - 1;
          }
        }
        if (passageScore > score) { score = passageScore; winner = passage; }
      }
      return { id: record.id, revision: record.revision, score,
        receiptId: winner === 0 ? undefined : record.receiptIds[winner - 1] };
    });
    candidates.sort((left, right) => right.score - left.score ||
      (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    return candidates.slice(0, limit);
  }

  return { slab, add, top, stats: () => ({ eligibleMemories: records.length,
    maskBytes, queryTokenCount: tokens.length }) };
}
