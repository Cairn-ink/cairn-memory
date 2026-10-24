import test from 'node:test';
import assert from 'node:assert/strict';
import { access, open, readFile, readdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { authenticateFixture } from '../assembly/auth.mjs';
import { loadFixture, compareIds } from '../lib/fixture.mjs';
import { scoreCell } from '../assembly/score.mjs';
import { buildReport } from '../assembly/report.mjs';

const archived = fileURLToPath(new URL('../results/hr2-host-v2/', import.meta.url));
const fixtureDir = fileURLToPath(new URL('../fixtures/', import.meta.url));

async function command(workspace, executable, args, outputName) {
  const out = await open(join(workspace.path, outputName), 'w'), err = await open(join(workspace.path, `${outputName}.stderr`), 'w');
  try {
    const child = spawn(executable, args, { stdio: ['ignore', out.fd, err.fd] });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, `${executable} exit ${code}: ${await readFile(join(workspace.path, `${outputName}.stderr`), 'utf8')}`);
  } finally { await out.close(); await err.close(); }
}

function withoutScorer(cell) {
  const copy = structuredClone(cell);
  delete copy.run.implementation.scorer;
  return JSON.stringify(copy);
}

test('host-v2 archives: 120/120 re-scored cells are byte-identical; report statistics and outcome are exact', async t => {
  for (const name of ['cells.tar.xz', 'scores.json.xz', 'report.json.xz']) {
    try { await access(join(archived, name)); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      t.skip(`host-v2 regression archives absent: ${name}`); return;
    }
  }
  const workspace = createTestWorkspace(t, { prefix: 'hr2-host-v2-regression-' });
  await command(workspace, 'tar', ['-xJf', join(archived, 'cells.tar.xz'), '-C', workspace.path], 'extract.log');
  await command(workspace, 'xz', ['-dc', join(archived, 'scores.json.xz')], 'archived-scores.json');
  await command(workspace, 'xz', ['-dc', join(archived, 'report.json.xz')], 'archived-report.json');
  const original = JSON.parse(await readFile(join(workspace.path, 'archived-scores.json'), 'utf8'));
  const expectedReport = JSON.parse(await readFile(join(workspace.path, 'archived-report.json'), 'utf8'));
  const authenticated = await authenticateFixture(fixtureDir), fixture = await loadFixture(fixtureDir);
  assert.deepEqual(fixture.hashes, authenticated.hashes);
  const names = (await readdir(join(workspace.path, 'cells'))).filter(name => name.endsWith('.json')).sort(compareIds);
  assert.equal(names.length, 120); assert.equal(original.cells.length, 120);
  const cells = [];
  for (const [index, name] of names.entries()) {
    const raw = JSON.parse(await readFile(join(workspace.path, 'cells', name), 'utf8'));
    const scored = scoreCell(fixture, raw);
    assert.equal(withoutScorer(scored), withoutScorer(original.cells[index]), name);
    cells.push(scored);
    if (cells.length % 60 === 0) console.log(`host-v2 replay progress: ${cells.length}/120 byte-identical cells`);
  }
  await writeFile(join(workspace.path, 'rescored.json'), JSON.stringify({ format: 'hr2-scores-v1', ok: true, cells }));
  // Use archived scores as input; capture this report stage's real identity.
  console.log('host-v2 report: regenerating frozen statistics from archived scores');
  const report = buildReport(original);
  assert.equal(report.ok, true);
  const { implementation, ...actualContent } = report;
  const { implementation: archivedImplementation, ...expectedContent } = expectedReport;
  assert.equal(JSON.stringify(actualContent), JSON.stringify(expectedContent));
  const identities = { scorer: cells[0].run.implementation.scorer, report: implementation.report };
  await writeFile(join(workspace.path, 'current-stage-identities.json'), JSON.stringify(identities));
  assert.notDeepEqual(identities.scorer, original.cells[0].run.implementation.scorer);
  assert.notDeepEqual(implementation, archivedImplementation);
  t.diagnostic(`120/120 byte-identical after stripping only run.implementation.scorer; host-v2 report statistics and exploratory outcome exactly equal. Current stage identities: ${JSON.stringify(identities)}`);
});
