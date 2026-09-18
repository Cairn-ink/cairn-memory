import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCairnServer } from '../server.mjs';

const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
function run(args, key = '') {
  const forbidProvider = 'data:text/javascript,globalThis.fetch=()=>{process.exit(91)}';
  return spawnSync(process.execPath, ['--import', forbidProvider, cli, ...args], { encoding: 'utf8', timeout: 5000,
    env: { OPENAI_API_KEY: key, NODE_NO_WARNINGS: '1' } });
}

test('help exits without configuration or reading malformed ambient credentials', () => {
  const result = run(['--help'], 'synthetic\nsecret');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /stdout is protocol-only/);
  assert.match(result.stdout, /--check-config/);
  assert.equal(result.stderr, '');
  assert.ok(!result.stdout.includes('synthetic'));
});

test('check reports model-free and configured modes without opening or modifying a database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-config-'));
  const path = join(directory, 'memory.sqlite');
  for (const key of ['', 'synthetic-private-key']) {
    const result = run(['--check-config', '--db', path, '--owner', 'private-owner', '--project', 'private-project'], key);
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.scope, 'project');
    assert.equal(report.modelKeyPresent, Boolean(key));
    assert.equal(report.recall, key ? 'configured-not-verified' : 'model_not_configured');
    assert.equal(report.recallModel, key ? 'gpt-4.1-mini-2025-04-14' : null);
    assert.equal(report.databaseOpened, false);
    assert.equal(report.providerContacted, false);
    assert.deepEqual(report.unverified, ['database-readiness', 'credential-validity', 'model-availability']);
    assert.deepEqual(readdirSync(directory), []);
    assert.ok(!result.stdout.includes('private-'));
    assert.equal(result.stderr, '');
  }
  writeFileSync(path, 'not a database');
  assert.equal(run(['--check-config', '--db', path, '--owner', 'test']).status, 0);
  assert.equal(readFileSync(path, 'utf8'), 'not a database');
  assert.deepEqual(readdirSync(directory), ['memory.sqlite']);
});

test('invalid configuration fails with no reflected arguments or secrets', () => {
  const valid = ['--check-config', '--db', '/not-opened/private-db', '--owner', 'private-owner'];
  for (const args of [[], ['--help', '--db', 'private-db'], [...valid, '--check-config'],
    [...valid, '--owner', 'duplicate'], [...valid, '--project', ''],
    [...valid, '--project', ' space '], [...valid, '--project', 'x'.repeat(201)],
    [...valid, '--unknown', 'private-secret'], ['--check-config', '--db', 'x', '--owner', 'bad\nowner']]) {
    const result = run(args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('private-'));
  }
  for (const key of ['   ', 'synthetic\nsecret', 'synthetic\rsecret']) {
    const result = run(valid, key);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(!result.stderr.includes('synthetic'));
  }
});

test('qualified capture config reports explicit opt-in but unverified models without file or provider access', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-qualified-config-'));
  const path = join(directory, 'memory.sqlite');
  const args = ['--check-config', '--db', path, '--owner', 'synthetic-owner',
    '--capture-qualification', 'source-bound-v1'];
  for (const key of ['', 'synthetic-key']) {
    const result = run(args, key); assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.captureQualification, 'source-bound-v1');
    assert.equal(report.capture, key ? 'configured-not-verified' : 'model_not_configured');
    assert.equal(report.automaticCapture, false); assert.equal(report.databaseOpened, false);
    assert.equal(report.providerContacted, false); assert.deepEqual(readdirSync(directory), []);
    assert.ok(!result.stdout.includes('synthetic-key'));
  }
  for (const tail of [[], ['wrong'], ['source-bound-v1', '--capture-qualification', 'source-bound-v1']]) {
    const result = run([...args.slice(0, -1), ...tail]);
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.deepEqual(readdirSync(directory), []);
  }
  const help = run(['--help']); assert.match(help.stdout, /--capture-qualification/);
});

test('source recall default parses strictly and check-config stays syntax-only and keyless', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-source-default-'));
  const path = join(directory, 'memory.sqlite');
  const args = ['--check-config', '--db', path, '--owner', 'synthetic-owner', '--recall-context', 'source-evidence'];
  for (const key of ['', 'synthetic-private-key']) {
    const result = run(args, key); assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.recallContext, 'source-evidence');
    assert.equal(report.recall, key ? 'configured-not-verified' : 'model_not_configured');
    assert.equal(report.automaticCapture, false); assert.equal(report.databaseOpened, false);
    assert.equal(report.providerContacted, false); assert.deepEqual(readdirSync(directory), []);
    assert.ok(!result.stdout.includes('synthetic-private-key'));
  }
  for (const tail of [[], ['wrong'], ['rationale-evidence'], ['source-evidence', '--recall-context', 'source-evidence'],
    ['source-evidence', '--capture-qualification', 'source-bound-v3']]) {
    const result = run([...args.slice(0, -1), ...tail]);
    assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.deepEqual(readdirSync(directory), []);
  }
  const help = run(['--help']); assert.match(help.stdout, /--recall-context source-evidence/);
  assert.match(help.stdout, /Complete excerpts may expose more source text/);
});

test('invalid programmatic recallContext rejects before opening a database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-source-default-constructor-'));
  const path = join(directory, 'memory.sqlite');
  const base = { path, namespace: { ownerId: 'synthetic-owner', scope: 'personal', projectId: null } };
  for (const recallContext of [undefined, null, false, '', 'rationale-evidence', 'SOURCE-EVIDENCE']) {
    assert.throws(() => createCairnServer({ ...base, recallContext }), /invalid_mcp_configuration/);
    assert.deepEqual(readdirSync(directory), []);
  }
});
