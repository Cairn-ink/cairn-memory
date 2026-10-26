import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../../', import.meta.url));
const allow = JSON.parse(readFileSync(new URL('./fixtures/no-raw-db-fd-allowlist.json', import.meta.url)));
const apis = new Set(['open', 'openSync', 'readFile', 'readFileSync', 'writeFile', 'writeFileSync',
  'appendFile', 'appendFileSync', 'createReadStream', 'createWriteStream', 'FileHandle']);
// Audit exact source lines, with multiplicity, rather than allowing whole files
// or APIs. Named aliases are resolved. Namespace/dynamic imports are fail-closed
// review entries too, so a new spelling cannot silently bypass the guard.
function sites(source) {
  const bindings = new Set();
  const imports = /import\s+(\{[^}]*\}|[\w$]+(?:\s*,\s*\{[^}]*\})?|\*\s+as\s+\w+)\s+from\s+['"](?:node:)?fs(?:\/promises)?['"]/g;
  const forbidden = [];
  let body = source;
  for (const match of source.matchAll(imports)) {
    body = body.slice(0, match.index) + match[0].replace(/[^\n]/g, ' ') + body.slice(match.index + match[0].length);
    const named = match[1].match(/\{([\s\S]*)\}/);
    if (named) for (const item of named[1].split(',')) {
      const [name, alias] = item.trim().split(/\s+as\s+/);
      if (apis.has(name)) bindings.add(alias ?? name);
    }
    else forbidden.push(source.slice(0, match.index).split('\n').length - 1);
  }
  const lines = source.split('\n'), scanned = body.split('\n'), found = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('//') || line.startsWith('*')) continue;
    const count = [...bindings].reduce((n, name) => n + [...scanned[i].matchAll(new RegExp('\\b' + name + '\\b', 'g'))].length, 0);
    const indirect = /(?:import\s*\(|require\s*\()\s*['"](?:node:)?fs(?:\/promises)?['"]|\bFileHandle\b|\b(?:fs|fsp|promises)\s*(?:\.|\[)\s*['"]?(?:promises|open|openSync|readFile|readFileSync|createReadStream|createWriteStream)/.test(line);
    for (let n = 0; n < count + Number(indirect || forbidden.includes(i)); n++) found.push({ line: i + 1, source: line });
  }
  return found;
}
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (['node_modules', 'test', 'testing', '.git'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : /\.(?:[cm]?js|ts)$/.test(entry.name) ? [path] : [];
  });
}
function violations(path, source) {
  const counts = new Map();
  for (const entry of allow.filter(entry => entry.path === path)) {
    assert.equal(typeof entry.reason, 'string'); assert.ok(entry.reason.length > 15);
    counts.set(entry.source, (counts.get(entry.source) ?? 0) + 1);
  }
  return sites(source).filter(site => {
    const remaining = counts.get(site.source) ?? 0;
    if (!remaining) return true;
    counts.set(site.source, remaining - 1); return false;
  }).map(site => `${path}:${site.line}: ${site.source}`);
}
function audit(base, paths) {
  return paths.flatMap(path => violations(relative(base, path).replaceAll('\\', '/'), readFileSync(path, 'utf8')));
}
test('runtime raw filesystem access has an exact, justified allowlist', () => {
  const paths = ['core', 'adapters', 'packages/setup/lib', 'integrations', 'plugins']
    .flatMap(path => files(join(root, path)));
  paths.push(join(root, 'evaluation/live/diagnostics.mjs')); // Shipped archive diagnostic utility.
  assert.deepEqual(audit(root, paths), []);
  for (const entry of allow) {
    assert.ok(sites(readFileSync(join(root, entry.path), 'utf8')).some(site => site.source === entry.source),
      'stale allowlist entry: ' + entry.path + ': ' + entry.source);
  }
});
test('generated setup runtime and archived engine obey the same guard', () => {
  const runtime = join(root, 'packages/setup/runtime');
  assert.deepEqual(audit(runtime, files(runtime)), []);
  const directory = mkdtempSync(join(tmpdir(), 'cairn-fd-guard-'));
  try {
    const engine = join(runtime, 'engine');
    for (const name of readdirSync(engine).filter(name => name.endsWith('.tgz'))) {
      const result = spawnSync('tar', ['-xzf', join(engine, name), '-C', directory], { encoding: 'utf8' });
      assert.equal(result.error, undefined); assert.equal(result.status, 0, result.stderr);
      const base = join(directory, 'package');
      assert.deepEqual(audit(base, files(base)), []);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('guard rejects the original header probe, fs aliases, promises, streams and extra allowlisted calls', () => {
  const old = `import { openSync, readSync, closeSync } from 'node:fs';\nconst fd = openSync(path, constants.O_RDONLY);\ncloseSync(fd);`;
  assert.equal(violations('core/topic-reader-sqlite.mjs', old).length, 1);
  for (const source of [
    `import { open as raw } from 'node:fs/promises';\nawait raw(path);`,
    `import fs from 'node:fs';\nfs.promises.open(path);`,
    `const fs = await import('node:fs/promises');\nfs.open(path);`,
    `import { openSync } from 'node:fs';\nconst raw = openSync; raw(path);`,
    `import { createReadStream } from 'node:fs';\ncreateReadStream(path);`,
    `import * as fs from 'node:fs';\nfs['readFileSync'](path);`,
  ]) assert.ok(violations('core/unsafe.mjs', source).length > 0, source);
  const entry = allow.find(entry => entry.path === 'core/sqlite-journal-probe.mjs' && entry.source.includes('fd = openSync'));
  assert.equal(violations(entry.path, `import { openSync } from 'node:fs';\n${entry.source}\n${entry.source}`).length, 1);
});
