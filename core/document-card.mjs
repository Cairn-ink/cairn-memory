import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { redactSecrets } from '../plugins/cairn-memory/lib/redact.mjs';
import { fail } from './validation.mjs';

// Match the router's Unicode whitespace, decimal digits, and LF line anchors.
const space = String.raw`[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]`;
const digit = String.raw`\p{Decimal_Number}`;
const start = String.raw`(?<![^\n])`;
const end = String.raw`(?=\n|$)`;
const list = new RegExp(String.raw`${start}${space}*(?:[-*•·▪◦]|${digit}{1,2}[.)、．]|[（(]?${digit}{1,2}[)）]|[一二三四五六七八九十]{1,3}[、.]|第[一二三四五六七八九十${digit}]{1,3}[步天日點項]|step${space}*${digit}+|day${space}*${digit}+|☐|\[ ?[x ]?\])${space}*(?!${space})[\s\S]`, 'giu');
const table = new RegExp(String.raw`${start}${space}*\|?[^|\n]+\|[^|\n]+\|`, 'gu');
const code = new RegExp(String.raw`\x60\x60\x60|${start}${space}{2,}(?!${space})[^\n][^\n]*[;{}()=:]${space}*${end}|${start}${space}*(?:def|class|import|from|function|const|let|var|return|if|for|while|#include|public|SELECT)(?![\p{L}\p{N}_])`, 'gu');
const remember = /remember (?:th[iİı]s|that)|save (?:th[iİı]s|that)|keep (?:th[iİı]s|that)|記住|記下來|記起來|幫我記|存起來|存下來/iu;
const cjk = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/g;

function hasMatches(text, expression, limit) {
  for (const _ of text.matchAll(expression)) if (--limit === 0) return true;
  return false;
}

export function documentRoute(role, text) {
  const weighted = text.length + 2 * (text.match(cjk)?.length ?? 0);
  if (role === 'assistant' && weighted >= 800) return 'long_assistant';
  if (weighted >= 1600) return 'long_any';
  if (text.length < 200) return null;
  const markers = [];
  if (hasMatches(text, list, 2)) markers.push('list');
  if (hasMatches(text, table, 2)) markers.push('table');
  if (text.includes('```') || hasMatches(text, code, 3)) markers.push('code');
  if (markers.length) return 'structured:' + markers.join('+');
  return role === 'user' && remember.test(text) ? 'explicit' : null;
}

const whole = /\b(whole|entire|full|complete|all of|again|resend|everything)\b|完整|整份|全部|整個|再給我|再提供|再傳|重新給|全文|再一次|一次/iu;
const heading = /^\s*(#|day\s*\d|第[一二三四五六七八九十\d]+[天日步]|[^\n]{1,40}[:：]\s*$)/iu;
const spaceRun = new RegExp(space + '+', 'gu');
const nonText = /[^\p{L}\p{N}]+/gu;
export const DOCUMENT_CARD_CHANNEL = 'document-card-v1';
export const DOCUMENT_CARD_PRECEDENCE = 'The replacement memories take precedence wherever they differ from the card.';

const namespaceKey = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
const prefix = (text, units) => {
  const head = text.slice(0, units);
  return /[\ud800-\udbff]$/.test(head) ? head.slice(0, -1) : head;
};

export function routeDocumentCards(namespace, client, sessionId, messages) {
  const matches = [];
  let droppedOversize = 0, droppedRedaction = 0;
  for (const { id: messageId, role, content, occurredAt, totalUnits } of messages) {
    // A Raw fragment cannot supply the full body, even when it matches the rule.
    if (totalUnits !== undefined && totalUnits !== content.length) {
      if (totalUnits > 4000) droppedOversize++;
      continue;
    }
    const routed = redactDocument(content);
    if (routed === null) { droppedRedaction++; continue; }
    const body = routed.replace(/\r\n/g, '\n').split('\n').map(line => line.trimEnd()).join('\n');
    if (body.length > 4000) { droppedOversize++; continue; }
    if (!body.trim() || !documentRoute(role, routed)) continue;
    const revision = 1;
    const source = { client, sessionId, messageId, role };
    const id = documentCardId(namespace, source);
    const title = prefix(body.split('\n').find(line => line.trim()).trim(), 200);
    const priority = role === 'user' && remember.test(routed) ? 0 : role === 'assistant' ? 1 : 2;
    matches.push({ priority, card: { id, revision, title, date: occurredAt ?? null, body,
      namespace: { ...namespace, projectId: namespace.projectId || null }, source, sourceMemoryIds: [], sourceMemoryRevisions: [] } });
  }
  matches.sort((a, b) => a.priority - b.priority);
  return { cards: matches.slice(0, 4).map(({ card }) => card), droppedOversize, ...(droppedRedaction ? { droppedRedaction } : {}) };
}

function bigrams(text) {
  const points = Array.from(text.toLowerCase().replace(spaceRun, ''));
  return new Set(points.slice(1).map((point, index) => points[index] + point));
}

function overlap(query, text) {
  let matched = 0;
  const terms = bigrams(text);
  for (const term of query) if (terms.has(term)) matched++;
  return matched;
}

export function documentLexicalScore(query, card) {
  const terms = bigrams(query.replace(whole, '').replace(nonText, ''));
  if (!terms.size) return 0;
  const matched = overlap(terms, (card.title + '\n' + card.body).replace(nonText, ''));
  return matched >= Math.min(2, terms.size) ? matched / terms.size : 0;
}

function tokenPrefix(text, limit, count) {
  const points = Array.from(text);
  let lo = 0, hi = points.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (count(points.slice(0, mid).join('')) <= limit) lo = mid;
    else hi = mid - 1;
  }
  return points.slice(0, lo).join('');
}

