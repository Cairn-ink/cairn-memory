// Source audit only: decode JS literal escapes once, then lex SQLite tokens
// starting at INSERT/REPLACE candidates. Quoted identifiers are normalized at
// the token boundary; schema qualification never changes the terminal name.
export const protectedSplitTables = Object.freeze([
  'content_suppressions', 'content_identity_reservations',
  'owner_suppression_epochs', 'content_safety_control',
]);
const protectedNames = new Set(protectedSplitTables);
const escapes = { n:'\n',r:'\r',t:'\t',b:'\b',f:'\f',v:'\v',0:'\0' };
function literalText(source) {
  return source.replace(/\\(?:\r?\n|u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|([\\'"`nrtbfv0]))/gi,
    (match, wide, unicode, hex, simple) => wide || unicode || hex
      ? String.fromCodePoint(parseInt(wide ?? unicode ?? hex, 16))
      : simple === undefined ? '' : escapes[simple] ?? simple);
}
function* tokens(sql, offset) {
  while (offset < sql.length) {
    if (/\s/.test(sql[offset])) { offset++; continue; }
    if (sql.startsWith('--', offset)) { const end = sql.indexOf('\n', offset + 2); offset = end < 0 ? sql.length : end + 1; continue; }
    if (sql.startsWith('/*', offset)) { const end = sql.indexOf('*/', offset + 2); offset = end < 0 ? sql.length : end + 2; continue; }
    const opening = sql[offset++];
    if ('"`[\''.includes(opening)) {
      const closing = opening === '[' ? ']' : opening; let value = '', complete = false;
      while (offset < sql.length) {
        const character = sql[offset++];
        if (character !== closing) { value += character; continue; }
        if (opening !== '[' && sql[offset] === closing) { value += closing; offset++; continue; }
        complete = true; break;
      }
      if (!complete) return;
      yield { kind:'identifier', value:value.toLowerCase() }; continue;
    }
    if (/[\w$\u0080-\uffff]/.test(opening)) {
      let value = opening;
      while (offset < sql.length && /[\w$\u0080-\uffff]/.test(sql[offset])) value += sql[offset++];
      yield { kind:'word', value:value.toLowerCase() }; continue;
    }
    yield { kind:'punctuation', value:opening };
  }
}
export function protectedInsertionTargets(source) {
  const sql = literalText(source), targets = new Set();
  for (const candidate of sql.matchAll(/\b(?:insert|replace)\b/gi)) {
    const iterator = tokens(sql, candidate.index), next = () => iterator.next().value;
    const keyword = next(); let token = next();
    if (keyword.value === 'insert' && token?.kind === 'word' && token.value === 'or') {
      const conflict = next();
      if (conflict?.kind !== 'word' || !['rollback','abort','replace','fail','ignore'].includes(conflict.value)) continue;
      token = next();
    }
    if (token?.kind !== 'word' || token.value !== 'into') continue;
    token = next();
    if (!token || token.kind === 'punctuation') continue;
    let table = token.value;
    if (next()?.value === '.') {
      token = next();
      if (!token || token.kind === 'punctuation') continue;
      table = token.value;
    }
    if (protectedNames.has(table)) targets.add(table);
  }
  return [...targets];
}
