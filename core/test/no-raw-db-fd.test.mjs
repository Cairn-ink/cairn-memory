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
  const bindings = new Set(), boundaries = [];
  let body = source;
  // Tokenize identifiers (including $), quoted module names and punctuation.
  // Ignore comments so whitespace/comments cannot hide import/require forms.
  // Template contents are scanned as code too: our child programs live there.
  const tokens = [...source.matchAll(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:node:)?fs(?:\/promises)?`|[\w$]+|[^\s]/g)]
    .filter(token => !token[0].startsWith('//') && !token[0].startsWith('/*'));
  const isFs = token => {
    if (!/^[\x27"`]/.test(token ?? '')) return false;
    const value = token.slice(1, -1).replace(/\\\r?\n/g, '').replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi,
      (_, point, unicode, hex, escaped) => point || unicode || hex ? String.fromCodePoint(parseInt(point ?? unicode ?? hex, 16)) : escaped);
    return /^(?:node:)?fs(?:\/promises)?$/.test(value);
  };
  const mark = (token, finish = source.indexOf('\n', token.index)) => boundaries.push({
    line: source.slice(0, token.index).split('\n').length,
    source: source.slice(token.index, finish < 0 ? source.length : finish).trim(),
  });
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Any call receiving an fs module literal is a review boundary. This also
    // covers aliases made by createRequire, without guessing the alias name.
    if (isFs(token[0]) && tokens[i - 1]?.[0] !== 'from') {
      mark(tokens[i - 1]?.[0] === '(' ? tokens[i - 2] ?? token : token, token.index + token[0].length);
    }
    if (token[0] !== 'import' || tokens[i + 1]?.[0] === '(') continue;
    let end = i + 1;
    while (end < tokens.length && !['from', ';'].includes(tokens[end][0])) end++;
    if (tokens[end]?.[0] !== 'from' || !isFs(tokens[end + 1]?.[0])) continue;
    const clause = tokens.slice(i + 1, end).map(t => t[0]);
    // Review every fs import, including unknown/new APIs and quoted export names.
    // Metadata-only imports are cheap to audit and cannot hide a new fd API.
    for (let j = 0; j < clause.length; j++) {
      if (apis.has(clause[j]) || clause[j] === 'promises') {
        bindings.add(clause[j + 1] === 'as' ? clause[j + 2] : clause[j]);
      }
    }
    const finish = tokens[end + 1].index + tokens[end + 1][0].length;
    mark(token, finish); // Audit the ENTIRE import, even when multiline/unused.
    body = body.slice(0, token.index) + body.slice(token.index, finish).replace(/[^\n]/g, ' ') + body.slice(finish);
  }
  const lines = source.split('\n'), scanned = body.split('\n'), found = [...boundaries];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith('//') || line.startsWith('*')) continue;
    const count = [...bindings].reduce((n, name) => n + [...scanned[i].matchAll(new RegExp('(?<![\\w$])' + name.replaceAll('$', '\\$') + '(?![\\w$])', 'g'))].length, 0);
    const indirect = /(?:import\s*\(|require\s*\()\s*['"](?:node:)?fs(?:\/promises)?['"]|\bFileHandle\b|\b(?:fs|fsp|promises)\s*(?:\.|\[)\s*['"]?(?:promises|open|openSync|readFile|readFileSync|createReadStream|createWriteStream)/.test(line);
    for (let n = 0; n < count + Number(indirect); n++) found.push({ line: i + 1, source: line });
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
  for (const path of new Set(allow.map(entry => entry.path))) {
    assert.deepEqual(sites(readFileSync(join(root, path), 'utf8')).map(site => site.source).sort(),
      allow.filter(entry => entry.path === path).map(entry => entry.source).sort(),
      'stale allowlist entries or multiplicity: ' + path);
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
  assert.equal(violations('core/topic-reader-sqlite.mjs', old).length, 2);
  for (const source of [
    "const io = await import(`node:fs/promises`); const handle = await io.open(path);",
    "import { open as raw } from 'node:\\x66s/promises'; const handle = await raw(path);",
    "const moduleName = 'node:fs'; const io = require(moduleName); io.openSync(path);",
    `import { 'open' as raw } from 'node:fs';\nconst handle = await raw(path);`,
    `import { promises as io } from 'node:fs';\nawait io.open(path);`,
    `import { openSync as $raw } from 'node:fs';\n$raw(path);`,
    `import fs, { statSync } from 'node:fs';\nfs.openSync(path);`,
    `import fs, { open as $raw } from 'node:fs';\n$raw(path);`,
    `const io = await import(\n 'node:fs'\n);\nconst handle = await io.promises.open(path);`,
    `const load = createRequire(import.meta.url);\nconst io = load(\n 'node:fs/promises'\n);\nconst handle = await io.open(path);`,
    `import /* comment */ { promises as $io } from /* comment */ 'fs';\nconst handle = await $io.open(path);`,
    `import * as $io from 'fs/promises';\nconst handle = await $io.open(path);`,
    `import { open as raw } from 'node:fs/promises';\nawait raw(path);`,
    `import fs from 'node:fs';\nfs.promises.open(path);`,
    `const fs = await import('node:fs/promises');\nfs.open(path);`,
    `import { openSync } from 'node:fs';\nconst raw = openSync; raw(path);`,
    `import { createReadStream } from 'node:fs';\ncreateReadStream(path);`,
    `import * as fs from 'node:fs';\nfs['readFileSync'](path);`,
  ]) assert.ok(violations('core/unsafe.mjs', source).length > 0, source);
  const multiline = allow.find(entry => entry.source.startsWith('import {') && entry.source.includes('\n'));
  assert.ok(multiline);
  assert.equal(violations(multiline.path, multiline.source).length, 0);
  assert.ok(violations(multiline.path, multiline.source.replace('{', '{ open as $sneak,') + '\nawait $sneak(path);').length > 0);
  const entry = allow.find(entry => entry.path === 'core/sqlite-journal-probe.mjs' && entry.source.includes('fd = openSync'));
  assert.equal(violations(entry.path, `${entry.source}\n${entry.source}\nimport { openSync } from 'node:fs';`).length, 2);
});