export function documentPiece(body, query, maxTokens, count) {
  const lines = body.split('\n');
  if (whole.test(query)) {
    const limit = Math.floor(maxTokens * .6);
    if (count(body) <= limit) return { body, piece: 'whole' };
    let end = 0;
    while (end < lines.length && count(lines.slice(0, end + 1).join('\n')) <= limit) end++;
    return { body: end ? lines.slice(0, end).join('\n') : tokenPrefix(lines[0], limit, count), piece: 'truncated' };
  }
  const limit = 350;
  if (count(body) <= limit) return { body, piece: 'whole' };
  const grams = bigrams(query);
  let best = 0, score = -1;
  for (const [index, line] of lines.entries()) {
    const matched = overlap(grams, line);
    if (matched > score) { best = index; score = matched; }
  }
  let lo = best, hi = best;
  while (true) {
    // Both candidates start from the same bounds. A fitting right candidate
    // replaces the left candidate selected earlier in the iteration.
    const candidates = [[lo - 1, hi], [lo, hi + 1]];
    let grew = false;
    for (const [start, end] of candidates) {
      if (start < 0 || end >= lines.length || count(lines.slice(start, end + 1).join('\n')) > limit) continue;
      lo = start;
      hi = end;
      grew = true;
    }
    if (!grew) break;
  }
  const window = lines.slice(lo, hi + 1);
  for (let index = lo; index >= 0; index--) if (heading.test(lines[index])) {
    if (index < lo) window.unshift(lines[index], '…');
    break;
  }
  return { body: window.join('\n'), piece: 'window' };
}

/**
 * A synchronous port owns card snapshots, optional embedding metadata/vectors,
 * and irreversible hide tombstones for a namespace. get returns undefined after hide.
 * put may extend the source IDs or cache an embedding on the same card revision.
 */
export function documentCardPort(value) {
  if (value !== undefined && ['put', 'hide', 'markStale', 'list', 'get'].some(key =>
    typeof value?.[key] !== 'function' || types.isAsyncFunction(value[key]))) fail('invalid_input');
  return value;
}

export function createInMemoryDocumentCardPort() {
  const partitions = new Map();
  function partition(namespace) {
    const key = JSON.stringify(namespaceKey(namespace));
    if (!partitions.has(key)) partitions.set(key, new Map());
    return partitions.get(key);
  }
  return Object.freeze({
    put(namespace, card) {
      const cards = partition(namespace), prior = cards.get(card.id);
      if (prior === null) return false;
      if (!prior) cards.set(card.id, structuredClone(card));
      else cards.set(card.id, { ...prior, sourceMemoryIds: [...new Set([...prior.sourceMemoryIds, ...card.sourceMemoryIds])],
        sourceMemoryRevisions: structuredClone([...new Map([...(card.sourceMemoryRevisions ?? []), ...(prior.sourceMemoryRevisions ?? [])]
          .map(value => [value.memoryId, value])).values()]),
        ...(card.embedding && card.body === prior.body ? { embedding: structuredClone(card.embedding) } : {}) });
      return true;
    },
    hide(namespace, cardId, _reason) {
      const cards = partition(namespace), hadCard = Boolean(cards.get(cardId));
      cards.set(cardId, null);
      return hadCard;
    },
    markStale(namespace, cardId, change) {
      const cards = partition(namespace), card = cards.get(cardId);
      if (!card) return false;
      const prior = card.stale?.find(entry => entry.memoryId === change.memoryId);
      if (prior?.replacement.memoryId === change.replacement.memoryId &&
          prior.replacement.revision > change.replacement.revision) return false;
      cards.set(cardId, { ...card, stale: [...(card.stale ?? []).filter(entry => entry.memoryId !== change.memoryId),
        structuredClone(change)] });
      return true;
    },
    list(namespace) {
      return Array.from(partition(namespace).values()).filter(Boolean).map(card => structuredClone(card));
    },
    get(namespace, cardId) {
      return structuredClone(partition(namespace).get(cardId) ?? undefined);
    },
  });
}

