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
  let droppedOversize = 0;
  for (const { id: messageId, role, content, occurredAt, totalUnits } of messages) {
    // A Raw fragment cannot supply the full body, even when it matches the rule.
    if (totalUnits !== undefined && totalUnits !== content.length) {
      if (totalUnits > 4000) droppedOversize++;
      continue;
    }
    const body = redactSecrets(content.normalize('NFKC')).replace(/\r\n/g, '\n').split('\n')
      .map(line => line.trimEnd()).join('\n');
    if (body.length > 4000) { droppedOversize++; continue; }
    if (!body.trim() || !documentRoute(role, body)) continue;
    const revision = 1;
    const id = createHash('sha256').update(JSON.stringify([DOCUMENT_CARD_CHANNEL,
      namespaceKey(namespace), client, sessionId, messageId, revision])).digest('hex');
    const title = prefix(body.split('\n').find(line => line.trim()).trim(), 200);
    const priority = role === 'user' && remember.test(body) ? 0 : role === 'assistant' ? 1 : 2;
    matches.push({ priority, card: { id, revision, title, date: occurredAt ?? null, body,
      source: { client, sessionId, messageId, role }, sourceMemoryIds: [] } });
  }
  matches.sort((a, b) => a.priority - b.priority);
  return { cards: matches.slice(0, 4).map(({ card }) => card), droppedOversize };
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
  const render = (start, end) => {
    const window = lines.slice(start, end + 1);
    for (let i = start; i >= 0; i--) if (heading.test(lines[i])) {
      if (i < start) window.unshift(lines[i], '…');
      break;
    }
    return window.join('\n');
  };
  const first = render(lo, hi);
  if (count(first) > limit) {
    const prefix = first.slice(0, first.length - lines[best].length);
    const window = tokenPrefix(lines[best], Math.max(0, limit - count(prefix)), count);
    const joined = prefix + window;
    return { body: count(joined) <= limit && window ? joined : tokenPrefix(lines[best], limit, count), piece: 'window' };
  }
  while (true) {
    const left = lo > 0 && count(render(lo - 1, hi)) <= limit;
    if (left) lo--;
    const right = hi + 1 < lines.length && count(render(lo, hi + 1)) <= limit;
    if (right) hi++;
    if (!left && !right) break;
  }
  return { body: render(lo, hi), piece: 'window' };
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
  for (const card of port.list(namespace)) if (matches(card)) port.hide(namespace, card.id, reason);
}

export function documentCardDependsOn(card, memoryId) {
  return card.sourceMemoryIds.includes(memoryId) || Boolean(card.stale?.some(entry => entry.replacement.memoryId === memoryId));
}
