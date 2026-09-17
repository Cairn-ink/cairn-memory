import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';

test('installed qualification imports exact source passage helper and keeps local offsets', { timeout: 60000 }, () => {
  const artifact = buildArtifact();
  const directory = mkdtempSync(join(tmpdir(), 'cairn-installed-passages-'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-passages',
    private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    artifact.artifactPath], directory, artifact.userconfig);

  // This subprocess imports only the installed package; a checkout file cannot
  // mask a missing transitive module in the packed runtime closure.
  const probe = `import assert from 'node:assert/strict';
    import { partitionSourcePassages } from './node_modules/${packageName}/core/source-passages.mjs';
    import { createQualificationCandidateSnapshot, compileQualificationCandidates }
      from './node_modules/${packageName}/core/qualification-candidates.mjs';
    const raw = ' ' + 'Ａ'.repeat(198) + '🚋' + 'e\\u0301' + '同'.repeat(196) + ' ';
    const parts = partitionSourcePassages(raw);
    assert.deepEqual(parts.map(({start,end}) => [start,end]), [[0,199],[199,399],[399,400]]);
    assert.equal(parts.map(({text}) => text).join(''), raw);
    assert.equal(parts[0].text.startsWith(' Ａ'), true);
    assert.equal(parts[2].text, ' ');
    const excerpt = 'a'.repeat(199) + '🚋' + 'b'.repeat(199);
    const snapshot = createQualificationCandidateSnapshot([{ content: 'Synthetic claim', kind: 'fact',
      confidence: 0.8, receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'source',
        role: 'user', excerpt }] }]);
    assert.deepEqual(snapshot.candidates[0].map(({candidateIndex,receiptIndex,start,end,text}) =>
      [candidateIndex,receiptIndex,start,end,text]), [
      [0,0,0,199,'a'.repeat(199)], [1,0,199,399,'🚋'+'b'.repeat(198)], [2,0,399,400,'b']]);
    assert.deepEqual(snapshot.input.items[0].candidates.map(({candidateIndex,text}) =>
      [candidateIndex,text]), [[0,'a'.repeat(199)],[1,'🚋'+'b'.repeat(198)],[2,'b']]);
    const field=(value,evidenceIndices)=>({value,evidenceIndices});
    const compiled=compileQualificationCandidates({qualifications:[{itemIndex:0,
      subject:field(null,[]),property:field(null,[]),scope:field(null,[]),applies:field(null,[]),
      value:field('Known',[1]),attribution:field('unknown',[]),commitment:field('unknown',[])}]},snapshot);
    assert.deepEqual(compiled[0].qualification.anchors,[{receiptIndex:0,start:199,end:399,
      text:'🚋'+'b'.repeat(198),fields:['value']}]);
    console.log('installed_source_passages_passed');`;
  assert.equal(command(process.execPath, ['--input-type=module', '-e', probe], directory, artifact.userconfig).trim(),
    'installed_source_passages_passed');
});