export function hideDocumentCards(port, namespace, reason, matches) {
  visitDocumentCards(port, namespace, card => {
    if (matches(card)) tryDocumentWrite(() => port.hide(namespace, card.id, reason));
  });
}

export function documentCardDependsOn(card, memoryId) {
  return card.sourceMemoryIds.includes(memoryId) || Boolean(card.stale?.some(entry => entry.replacement.memoryId === memoryId));
}

export function documentCardId(namespace, { client, sessionId, messageId }) {
  return createHash('sha256').update(JSON.stringify([DOCUMENT_CARD_CHANNEL,
    namespaceKey(namespace), client, sessionId, messageId, 1])).digest('hex');
}

export function documentCardBoundTo(namespace, card) {
  return card?.namespace && card.source && card.revision === 1 &&
    card.namespace.ownerId === namespace.ownerId && card.namespace.scope === namespace.scope &&
    card.namespace.projectId === namespace.projectId &&
    card.id === documentCardId(namespace, card.source);
}

export function tryDocumentWrite(work) {
  try { return work(); }
  catch {
    try { process.emitWarning('Document card publication failed.', { code: 'document_card_write_failed' }); }
    catch { /* A diagnostic cannot change a committed result. */ }
  }
}

export function visitDocumentCards(port, namespace, visit) {
  const cards = tryDocumentWrite(() => port.list(namespace));
  for (const card of cards ?? []) if (documentCardBoundTo(namespace, card)) visit(card);
}

function redactDocument(content) {
  const body = redactSecrets(content.normalize('NFKC'));
  const locations = [];
  let text = '';
  for (const match of body.matchAll(/\s+|\S+/gu)) {
    const [run] = match, start = match.index;
    if (/^\s/u.test(run)) {
      if (text) {
        text += ' ';
        locations.push([start, start + run.length]);
      }
    } else {
      text += run;
      for (let index = 0; index < run.length; index++) locations.push([start + index, start + index + 1]);
    }
  }
  const spans = [];
  const cut = (view, limit) => {
    const text = prefix(view.text, limit).trimEnd();
    return { text, locations: view.locations.slice(0, text.length) };
  };
  const redact = view => {
    if (view.text.normalize('NFKC') !== view.text) return null;
    const text = redactSecrets(view.text);
    if (text === view.text) return view;
    const edits = redactionEdits(view.text, text);
    if (!edits) return null;
    const locations = [];
    let offset = 0;
    for (const { start, end, length } of edits) {
      locations.push(...view.locations.slice(offset, start));
      const span = [view.locations[start][0], view.locations[end - 1][1]];
      spans.push(span);
      locations.push(...Array(length).fill(span));
      offset = end;
    }
    return { text, locations: locations.concat(view.locations.slice(offset)) };
  };

  // Capture flattens before the Raw snapshot and can normalize the bounded
  // receipt prefix again. Keep coordinates through those same projections.
  const flat = cut({ text, locations }, text.length);
  const full = redact(flat);
  const raw = flat.text.length <= 4000 ? full : redact(cut(flat, 4000));
  if (!full || !raw) return null;
  for (const view of [flat, raw]) {
    const normalized = redact(view);
    if (!normalized || !redact(cut(normalized, 800))) return null;
  }
  let result = '', offset = 0;
  for (const [start, end] of spans.sort((a, b) => a[0] - b[0])) {
    if (start >= offset) result += body.slice(offset, start) + '[REDACTED]';
    offset = Math.max(offset, end);
  }
  return result + body.slice(offset);
}

// The redactor only removes spans and emits a fixed marker. Align each
// unchanged run from both ends. If the alignments disagree, some text could
// have belonged to a removed span, so the caller drops the entire document.
function redactionEdits(before, after) {
  const markers = [...after.matchAll(/(?:\[REDACTED\])+/gu)];
  if (!markers.length) return null;
  const runs = [];
  let offset = 0;
  for (const marker of markers) {
    runs.push(after.slice(offset, marker.index));
    offset = marker.index + marker[0].length;
  }
  runs.push(after.slice(offset));

  const last = runs.length - 1;
  if (!before.startsWith(runs[0]) || !before.endsWith(runs[last])) return null;
  const positions = [0];
  let end = runs[0].length;
  for (let index = 1; index < last; index++) {
    const start = before.indexOf(runs[index], end + 1);
    if (start < 0) return null;
    positions.push(start);
    end = start + runs[index].length;
  }
  const tail = before.length - runs[last].length;
  if (tail <= end) return null;
  positions.push(tail);

  let start = tail;
  for (let index = last - 1; index > 0; index--) {
    const limit = start - runs[index].length - 1;
    if (limit < 0 || before.lastIndexOf(runs[index], limit) !== positions[index]) return null;
    start = positions[index];
  }
  return markers.map(([marker], index) => ({
    start: positions[index] + runs[index].length,
    end: positions[index + 1],
    length: marker.length,
  }));
}
