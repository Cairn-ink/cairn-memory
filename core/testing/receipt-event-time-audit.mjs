import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { moduleEdges } from './receipt-event-time-modules.mjs';

export const featureRoot = fileURLToPath(new URL('../../', import.meta.url));
const moduleFile = /\.(?:mjs|js|cjs)$/;

// Scan all production roots, then close over local edges (including Worker URL
// literals, import(), require(), and extensionless CommonJS dependencies).
// This audit is separate from the frozen S2h split audit and its inventory.
export function featureSources(root = featureRoot) {
  const sources = new Map();
  function visit(directory) {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      if (['test', 'testing', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (moduleFile.test(path)) sources.set(path, readFileSync(join(root, path), 'utf8'));
    }
  }
  for (const directory of ['core', 'adapters', 'integrations/client', 'integrations/codex']) visit(directory);
  // The packaging source is installed at bin/, so resolve its edges there.
  sources.set('bin/cairn-memory.mjs', readFileSync(join(root, 'packaging/bin/cairn-memory.mjs'), 'utf8'));
  for (const [file, source] of sources) {
    const local = createRequire(resolve(root, file));
    for (const edge of moduleEdges(file, source)) {
      const specifier = edge.path;
      if (!specifier.startsWith('.')) continue;
      const target = moduleFile.test(specifier) ? resolve(root, dirname(file), specifier) : local.resolve(specifier);
      const path = relative(root, target);
      assert.ok(!path.startsWith('../'), 'runtime edge escapes repository: ' + file);
      if (moduleFile.test(path) && !sources.has(path)) sources.set(path, readFileSync(target, 'utf8'));
    }
  }
  return sources;
}

const accessor = 'receiptEventTimeEnabled';
const owner = 'core/content-safety-schema.mjs';
const consumers = ['core/runtime.mjs', 'core/context-product-schema.mjs', 'core/context-read-facade.mjs'];

// The owner is byte-pinned by the feature gate. No namespace, forwarding or
// dynamic access to its exports is allowed, even with a computed property key.
// Other imports from the owner remain ordinary named imports. The accessor
// itself cannot be aliased or re-exported, and its uses are pinned at the sinks.
export function assertFeatureImports(sources) {
  const edges = new Map([...sources].map(([file, source]) => [file, moduleEdges(file, source)]));
  const targetOf = (file, edge) => edge.path.startsWith('.')
    ? relative(featureRoot, resolve(featureRoot, dirname(file), edge.path)) : edge.path;
  // Include every forwarding hop before checking consumers. Refuse forwarding
  // itself as before, even when a downstream use hides the accessor's spelling.
  const sensitive = new Set([owner]);
  let changed;
  do {
    changed = false;
    for (const [file, imports] of edges) {
      if (!sensitive.has(file) && imports.some(edge => edge.kind === 'export' && sensitive.has(targetOf(file, edge)))) {
        sensitive.add(file);
        changed = true;
      }
    }
  } while (changed);
  const importers = [];
  for (const [file, imports] of edges) {
    for (const edge of imports) {
      if (!sensitive.has(targetOf(file, edge))) continue;
      // Keep the existing stricter named-import boundary in all modules,
      // including the three consumers. This rejects every computed namespace
      // member, alias, spread, destructure and dynamic namespace escape.
      assert.ok(edge.kind === 'import' && edge.node.specifiers.every(binding => binding.type === 'ImportSpecifier'),
        'unreviewed feature namespace/forwarding/dynamic import: ' + file);
      for (const binding of edge.node.specifiers) {
        if ((binding.imported.name ?? binding.imported.value) !== accessor) continue;
        assert.equal(binding.local.name, accessor, 'unreviewed feature accessor alias: ' + file);
        assert.ok(consumers.includes(file), 'unreviewed feature accessor importer: ' + file);
        importers.push(file);
      }
    }
  }
  assert.deepEqual(importers.sort(), [...consumers].sort(), 'exact three feature accessor importers');
}
