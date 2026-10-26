import { redactSecrets } from '../plugins/cairn-memory/lib/redact.mjs';
import { boundedText } from './validation.mjs';
import { sourceWindowCatalog } from './source-windows.mjs';

/** Core-owned positions, computed while exact first-part text is available. */
export function rawSourceMap(message) {
  const raw = message.content;
  // Raw preparation truncates first; captureSnapshot normalizes that bounded
  // projection again. In particular a cut can expose trailing whitespace.
  const canonical = boundedText(boundedText(raw, 4000, true), 4000);
  const points = [];
  let text = '', offset = 0, whitespace;
  for (const point of raw) {
    const start = offset; offset += point.length;
    if (/\s/u.test(point)) { whitespace ??= start; continue; }
    if (whitespace !== undefined && text) {
      points.push({ start: text.length, end: text.length + 1, rawStart: whitespace, rawEnd: start });
      text += ' ';
    }
    whitespace = undefined;
    points.push({ start: text.length, end: text.length + point.length, rawStart: start, rawEnd: offset });
    text += point;
  }
  const exact = raw.normalize('NFKC') === raw && redactSecrets(raw) === raw && text.startsWith(canonical);
  const span = (start, end) => {
    if (!exact) return { start: 0, end: message.part.totalUnits, precision: 'whole-message' };
    const selected = points.filter(point => point.start < end && point.end > start);
    return { start: selected[0].rawStart, end: selected.at(-1).rawEnd, precision: 'exact' };
  };
  const prefix = boundedText(boundedText(canonical, 800, true), 800, true);
  const entries = [{ excerpt: canonical, ...span(0, canonical.length) },
    { excerpt: prefix, ...span(0, prefix.length) }];
  const catalog = sourceWindowCatalog({ messages: [{ id: message.id, role: message.role, content: canonical }] });
  for (const window of catalog.entries) entries.push({ excerpt: window.content, ...span(window.start, window.end) });
  return { messageId: message.id, role: message.role, totalUnits: message.part.totalUnits, entries };
}
