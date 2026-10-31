#!/usr/bin/env node
// Freeze only selected schemas and small synthetic rollout evidence. Never copy
// a full protocol dump, configuration, credentials, or the disposable homes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const args = process.argv.slice(2), option = name => args[args.indexOf(name) + 1];
for (const name of ['--from', '--seeded', '--out']) if (!args.includes(name)) throw new Error('usage: --from <native-probe-dir> --seeded <seeded-probe-dir> --out <fixture-dir>');
const from = resolve(option('--from')), seeded = resolve(option('--seeded')), out = resolve(option('--out'));
const readJSON = async path => JSON.parse(await readFile(path));
const manifest = await readJSON(join(from, 'manifest.json'));
if (manifest.failure || manifest.unexpected.length || manifest.exits.some(row => row.code !== 0 || row.signal)) throw new Error('native_probe_failed');
const version = manifest.version, files = [], sha = bytes => createHash('sha256').update(bytes).digest('hex');
const replacements = [[join(from, 'home/.codex'), '<CODEX_HOME>'], [join(from, 'project'), '<CWD>'],
  [join(from, 'home'), '<HOME>'], [from, '<PROBE_ROOT>'], [seeded, '<SEEDED_ROOT>']];
const syntheticGit = { commit_hash: '0'.repeat(40), branch: 'synthetic-branch', repository_url: 'https://example.invalid/synthetic.git' };
function sanitize(value, key = '') {
  if (Array.isArray(value)) return value.map(child => sanitize(child, key));
  if (key === 'git' && value && typeof value === 'object') return Object.fromEntries(Object.keys(value).map(name => {
    if (!Object.hasOwn(syntheticGit, name)) throw new Error('native_git_key_unsupported');
    return [name, syntheticGit[name]];
  }));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, child]) => [sanitize(name), sanitize(child, name)]));
  if (typeof value !== 'string') return value;
  let text = value;
  for (const [path, placeholder] of replacements) text = text.replaceAll(path, placeholder);
  if (key === 'command') return '<HOOK_COMMAND>';
  if (text.startsWith('/')) return '<ABSOLUTE_PATH>';
  // Noncanonical context comes from native environment/skill construction.
  // Retain its shape and discriminator, replace prose with synthetic text.
  if ((key === 'text' && !/^(Synthetic |First stable section\.|Second terminal section\.|SYNTHETIC_|UNFINISHED_)/u.test(text)) || text.length > 160)
    return 'Synthetic excluded context.';
  return text;
}
async function save(path, value, { raw = false, sanitizeValue = true } = {}) {
  const bytes = Buffer.from(raw ? value : JSON.stringify(sanitizeValue ? sanitize(value) : value, null, 2) + '\n');
  await mkdir(join(out, path, '..'), { recursive: true }); await writeFile(join(out, path), bytes);
  files.push({ path, sha256: sha(bytes), bytes: bytes.length }); return path;
}
const binaryDir = 'binary-' + version;
for (const name of ['format.json', 'qualification.json']) await save(binaryDir + '/' + name,
  await readJSON(join(from, 'evidence', name)), { sanitizeValue: false });
// Excerpts contain exactly the independently found marker, avoiding unrelated
// neighbouring binary text. Missing historical markers remain explicit -1s.
await save(binaryDir + '/marker-presence.json', await readJSON(join(from, 'marker-presence.json')), { sanitizeValue: false });
const cases = [];
for (const entry of manifest.cases) {
  if (entry.error) throw new Error('native_case_failed');
  const raw = await readFile(join(from, entry.path));
  if (sha(raw) !== entry.sha256) throw new Error('native_case_hash_mismatch');
  const rows = raw.toString().trim().split('\n').map(line => sanitize(JSON.parse(line)));
  const path = await save(`native-rollout-${version}-${entry.name}.jsonl`, rows.map(row => JSON.stringify(row)).join('\n') + '\n', { raw: true });
  cases.push({ ...entry, path, nativeSha256: entry.sha256, sha256: files.at(-1).sha256 });
}
const hooks = { untrusted: await readJSON(join(from, 'hooks-untrusted.json')), trusted: await readJSON(join(from, 'hooks-trusted.json')),
  notifications: await readJSON(join(from, 'hook-notifications.json')), placement: await readJSON(join(from, 'recall-placement.json')) };
await save(`native-hooks-${version}.json`, hooks);
const history = await readJSON(join(seeded, 'history-results.json'));
const rpc = await readJSON(join(seeded, 'history-rpc.json'));
await save(`seeded-readback-${version}.json`, { ...history, methods: [...new Set(rpc.filter(row => row.direction === 'request').map(row => row.method))] });
const fileCount = files.length;
await save(`native-evidence-${version}.json`, { ...manifest, cases, files: [...files],
  seededReadback: { scriptSha256: history.scriptSha256, isolationScriptSha256: history.isolationScriptSha256,
    exits: history.exits, modelCalls: history.modelCalls, mockRequests: history.mockRequests },
  normalization: { scriptSha256: sha(await readFile(new URL(import.meta.url))),
    note: 'Path strings/keys become placeholders; git metadata values become synthetic scalars; native noncanonical context prose becomes synthetic excluded context. All rows, keys, discriminators and canonical completed messages are retained. Native and normalized rollout hashes are both recorded.' },
}, { sanitizeValue: false });
console.log(JSON.stringify({ version, files: fileCount + 1, bytes: files.reduce((total, file) => total + file.bytes, 0) }));
