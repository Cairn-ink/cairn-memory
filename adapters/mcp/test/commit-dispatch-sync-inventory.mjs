import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { parse } from '../../../tools/testing/vendor/acorn/acorn.mjs';

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
  const regions = [];
  const name = node => node?.name ?? node?.value ?? node?.property?.name;
  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      const label = node.id?.name ?? (parent?.type === 'VariableDeclarator' ? name(parent.id)
        : ['Property', 'MethodDefinition'].includes(parent?.type) ? name(parent.key)
        : parent?.type === 'AssignmentExpression' ? name(parent.left)
        : parent?.type === 'CallExpression' ? `<${name(parent.callee) ?? 'call'} callback>` : '<anonymous>');
      regions.push({ name: label, start: node.start, end: node.end });
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => visit(child, node));
      else if (value && typeof value === 'object') visit(value, node);
    }
  };
  visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
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
