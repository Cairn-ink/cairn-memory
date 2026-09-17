import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed artifact exports pure source-context preparation and exact compilation',
  { timeout: 60_000 }, () => {
    const artifact = buildArtifact();
    const directory = mkdtempSync(join(tmpdir(), 'cairn-installed-context-units-'));
    writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-context-units',
      private: true, version: '0.0.0' }), { flag: 'wx' });
    command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts',
      '--no-audit', '--no-fund', artifact.artifactPath], directory, artifact.userconfig);
    // Only the installed package is imported. A checkout import cannot mask a missing archive file.
    const probe = `import assert from 'node:assert/strict';
      import { prepareSourceContextUnits, compileSourceContextUnits }
        from './node_modules/${packageName}/core/index.mjs';
      const raw = { sources: [{ receipts: [{ role: 'user',
        excerpt: ' ' + 'a'.repeat(198) + '🚚' + 'The board adopted A.' }] }] };
      const prepared = prepareSourceContextUnits(raw);
      assert.deepEqual(prepared.input.sources[0].receipts[0].passages.map(p => p.index), [0,1]);
      assert.equal(prepared.input.sources[0].receipts[0].passages[1].text.startsWith('🚚'), true);
      const field=(value,evidence=[])=>({value,evidence});
      const proposal={units:[{source:0,receipt:0,kind:'decision_state',
        subject:field('board',[1]),property:field('adopted',[1]),scope:field(null),
        applies:field(null),value:field('A',[1]),attribution:field('direct',[1]),
        polarity:field('affirmed',[1]),quantifier:field('existential',[1]),
        eventTimeContext:[0],reporterContext:[1],state:field('adopted',[1])}]};
      const result=compileSourceContextUnits(raw,proposal);
      assert.deepEqual(result.units[0].focus.map(p=>[p.passage,p.start,p.end]),
        [[0,0,199],[1,199,221]]);
      assert.equal(result.units[0].focus[1].text,'🚚The board adopted A.');
      assert.equal(result.units[0].qualification.anchors[0].text,'🚚The board adopted A.');
      assert.equal(result.units[0].eventTimeContext.anchors[0].text,' ' + 'a'.repeat(198));
      assert.equal(result.units[0].qualification.commitment,'adopted');
      assert.equal(result.units[0].interpretationStatus,'model-proposed-unverified');
      console.log('installed_source_context_units_passed');`;
    assert.equal(command(process.execPath, ['--input-type=module', '-e', probe], directory,
      artifact.userconfig).trim(), 'installed_source_context_units_passed');
  });
