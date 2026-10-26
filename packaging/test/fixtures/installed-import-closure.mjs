import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

// Test-only literal graph, not a runtime loader. Every reachable import/URL
// stays required; only a literal node:worker_threads Worker edge is lazy.
export function installedImportClosure(root, entries) {
  root = realpathSync(root);
  const graph = new Map(), workerEntries = new Set();
  function contained(absolute) {
    const path = relative(root, absolute);
    assert.ok(!isAbsolute(path) && path !== '..' && !path.startsWith('../'), 'closure escapes root');
    return path;
  }
  function target(from, specifier) {
    const absolute = resolve(root, dirname(from), specifier), path = contained(absolute);
    const stat = lstatSync(absolute); // Missing eager AND lazy dependencies fail.
    contained(realpathSync(absolute));
    if (stat.isDirectory()) return null; // Identity-only directory URLs are not assets.
    assert.ok(stat.isFile(), 'closure requires regular files');
    return path;
  }
  const start = entries.map(entry => {
    const path = target('', './' + entry); assert.notEqual(path, null); return path;
  });
  const queue = [...start];
  while (queue.length) {
    const path = queue.pop(); if (graph.has(path)) continue;
    const edges = []; graph.set(path, edges);
    if (!path.endsWith('.mjs')) continue;
    const text = readFileSync(resolve(root, path), 'utf8'), workerOffsets = new Set();
    for (const declaration of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*['"]node:worker_threads['"]/g)) {
      for (const binding of declaration[1].split(',')) {
        const name = binding.trim().match(/^Worker(?:\s+as\s+(\w+))?$/);
        if (!name) continue;
        const pattern = new RegExp('new\\s+' + (name[1] ?? 'Worker') + '\\s*\\(\\s*(new\\s+URL\\(\\s*[\\\'"][^\\\'"]+[\\\'"]\\s*,\\s*import\\.meta\\.url\\s*\\))', 'g');
        for (const match of text.matchAll(pattern)) workerOffsets.add(match.index + match[0].indexOf(match[1]));
      }
    }
    const imports = [...text.matchAll(/\b(?:from\s*|import\s*\(?\s*)['"](\.[^'"]+)['"]/g)];
    const assets = [...text.matchAll(/new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g)];
    for (const match of [...imports, ...assets]) {
      const next = target(path, match[1]); if (next === null) continue;
      const lazy = workerOffsets.has(match.index);
      edges.push({ path: next, lazy }); queue.push(next);
      if (lazy) workerEntries.add(next);
    }
  }
  const eager = new Set(), eagerQueue = [...start];
  while (eagerQueue.length) {
    const path = eagerQueue.pop(); if (eager.has(path)) continue; eager.add(path);
    for (const edge of graph.get(path)) if (!edge.lazy) eagerQueue.push(edge.path);
  }
  const required = [...graph.keys()].sort();
  return { required, eager: [...eager].sort(), lazy: required.filter(path => !eager.has(path)),
    workerEntries: [...workerEntries].sort() };
}
