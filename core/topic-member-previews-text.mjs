import { fail } from './validation.mjs';

export const PREVIEW_VERSION = 'topic-member-previews-v1';
export const CANARY_VERSION = 'topic-member-previews-grapheme-canaries-v1';
export const GRAPHEME_CANARIES = Object.freeze([
  ['Ae\u0301B', ['A', 'e\u0301', 'B']],
  ['A\uD83D\uDE00B', ['A', '\uD83D\uDE00', 'B']],
  ['\uD83D\uDC4D\uD83C\uDFFD', ['\uD83D\uDC4D\uD83C\uDFFD']],
  ['\u2708\uFE0F', ['\u2708\uFE0F']],
  ['\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66', ['\uD83D\uDC68\u200D\uD83D\uDC69\u200D\uD83D\uDC67\u200D\uD83D\uDC66']],
  ['\uD83C\uDDEF\uD83C\uDDF5', ['\uD83C\uDDEF\uD83C\uDDF5']],
  ['A\r\nB', ['A', '\r\n', 'B']],
  ['\u304B\u3099\u306A', ['\u304B\u3099', '\u306A']],
  ['\u4E2D\u65E5A\uD840\uDC00\uD83D\uDE00', ['\u4E2D', '\u65E5', 'A', '\uD840\uDC00', '\uD83D\uDE00']],
  ['A \u0600 B', ['A', ' ', '\u0600 ', 'B']],
  ['\u0600 B', ['\u0600 ', 'B']],
].map(([input, expected]) => Object.freeze([input, Object.freeze(expected)])));

// Constructed lazily by the opted-in Worker reader, never the default path.
export function previewCapability(Segmenter = Intl.Segmenter) {
  let segmenter;
  try {
    segmenter = new Segmenter('und', { granularity: 'grapheme' });
    if (segmenter.resolvedOptions().granularity !== 'grapheme') throw Error();
    for (const [input, expected] of GRAPHEME_CANARIES) {
      const actual = Array.from(segmenter.segment(input), part => part.segment);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw Error();
    }
  } catch { segmenter = null; }
  return { segmenter, configuration: { algorithm: PREVIEW_VERSION, canaries: CANARY_VERSION,
    sourceBytes: 12000, sourceUnits: 4000, previewBytes: 1024,
    node: process.versions.node, v8: process.versions.v8, icu: process.versions.icu ?? null,
    unicode: process.versions.unicode ?? null, capable: segmenter !== null } };
}
export function previewCounters() {
  return { extractions: 0, sourceBytes: 0, decodeAttemptBytes: 0, decodedUnits: 0,
    normalizationUnits: 0, segmentationUnits: 0, temporaryPayloadPeak: 0, failures: {} };
}
const unavailable = (reason, counters) => {
  counters.failures[reason] = (counters.failures[reason] ?? 0) + 1;
  return { status: 'unavailable', reason };
};
/** Only numeric observations escape this function. ignoreBOM preserves BOM for
 * the specified ECMAScript whitespace step; fatal forbids replacement decoding. */
export function transformPreview(row, maxChars, capability, counters) {
  if (!capability.segmenter) return unavailable('segmenter_unavailable', counters);
  if (!row) fail('cursor_stale');
  const { source_type: type, source_bytes: bytes, source } = row;
  if (source !== null && (type !== 'text' || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > 12000 ||
      !(source instanceof Uint8Array) || source.byteLength !== bytes)) fail('unsupported_database');
  if (type !== 'text') return unavailable('invalid_text', counters);
  if (!Number.isSafeInteger(bytes) || bytes < 0) fail('unsupported_database');
  if (bytes > 12000) return unavailable('content_limit', counters);
  if (source === null) fail('unsupported_database');
  counters.sourceBytes += bytes; counters.decodeAttemptBytes += bytes;
  counters.temporaryPayloadPeak = Math.max(counters.temporaryPayloadPeak, bytes);
  let content;
  try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(source); }
  catch { return unavailable('invalid_text', counters); }
  counters.decodedUnits += content.length;
  counters.temporaryPayloadPeak = Math.max(counters.temporaryPayloadPeak, bytes + 2 * content.length);
  if (!content.isWellFormed() || content.includes('\0')) return unavailable('invalid_text', counters);
  if (content.length > 4000) return unavailable('content_limit', counters);
  counters.normalizationUnits += content.length;
  const normalized = content.replace(/\s+/gu, ' ').trim();
  if (!normalized) return unavailable('empty', counters);
  const clusters = []; let size = 0, text = '';
  for (const { segment } of capability.segmenter.segment(normalized)) {
    counters.segmentationUnits += segment.length;
    const next = Buffer.byteLength(segment);
    if (clusters.length === maxChars || size + next > 1024) {
      if (!clusters.length) return unavailable('grapheme_too_large', counters);
      break;
    }
    clusters.push(segment); size += next; text += segment;
  }
  while (clusters.length && text.trimEnd() !== text) {
    clusters.pop(); text = clusters.join('');
  }
  if (!text) return unavailable('trimmed_prefix_empty', counters);
  return { status: 'available', text, truncated: text !== normalized };
}
