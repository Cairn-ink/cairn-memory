// Conservative detector for hook declarations in a TOML file, without a TOML
// dependency. It classifies every top-level statement: a table header or key
// whose full key path starts with `hooks` (bare, quoted or escaped, any case)
// is a hook source, and anything it cannot classify is reported so the caller
// fails closed. Values are parsed (strings, arrays, inline tables, scalars), so a
// malformed value cannot hide a later statement.

const BARE = /[A-Za-z0-9_-]/;
const ESCAPES = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\' };

export function tomlHookDeclarations(input) {
  const text = input.replace(/^﻿/, '');
  const hooks = [];
  const unclassified = [];
  let i = 0;
  let line = 1;
  let table = [];

  const at = offset => text[i + offset];
  const skipBlank = () => { while (at(0) === ' ' || at(0) === '\t') i++; };
  const endOfLine = () => at(0) === undefined || at(0) === '\n' || (at(0) === '\r' && at(1) === '\n');
  const skipToNextLine = () => {
    while (i < text.length && at(0) !== '\n') i++;
    if (at(0) === '\n') { i++; line++; }
  };
  const fail = () => { unclassified.push(line); skipToNextLine(); };

  function keySegment() {
    if (at(0) === '"') {
      let value = '';
      for (i++; i < text.length && at(0) !== '\n'; i++) {
        if (at(0) === '"') { i++; return value; }
        if (at(0) !== '\\') { value += at(0); continue; }
        const escape = at(1);
        if (escape === 'u' || escape === 'U') {
          const digits = text.slice(i + 2, i + (escape === 'u' ? 6 : 10));
          if (!/^[0-9A-Fa-f]+$/.test(digits) || digits.length !== (escape === 'u' ? 4 : 8)) return null;
          value += String.fromCodePoint(parseInt(digits, 16));
          i += 1 + digits.length;
        } else if (Object.hasOwn(ESCAPES, escape)) { value += ESCAPES[escape]; i++; }
        else return null;
      }
      return null;
    }
    if (at(0) === "'") {
      const close = text.indexOf("'", i + 1);
      const newline = text.indexOf('\n', i + 1);
      if (close < 0 || (newline >= 0 && newline < close)) return null;
      const value = text.slice(i + 1, close);
      i = close + 1;
      return value;
    }
    const start = i;
    while (at(0) !== undefined && BARE.test(at(0))) i++;
    return i > start ? text.slice(start, i) : null;
  }

  function keyPath() {
    const segments = [];
    for (;;) {
      skipBlank();
      const segment = keySegment();
      if (segment === null) return null;
      segments.push(segment);
      skipBlank();
      if (at(0) !== '.') return segments;
      i++;
    }
  }

  const skipLayout = () => {
    for (;;) {
      skipBlank();
      if (at(0) === '#') { while (i < text.length && at(0) !== '\n') i++; continue; }
      if (at(0) === '\r' && at(1) === '\n') i++;
      if (at(0) === '\n') { i++; line++; continue; }
      return;
    }
  };

  function string() {
    if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
      const quote = text.slice(i, i + 3);
      for (let j = i + 3; ;) {
        const close = text.indexOf(quote, j);
        if (close < 0) return false;
        let backslashes = 0;
        for (let k = close - 1; quote === '"""' && text[k] === '\\'; k--) backslashes++;
        if (backslashes % 2 === 0) {
          // A closing delimiter may be followed by up to two more quote characters.
          let end = close + 3;
          while (text[end] === quote[0] && end < close + 5) end++;
          line += (text.slice(i, end).match(/\n/g) ?? []).length;
          i = end;
          return true;
        }
        j = close + 1;
      }
    }
    const quote = at(0);
    let j = i + 1;
    for (; j < text.length && text[j] !== quote && text[j] !== '\n'; j++) if (quote === '"' && text[j] === '\\') j++;
    if (text[j] !== quote) return false;
    i = j + 1;
    return true;
  }

  const SCALAR = new RegExp('^(?:true|false|[+-]?(?:inf|nan)|[+-]?0x[0-9A-Fa-f](?:_?[0-9A-Fa-f])*|0o[0-7](?:_?[0-7])*|' +
    '0b[01](?:_?[01])*|[+-]?(?:0|[1-9](?:_?[0-9])*)(?:\\.[0-9](?:_?[0-9])*)?(?:[eE][+-]?[0-9](?:_?[0-9])*)?|' +
    '\\d{4}-\\d{2}-\\d{2}(?:[Tt ]\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?(?:[Zz]|[+-]\\d{2}:\\d{2})?)?|' +
    '\\d{2}:\\d{2}(?::\\d{2}(?:\\.\\d+)?)?)$');

  function scalar() {
    const start = i;
    while (at(0) !== undefined && /[0-9A-Za-z_:.+-]/.test(at(0))) i++;
    // A date and time may be separated by one space.
    if (at(0) === ' ' && /^\d{4}-\d{2}-\d{2}$/.test(text.slice(start, i)) && /\d/.test(at(1) ?? '')) {
      i++;
      while (at(0) !== undefined && /[0-9:.+Zz-]/.test(at(0))) i++;
    }
    return i > start && SCALAR.test(text.slice(start, i));
  }

  /** Parse one TOML value; false if it is not valid, so the statement stays unclassified. */
  function value(depth = 0) {
    if (depth > 64) return false;
    const c = at(0);
    if (c === '"' || c === "'") return string();
    if (c === '[') {
      i++;
      for (;;) {
        skipLayout();
        if (at(0) === ']') { i++; return true; }
        if (!value(depth + 1)) return false;
        skipLayout();
        if (at(0) === ',') { i++; continue; }
        if (at(0) === ']') { i++; return true; }
        return false;
      }
    }
    if (c === '{') {
      i++;
      skipLayout();
      if (at(0) === '}') { i++; return true; }
      for (;;) {
        skipLayout();
        // Keys inside an inline table extend the parent key; they never start a new top-level path.
        if (keyPath() === null || at(0) !== '=') return false;
        i++;
        skipBlank();
        if (!value(depth + 1)) return false;
        skipLayout();
        if (at(0) === ',') { i++; continue; }
        if (at(0) === '}') { i++; return true; }
        return false;
      }
    }
    return scalar();
  }

  const isHooks = path => typeof path?.[0] === 'string' && path[0].toLowerCase() === 'hooks';

  while (i < text.length) {
    skipBlank();
    if (at(0) === '\r' && at(1) === '\n') i++;
    if (at(0) === '\n') { i++; line++; continue; }
    if (at(0) === undefined) break;
    if (at(0) === '#') { skipToNextLine(); continue; }
    const statementLine = line;
    if (at(0) === '[') {
      const arrayTable = at(1) === '[';
      i += arrayTable ? 2 : 1;
      const path = keyPath();
      if (path === null || at(0) !== ']' || (arrayTable && at(1) !== ']')) { fail(); continue; }
      i += arrayTable ? 2 : 1;
      table = path;
      if (isHooks(path)) hooks.push(statementLine);
    } else {
      const path = keyPath();
      if (path === null || at(0) !== '=') { fail(); continue; }
      i++;
      skipBlank();
      if (isHooks([...table, ...path])) hooks.push(statementLine);
      if (endOfLine() || !value()) { unclassified.push(statementLine); skipToNextLine(); continue; }
    }
    skipBlank();
    if (at(0) === '#') while (i < text.length && at(0) !== '\n') i++;
    if (!endOfLine()) { fail(); continue; }
    if (at(0) === '\r') i++;
    if (at(0) === '\n') { i++; line++; }
  }
  return { hooks, unclassified };
}
