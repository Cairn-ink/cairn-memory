// Tripwire against accidental raw-fd reintroduction, NOT an adversarial barrier.
// Out of scope: eval/Function/vm, native addons, deliberately obfuscated code.
// Exact source entries and multiplicity still require review; no whole-file pass.
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
const decode = value => value.replace(/\\(?:u\{([\da-f]+)\}|u([\da-f]{4})|x([\da-f]{2})|([\s\S]))/gi,
  (_, point, unicode, hex, escaped) => point || unicode || hex ? String.fromCodePoint(parseInt(point ?? unicode ?? hex, 16)) : escaped);
function tokenize(source, offset = 0) {
  const tokens = [];
  const expressionStart = new Set(['=', '(', '[', '{', ',', ':', ';', '!', '?', '&', '|', 'return', 'throw', 'case', '>']);
  for (let i = 0; i < source.length;) {
    const start = i, c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (source.startsWith('//', i)) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end; continue; }
    if (source.startsWith('/*', i)) { const end = source.indexOf('*/', i + 2); i = end < 0 ? source.length : end + 2; continue; }
    let literal = false;
    if (["'", '"', '`'].includes(c)) {
      literal = true; i++;
      while (i < source.length) { if (source[i] === '\\') i += 2; else if (source[i++] === c) break; }
    } else if (c === '/' && (!tokens.length || expressionStart.has(tokens.at(-1).value))) {
      // Keep regex literals opaque too, so quotes/comment markers inside them
      // cannot consume subsequent imports or calls.
      literal = true; i++; let bracket = false;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === '[') bracket = true;
        if (source[i] === ']') bracket = false;
        if (source[i++] === '/' && !bracket) break;
      }
      while (/[a-z]/i.test(source[i] ?? '') && i < source.length) i++;
    } else {
      const identifier = /^(?:[\w$]|\\u\{[\da-fA-F]+\}|\\u[\da-fA-F]{4})+/.exec(source.slice(i));
      i += identifier ? identifier[0].length : 1;
    }
    const raw = source.slice(start, i);
    tokens.push({ value: literal ? raw : decode(raw), index: offset + start, length: raw.length, literal });
    // Audit fixed child programs embedded in templates as source too.
    if (raw[0] === '`' && /\bimport\s/.test(raw)) tokens.push(...tokenize(raw.slice(1, -1), offset + start + 1));
  }
  return tokens;
}
function sites(source) {
  const tokens = tokenize(source), found = [], declarations = new Set();
  const bindings = new Set(), namespaces = new Set(['fs', 'fsp', 'promises']), allBindings = new Set();
  const loaders = new Set(['require', 'createRequire']);
  const isFs = token => token?.literal && /^(?:node:)?fs(?:\/promises)?$/.test(decode(token.value.slice(1, -1)));
  const mark = (token, finish) => found.push({
    line: source.slice(0, token.index).split('\n').length,
    source: finish === undefined ? source.split('\n')[source.slice(0, token.index).split('\n').length - 1].trim() :
      source.slice(token.index, finish).trim(),
  });
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i], value = token.value;
    if (isFs(token) && tokens[i - 1]?.value !== 'from') {
      const start = tokens[i - 1]?.value === '(' ? tokens[i - 2] ?? token : token;
      mark(start, token.index + token.length);
      // Recognize namespace variables from import/require/getBuiltinModule.
      for (let j = i - 2; j >= 0 && ![';', '{', '}'].includes(tokens[j].value); j--) {
        if (tokens[j].value === '=') { namespaces.add(tokens[j - 1]?.value); break; }
      }
    }
    if (!['import', 'export'].includes(value) || tokens[i + 1]?.value === '(') continue;
    const next = tokens[i + 1]?.value;
    if (value === 'export' && !['{', '*'].includes(next)) continue;
    if (value === 'import' && !['{', '*'].includes(next) &&
        ![',', 'from'].includes(tokens[i + 2]?.value)) continue;
    let end = i + 1;
    while (end < tokens.length && !['from', ';'].includes(tokens[end].value)) end++;
    const module = tokens[end + 1];
    if (tokens[end]?.value !== 'from') continue;
    if (module?.literal && /^(?:node:)?module$/.test(decode(module.value.slice(1, -1)))) {
      for (let j = i + 1; j < end; j++) if (tokens[j].value === 'createRequire')
        loaders.add(tokens[j + 1]?.value === 'as' ? tokens[j + 2]?.value : 'createRequire');
    }
    if (!isFs(module)) continue;
    for (let j = i + 1; j < end; j++) {
      const name = tokens[j].literal ? decode(tokens[j].value.slice(1, -1)) : tokens[j].value;
      const alias = tokens[j + 1]?.value === 'as' ? tokens[j + 2]?.value : name;
      if (/^[\w$]+$/.test(alias) && alias !== 'as') allBindings.add(alias);
      if (apis.has(name) || name === 'promises') bindings.add(alias);
      if (tokens[j - 1]?.value === 'as' && tokens[j - 2]?.value === '*' || j === i + 1 && !['{', '*'].includes(name) || name === 'promises') namespaces.add(alias);
    }
    mark(token, module.index + module.length);
    for (let j = i; j <= end + 1; j++) declarations.add(j);
  }
  // Track createRequire-produced aliases; the construction itself is audited.
  for (let i = 0; i < tokens.length; i++) {
    if (loaders.has(tokens[i].value) && tokens[i + 1]?.value === '(' && tokens[i - 1]?.value === '=')
      loaders.add(tokens[i - 2]?.value);
  }
  for (let i = 0; i < tokens.length; i++) {
    if (declarations.has(i)) continue;
    const token = tokens[i], name = token.value, next = tokens[i + 1];
    if (token.literal) continue;
    if (bindings.has(name)) mark(token);
    if ((allBindings.has(name) || namespaces.has(name)) && next?.value === '[') mark(token);
    else if (namespaces.has(name) && next?.value === '.' &&
      (apis.has(tokens[i + 2]?.value) || tokens[i + 2]?.value === 'promises')) mark(token);
    if (name === 'FileHandle') mark(token);
    const builtin = name === 'getBuiltinModule' && tokens[i - 1]?.value === '.' && tokens[i - 2]?.value === 'process';
    if ((loaders.has(name) || builtin) && next?.value === '(' &&
        (!tokens[i + 2]?.literal || tokens[i + 2].value.includes('${') || tokens[i + 3]?.value !== ')')) mark(token);
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
  assert.ok(violations('core/topic-reader-sqlite.mjs', old).length >= 2);
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
  assert.ok(violations(entry.path, `${entry.source}\n${entry.source}\nimport { openSync } from 'node:fs';`).length >= 2);
});


