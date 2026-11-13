import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const root = new URL('../../../', import.meta.url).pathname;
// Conservative source census, seeded from R2f's transaction/BEGIN inventory.
// Mask literals/comments without changing offsets; count every transaction,
// exec, run and reconciliation call, including infrastructure false positives.
// No module-wide exception allows a new call to join an existing function.
export function masked(source) {
  return source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`/g,
    value => value.replace(/[^\n]/g, ' '));
}
export function functionRegions(source) {
  const code = masked(source), regions = [];
  // Separate balanced scanner keeps ordinary identifiers and line edits out of
  // the pin. Only named enclosing functions, never line numbers, identify sites.
  const close = (start, left, right) => {
    let depth = 1;
    for (let i = start + 1; i < code.length; i++) {
      if (code[i] === left) depth++;
      else if (code[i] === right && --depth === 0) return i;
    }
    return code.length;
  };
  for (const match of code.matchAll(/\bfunction\s*\*?\s+([\w$]+)\s*\(/g)) {
    const args = code.indexOf('(', match.index), brace = code.indexOf('{', close(args, '(', ')') + 1);
    if (brace >= 0) regions.push({ name: match[1], start: match.index, end: close(brace, '{', '}') });
  }
  return regions;
}
export function sharedSources() {
  const sources = new Map();
  const visit = file => {
    if (sources.has(file)) return;
    const source = readFileSync(resolve(root, file), 'utf8'); sources.set(file, source);
    for (const edge of source.matchAll(/(?:\b(?:import|export)\s+(?:[^;]*?\s+from\s*)?|\bimport\s*\()(['"])(\.[^'"\n]+\.mjs)\1/g)) {
      const target = relative(root, resolve(root, dirname(file), edge[2]));
      if (target.startsWith('../')) throw Error('R2G_UNPINNED_SYNC_WRITE escaping import');
      visit(target);
    }
  };
  visit('adapters/mcp/local-shared-runtime.mjs'); return sources;
}
export function syncInventory(sources = sharedSources()) {
  const counts = new Map();
  for (const [file, source] of sources) {
    const code = masked(source), regions = functionRegions(source);
    for (const match of code.matchAll(/\b(transaction|readTransaction|reconcile|reconcileAsync)\s*\(|\.\s*(exec|run)\s*\(/g)) {
      if (/\bfunction\s*$/.test(code.slice(Math.max(0, match.index - 20), match.index))) continue;
      const enclosing = regions.filter(fn => fn.start <= match.index && fn.end >= match.index)
        .sort((a,b) => b.start-a.start)[0]?.name ?? '<module>';
      const key = [file, enclosing, match[1] ?? match[2]].join(':');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return Object.fromEntries([...counts].sort(([a],[b]) => a.localeCompare(b, 'en')));
}

// Close inbound references as well: a new adapter caller of an already-known
// transaction must be reviewed even if it adds no new BEGIN in storage.
export function syncEntryCalls(sources = sharedSources()) {
  const calls = [];
  for (const [file, source] of sources) {
    const code = masked(source), regions = functionRegions(source);
    for (const match of code.matchAll(/\b([\w$]+)\s*\(/g)) {
      if (/\bfunction\s*\*?\s*$/.test(code.slice(Math.max(0, match.index - 20), match.index))) continue;
      const enclosing = regions.filter(fn => fn.start <= match.index && fn.end >= match.index)
        .sort((a,b) => b.start-a.start)[0]?.name ?? '<module>';
      calls.push({ file, enclosing, callee: match[1] });
    }
  }
  const names = new Set(Object.keys(syncInventory(sources)).map(key => key.split(':')[1]).filter(name => name !== '<module>'));
  for (;;) {
    const before = names.size;
    for (const call of calls) if (names.has(call.callee) && call.enclosing !== '<module>') names.add(call.enclosing);
    if (names.size === before) break;
  }
  const counts = new Map();
  for (const call of calls) if (names.has(call.callee)) {
    const key = [call.file, call.enclosing, call.callee].join(':'); counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Object.fromEntries([...counts].sort(([a],[b]) => a.localeCompare(b, 'en')));
}
