import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

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
    for (const edge of source.matchAll(/(['"])(\.\.?\/[^'"\n]*)\1/g)) {
      const specifier = edge[2];
      // Non-module assets are not executable edges. Extensionless specifiers
      // use Node's resolver, which also handles directory package entry points.
      if (!moduleFile.test(specifier) && !/\brequire\s*\(\s*$/.test(source.slice(0, edge.index))) continue;
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
  const importers = [];
  for (const [file, source] of sources) {
    for (const edge of source.matchAll(/(['"])(\.\.?\/[^'"\n]*)\1/g)) {
      if (relative(featureRoot, resolve(featureRoot, dirname(file), edge[2])) !== owner) continue;
      const declaration = /\bimport\s*\{([^{}]*)\}\s*from\s*$/.exec(source.slice(0, edge.index));
      assert.ok(declaration, 'unreviewed feature namespace/forwarding/dynamic import: ' + file);
      for (const binding of declaration[1].split(',').map(value => value.trim()).filter(Boolean)) {
        const parts = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(binding);
        assert.ok(parts, 'unsupported feature import syntax: ' + file);
        if (parts[1] !== accessor) continue;
        assert.equal(parts[2] ?? parts[1], accessor, 'unreviewed feature accessor alias: ' + file);
        assert.ok(consumers.includes(file), 'unreviewed feature accessor importer: ' + file);
        importers.push(file);
      }
    }
  }
  assert.deepEqual(importers.sort(), [...consumers].sort(), 'exact three feature accessor importers');
}