test('round 2 tripwire rejects each realistic bypass even with an allowed import', () => {
  const path = 'core/unsafe.mjs';
  for (const source of [
    "import { openSync } from 'node:fs';\n/* comment\n*/ openSync(path);",
    "export { openSync as raw } from 'node:fs';",
    "export * from 'node:fs';",
    String.raw`import { op\u0065nSync as raw } from 'node:fs'; raw(path);`,
    String.raw`import { openSync as r\u0061w } from 'node:fs'; r\u0061w(path);`,
    "import fs from 'node:fs';\nfs[x](path);",
    'import * as io from "node:fs";\nio[`open${s}`](path);',
    "import { promises as io } from 'node:fs';\nio[x](path);",
    "const fs = process.getBuiltinModule(name);",
    "const fs = require(name);",
    "const load = createRequire(name);",
    "import { createRequire as cr } from 'node:module'; const load=cr(import.meta.url); load(name);",
  ]) assert.ok(violations(path, source).length > 0, source);
  // Imports can already be allowed: the call after a block comment and escaped
  // binding uses must independently remain visible.
  assert.equal(sites("import { openSync } from 'node:fs';\n/* comment\n*/ openSync(path);").length, 2);
  assert.equal(sites(String.raw`import { openSync } from 'node:fs';
\u006fpenSync(path);`).length, 2);
  assert.deepEqual(sites('// openSync(path)\nconst text="fs.openSync(path)"; /* fs[x] */'), []);
});

test('allowed import boundaries cannot hide computed members or escaped calls', () => {
  for (const source of [
    "import fs from 'node:fs';\nfs[x](path);",
    'import * as io from "node:fs";\nio[`open${s}`](path);',
    "import { promises as io } from 'node:fs';\nio[x](path);",
    "const io = process.getBuiltinModule('node:fs');\nio[x](path);",
    "import { statSync as metadata } from 'node:fs';\nmetadata[x](path);",
  ]) { assert.ok(sites(source).length >= 2, source); assert.ok(sites(source).some(site => site.line === 2), source); }
});
