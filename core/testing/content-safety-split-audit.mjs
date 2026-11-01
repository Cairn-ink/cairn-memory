import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { protectedInsertionTargets } from './content-safety-split-sql.mjs';

export const splitRoot = new URL('../../', import.meta.url).pathname;
export const splitFixture = JSON.parse(readFileSync(new URL('../test/fixtures/content-safety-split.json', import.meta.url), 'utf8'));
const digest = source => createHash('sha256').update(source).digest('hex');
const word = name => new RegExp('\\b' + name + '\\b', 'g');

export function splitSources() {
  const sources = new Map();
  function visit(directory) {
    for (const entry of readdirSync(join(splitRoot, directory), { withFileTypes: true })) {
      if (['test', 'testing', 'node_modules'].includes(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name.endsWith('.mjs')) sources.set(path, readFileSync(join(splitRoot, path), 'utf8'));
    }
  }
  for (const directory of ['core', 'adapters', 'integrations/client/raw']) visit(directory);
  // Follow literal local edges as well: a facade can delegate into a module
  // outside these roots. Map iteration includes newly discovered modules.
  for (const [file, source] of sources) {
    for (const edge of source.matchAll(/(['"])(\.[^'"\n]+\.mjs)\1/g)) {
      const path = relative(splitRoot, resolve(splitRoot, dirname(file), edge[2]));
      assert.ok(!path.startsWith('../'), 'runtime edge escapes repository: ' + file);
      if (!sources.has(path)) sources.set(path, readFileSync(join(splitRoot, path), 'utf8'));
    }
  }
  return sources;
}

export function assertSplitInventory(inventory, reviewed = splitFixture.inventory) {
  assert.deepEqual(inventory, reviewed, 'public inventory changed: review every export and facade method');
}

/** Sink-oriented static call graph. Every path to an insertion capability must
 * cross a reference to one of these bindings. Close ALL such references, not
 * just calls named writeContentSuppressionInside: imports cannot alias, forward,
 * re-export or escape, and references outside the pinned writer regions fail.
 * The regions pin the canonical mutation alongside the fact call, so adding a
 * wrapper inside an otherwise approved file does not create an exception.
 * This deliberately rejects unreviewed syntax instead of guessing alias flow.
 */
export function assertSplitGraph(sources = splitSources(), reviewed = splitFixture) {
  const capabilities = reviewed.capabilities;
  const owners = new Set(capabilities.map(item => item.file));
  const imports = [], edges = [];
  for (const pin of reviewed.implementations) {
    assert.equal(digest(sources.get(pin.file)), pin.sha256, 'review insertion/DDL implementation: ' + pin.file);
  }
  const regions = reviewed.writers.map(pin => {
    const source = sources.get(pin.file), start = source.indexOf(pin.start);
    const end = pin.end === null ? source.length : source.indexOf(pin.end, start + pin.start.length);
    assert.ok(start >= 0 && end > start && source.indexOf(pin.start, start + 1) < 0, 'unique writer region: ' + pin.id);
    assert.equal(digest(source.slice(start, end)), pin.sha256, 'review canonical writer: ' + pin.id);
    return { ...pin, startOffset: start, endOffset: end };
  });
  for (const [file, source] of sources) {
    const bindings = [];
    // Literal module specifiers, including import(), URL and export spellings.
    // Only named static imports may cross an insertion-capability boundary.
    for (const literal of source.matchAll(/(['"])([^'"\n]+\.mjs)\1/g)) {
      if (!literal[2].startsWith('.')) continue;
      const target = relative(splitRoot, resolve(splitRoot, dirname(file), literal[2]));
      if (!owners.has(target)) continue;
      const prefix = source.slice(0, literal.index);
      const declaration = /\bimport\s*\{([^{}]*)\}\s*from\s*$/.exec(prefix);
      assert.ok(declaration, 'unreviewed forwarding/namespace/dynamic capability edge: ' + file + ' -> ' + target);
      const start = declaration.index, end = literal.index + literal[0].length;
      for (const binding of declaration[1].split(',').map(value => value.trim()).filter(Boolean)) {
        const parts = /^(\w+)(?:\s+as\s+(\w+))?$/.exec(binding);
        assert.ok(parts, 'unsupported capability import: ' + file);
        const capability = capabilities.find(item => item.file === target && item.name === parts[1]);
        if (!capability) continue;
        assert.equal(parts[2] ?? parts[1], parts[1], 'capability alias requires review: ' + file);
        imports.push({ file, name: parts[1], from: target });
        bindings.push({ name: parts[1], start, end });
      }
    }
    // Newly introduced SQL insertion seams cannot bypass the helper graph.
    if (protectedInsertionTargets(source).length) {
      assert.ok(reviewed.implementations.some(pin => pin.file === file), 'unreviewed direct insertion SQL: ' + file);
    }
    for (const capability of capabilities) {
      // Helpers and schema builders have closed, byte-pinned implementations.
      if (reviewed.implementations.some(pin => pin.file === file)) continue;
      for (const use of source.matchAll(word(capability.name))) {
        if (bindings.some(binding => binding.name === capability.name && use.index >= binding.start && use.index < binding.end)) continue;
        const writer = regions.find(pin => pin.file === file && use.index >= pin.startOffset && use.index < pin.endOffset);
        assert.ok(writer, 'unreviewed fact-only reference: ' + file + ':' + capability.name);
        edges.push({ writer: writer.id, helper: capability.name });
      }
    }
  }
  const ordered = values => values.map(value => JSON.stringify(value)).sort();
  assert.deepEqual(ordered(imports), ordered(reviewed.imports), 'review capability import graph');
  assert.deepEqual(ordered(edges), ordered(reviewed.edges), 'review canonical writer/helper edges');
  return { imports: imports.length, edges: edges.length, writers: regions.length };
}
