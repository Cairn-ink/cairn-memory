import { fail } from './validation.mjs';

const keyword = (token, word) => token.kind === 'word' && token.value?.toUpperCase() === word;
const folded = value => value?.replace(/[A-Z]/g, char => char.toLowerCase());
const wordByte = char => /[A-Za-z0-9_$\x80-\xff]/.test(char);
const refuse = () => fail('unsupported_database');
const entry = state => { state.entry = false; state.tableConstraint = false; state.skipName = false; state.previousPrimary = false; state.inlineOrder = false; state.column = null; };

// Only PRIMARY KEY identity is interpreted here. SQLite has already parsed the
// table declaration; direct column metadata and index xinfo validate its types
// and physical seeks separately. Tokens inside comments, strings, quoted names
// and nested expressions never become constraint keywords.
export function createPrimaryCheck(expected) {
  return { expected, depth: 0, started: false, ended: false, count: 0, keys: [],
    mode: 'normal', text: '', oversized: false, carry: '', awaitingList: false, capturing: false };
}
function record(state, keys) {
  if (++state.count !== 1 || keys.length > 4) refuse();
  state.keys = keys.map(folded);
}
function token(state, value) {
  if (value.kind === '(') {
    if (!state.started) { state.started = true; state.depth = 1; entry(state); return; }
    state.depth++;
    if (state.awaitingList && state.depth === 2) {
      state.capturing = true; state.awaitingList = false; state.list = []; state.nextKey = true;
    }
    state.previousPrimary = false;
    return;
  }
  if (value.kind === ')') {
    if (state.capturing && state.depth === 2) {
      record(state, state.list); state.list = null; state.capturing = false;
    }
    if (--state.depth === 0) state.ended = true;
    state.previousPrimary = false;
    return;
  }
  if (!state.started || state.ended) return;
  if (value.kind === ',') {
    if (state.depth === 1) entry(state);
    if (state.capturing && state.depth === 2) state.nextKey = true;
    return;
  }
  if (state.capturing && state.depth === 2 && state.nextKey) {
    if (!['word', 'quoted'].includes(value.kind) || state.list.length === 4) refuse();
    state.list.push(value.value); state.nextKey = false; return;
  }
  if (state.capturing && state.depth === 2) {
    if (state.collation) {
      if (value.value?.toUpperCase() !== 'BINARY') refuse();
      state.collation = false;
    } else if (keyword(value, 'COLLATE')) state.collation = true;
    else if (keyword(value, 'DESC')) refuse();
    return;
  }
  if (state.depth !== 1) return;
  if (state.inlineOrder) { state.inlineOrder = false; if (keyword(value, 'DESC')) refuse(); }
  if (!state.entry) {
    state.entry = true;
    if (keyword(value, 'CONSTRAINT')) { state.tableConstraint = true; state.skipName = true; return; }
    state.tableConstraint = ['PRIMARY', 'UNIQUE', 'CHECK', 'FOREIGN'].some(word => keyword(value, word));
    if (!state.tableConstraint) { state.column = value.value; return; }
  } else if (state.skipName) { state.skipName = false; return; }
  if (state.previousPrimary && keyword(value, 'KEY')) {
    if (state.tableConstraint) state.awaitingList = true;
    else { record(state, [state.column]); state.inlineOrder = true; }
  }
  state.previousPrimary = keyword(value, 'PRIMARY');
}

/** Consume at most one 256-byte schema fragment, with constant retained lexer
 * state. Byte-oriented ASCII SQL syntax avoids UTF-8 character-prefix rescans;
 * all consumed key names are ASCII. Other identifier bytes are opaque. */
export function scanPrimary(state, fragment, eof = false) {
  const input = state.carry + fragment; state.carry = '';
  const append = char => { if (state.text.length < 256) state.text += char; else state.oversized = true; };
  const emit = kind => {
    token(state, { kind, value: state.oversized ? null : state.text });
    state.text = ''; state.oversized = false; state.mode = 'normal';
  };
  let i = 0;
  while (i < input.length) {
    const char = input[i], next = input[i + 1];
    if (state.mode === 'line') { if (char === '\n') state.mode = 'normal'; i++; continue; }
    if (state.mode === 'block') {
      if (char === '*' && next === undefined && !eof) { state.carry = char; break; }
      if (char === '*' && next === '/') { state.mode = 'normal'; i += 2; } else i++;
      continue;
    }
    if (state.mode === 'word') {
      if (wordByte(char)) { append(char); i++; } else emit('word');
      continue;
    }
    if (state.mode === 'quoted') {
      if (char === state.close) {
        if (next === undefined && !eof && state.close !== ']') { state.carry = char; break; }
        if (next === char && state.close !== ']') { append(char); i += 2; }
        else { emit('quoted'); i++; }
      } else { append(char); i++; }
      continue;
    }
    if (/\s/.test(char)) { i++; continue; }
    if ((char === '-' || char === '/') && next === undefined && !eof) { state.carry = char; break; }
    if (char === '-' && next === '-') { state.mode = 'line'; i += 2; continue; }
    if (char === '/' && next === '*') { state.mode = 'block'; i += 2; continue; }
    if (['"', "'", '`', '['].includes(char)) { state.mode = 'quoted'; state.close = char === '[' ? ']' : char; i++; continue; }
    if (wordByte(char)) { state.mode = 'word'; continue; }
    token(state, { kind: char, value: char }); i++;
  }
  if (!eof) return;
  if (state.mode === 'word') emit('word');
  if (!['normal', 'line'].includes(state.mode) || !state.started || !state.ended || state.depth !== 0 ||
      state.count !== 1 || JSON.stringify(state.keys) !== JSON.stringify(state.expected)) refuse();
}
