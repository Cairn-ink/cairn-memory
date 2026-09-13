import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { installPreview } from '../install-preview.mjs';
import { command } from '../build.mjs';

const target = () => join(mkdtempSync(join(tmpdir(), 'cairn-qualified-receipt-')), 'new');
const args = directory => ['--directory', directory, '--owner', 'synthetic-owner'];

test('IR1 invalid/null/missing/duplicate mode flags reject before commands or target writes', () => {
  const directory = target(); const parent = join(directory, '..'); const before = readdirSync(parent); let calls = 0;
  for (const extra of [ ['--capture-qualification'], ['--capture-qualification', null], ['--capture-qualification', undefined],
    ['--capture-qualification', ''], ['--capture-qualification', 'source-bound-v3'], ['--capture-qualification', ' source-bound-v2'],
    ['--capture-qualification', 'source-bound-v2', '--capture-qualification', 'source-bound-v1'],
    ['--capture-qualification', 'source-bound-v2', '--unknown', 'value'] ]) {
    assert.throws(() => installPreview([...args(directory), ...extra], { runCommand() { calls++; assert.fail('No invalid install'); } }), /cairn_preview_install_failed/);
  }
  assert.equal(calls, 0); assert.equal(existsSync(directory), false); assert.deepEqual(readdirSync(parent), before);
});

for (const mode of [undefined, 'source-bound-v1', 'source-bound-v2']) {
  test(`IR2 actual offline install forwards exact ${mode ?? 'absent'} mode into check and receipt without credential reads`, { timeout: 120000 }, () => {
    const directory = target(); const originalEnv = process.env; let keyReads = 0; const calls = []; let checked;
    process.env = new Proxy(originalEnv, { get(object, key) {
      if (key === 'OPENAI_API_KEY') { keyReads++; throw new Error('Credential lookup prohibited in installer'); }
      return Reflect.get(object, key);
    } });
    let report;
    try {
      report = installPreview([...args(directory), ...(mode ? ['--capture-qualification', mode] : [])], {
        runCommand(executable, arguments_, cwd, userconfig) {
          calls.push({ executable, args: [...arguments_] });
          if (executable === 'npm') {
            assert.ok(arguments_.includes('--ignore-scripts')); assert.ok(arguments_.includes('--registry=https://registry.npmjs.org/'));
            return command(executable, [...arguments_, '--offline'], cwd, userconfig);
          }
          const output = command(executable, arguments_, cwd, userconfig); checked = JSON.parse(output); return output;
        },
      });
    } finally { process.env = originalEnv; }
    assert.equal(keyReads, 0); assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].args, [report.executable, '--check-config', ...report.stdio.args.slice(1)]);
    assert.equal(checked.databaseOpened, false); assert.equal(checked.providerContacted, false); assert.equal(checked.modelKeyPresent, false);
    assert.equal(checked.captureQualification, mode); assert.equal(report.captureQualification, mode);
    assert.equal(report.stdio.args.filter(value => value === '--capture-qualification').length, mode ? 1 : 0);
    if (mode) { assert.deepEqual(report.stdio.args.slice(-2), ['--capture-qualification', mode]); assert.equal(checked.capture, 'model_not_configured'); }
    else { assert.equal(Object.hasOwn(report, 'captureQualification'), false); assert.equal(Object.hasOwn(checked, 'captureQualification'), false); assert.equal(Object.hasOwn(checked, 'capture'), false); }
    assert.deepEqual(Object.keys(report.stdio).sort(), ['args', 'command']);
    const stored = JSON.parse(readFileSync(report.receiptPath, 'utf8')); const { receiptPath, ...expected } = report;
    assert.deepEqual(stored, expected); assert.ok(!JSON.stringify(stored).includes('OPENAI_API_KEY'));
    assert.equal(statSync(receiptPath).mode & 0o777, 0o600); assert.deepEqual(readdirSync(join(directory, 'data')), []);
    assert.equal(report.databasePath, join(directory, 'data', 'memory.sqlite')); assert.ok(!report.databasePath.startsWith(join(directory, 'app')));
  });
}

test('IR3 mismatched or missing check mode retains partial installation and never writes a misleading receipt', () => {
  for (const reported of [undefined, 'source-bound-v1', 'other']) {
    const directory = target(); let calls = 0;
    assert.throws(() => installPreview([...args(directory), '--capture-qualification', 'source-bound-v2'], {
      runCommand(executable, arguments_) {
        calls++; if (executable === 'npm') return '';
        assert.deepEqual(arguments_.slice(-2), ['--capture-qualification', 'source-bound-v2']);
        return JSON.stringify({ ok: true, databaseOpened: false, providerContacted: false, modelKeyPresent: false,
          ...(reported === undefined ? {} : { captureQualification: reported }) });
      },
    }), /partial installation is retained/);
    assert.equal(calls, 2); assert.ok(existsSync(join(directory, 'app', 'package.json')));
    assert.equal(existsSync(join(directory, 'installation-receipt.json')), false); assert.deepEqual(readdirSync(join(directory, 'data')), []);
  }
});
