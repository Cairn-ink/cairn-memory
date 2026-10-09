import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, chmod, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { readClaudeCredential, sharedAuthorization } from '../lib/authorization.mjs';
import { translator } from '../lib/messages.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const token = 'synthetic-native-plugin-secret';
const bytes = JSON.stringify({ pluginSecrets: { 'cairn-memory@cairn-memory': { api_token: token } } });
test('native Claude Linux store is read-only and refuses symlinks or unsafe modes', async t => {
  const ws = createTestWorkspace(t, { prefix: 'native-credential-' });
  const directory = join(ws.path, 'claude'); await mkdir(directory, { mode: 0o700 });
  const path = join(directory, '.credentials.json'); await writeFile(path, bytes, { mode: 0o600 });
  const options = { platform: 'linux', env: { CLAUDE_CONFIG_DIR: directory } };
  assert.deepEqual(await readClaudeCredential('https://example.com', options), { endpoint: 'https://example.com', token });
  await chmod(path, 0o640);
  await assert.rejects(readClaudeCredential('https://example.com', options), { key: 'authorization_credential_unavailable', code: 2 });
  const other = join(ws.path, 'symlinked'); await mkdir(other); await symlink(path, join(other, '.credentials.json'));
  await assert.rejects(readClaudeCredential('https://example.com', { ...options, env: { CLAUDE_CONFIG_DIR: other } }), { key: 'authorization_credential_unavailable' });
});
for (const custom of [false, true]) test(`native macOS keychain read uses only account/service argv (custom: ${custom})`, async () => {
  const directory = '/synthetic/claude';
  let args;
  const result = await readClaudeCredential('https://example.com', { platform: 'darwin',
    env: { USER: 'fixture-user', ...(custom ? { CLAUDE_CONFIG_DIR: directory } : {}) },
    keychain: async value => { args = value; return bytes; } });
  assert.equal(result.token, token);
  const suffix = custom ? '-' + createHash('sha256').update(directory).digest('hex').slice(0, 8) : '';
  assert.deepEqual(args, ['find-generic-password', '-a', 'fixture-user', '-w', '-s', 'Claude Code-credentials' + suffix]);
  assert.ok(!JSON.stringify(args).includes(token));
});
test('native-store failure suppresses secret-bearing errors and requires explicit reauthorization', async () => {
  await assert.rejects(readClaudeCredential('https://example.com', { platform: 'darwin', env: { USER: 'fixture' },
    keychain: async () => { throw new Error(token); } }), error => {
    assert.equal(error.key, 'authorization_credential_unavailable'); assert.ok(!error.message.includes(token)); return true;
  });
});
for (const lang of ['zh', 'en']) test(`shared endpoint refusal is localized (${lang}) and cannot start authorization`, async () => {
  const authorization = await sharedAuthorization({ stored: { endpoint: 'https://old.example', token },
    authOptions: { request: () => { throw new Error('must not request'); } } });
  await assert.rejects(authorization.authorize('https://new.example', {}), error => {
    assert.equal(error.key, 'authorization_endpoint_conflict'); assert.equal(error.code, 2);
    const text = translator(lang)(error.key); assert.match(text, /--reauthorize/);
    assert.match(text, lang === 'zh' ? /既有 endpoint/ : /endpoints conflict/); return true;
  });
});
