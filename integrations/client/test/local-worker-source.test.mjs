import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { prepareRawRecord, verifyRawRecordSource } from '../raw/index.mjs';
import { recordFixture, key, claude } from './fixtures/raw-fixtures.mjs';

for (const client of ['claude-code','codex']) test(`B4b ${client} excluded record has bounded publication proof without retained text`,async t => {
  const row = client === 'claude-code' ? { type:'progress',data:'synthetic_source_secret' } : { type:'token_usage_record',payload:{} };
  const f = await recordFixture(t,client,row), result = await prepareRawRecord(f.input,{ identityKey:key });
  assert.equal(result.disposition,'excluded'); assert.match(result.sourceIdentity,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(result).includes('synthetic_source_secret'),false);
  assert.equal(await verifyRawRecordSource(f.input,{ identityKey:key },result.sourceIdentity),true);
});
test('B4b selected source verification reuses canonical pre-record selection and refuses in-place mutation',async t => {
  const f = await recordFixture(t,'claude-code',claude('before!')), selected = await prepareRawRecord(f.input,{ identityKey:key });
  f.workspace.defer(() => selected.message.close());
  await assert.rejects(verifyRawRecordSource({ ...f.input,selectionState:{ ...f.input.selectionState,ownSkillTurn:true } },
    { identityKey:key },selected.message.metadata.sourceIdentity),{ code:'raw_source_changed' });
  await writeFile(f.path,JSON.stringify(claude('after!!'))+'\n');
  await assert.rejects(verifyRawRecordSource(f.input,{ identityKey:key },selected.message.metadata.sourceIdentity),{ code:'raw_source_changed' });
});
test('B4b source verifier rejects invalid expected commitment and malformed binding',async t => {
  const f = await recordFixture(t,'claude-code',claude('synthetic'));
  await assert.rejects(verifyRawRecordSource(f.input,{ identityKey:key },'not-a-digest'),{ code:'raw_source_invalid' });
  await assert.rejects(verifyRawRecordSource({ ...f.input,unknown:true },{ identityKey:key },'0'.repeat(64)),{ code:'raw_source_invalid' });
});
