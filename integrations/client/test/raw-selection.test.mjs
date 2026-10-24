import assert from 'node:assert/strict';
import test from 'node:test';
import { transcriptWindow } from '../../../plugins/cairn-memory/lib/transcript.mjs';
import { parseLine } from '../../codex/parser.mjs';
import { prepareRawRecord,scanRawRecordRanges } from '../raw/index.mjs';
import { recordFixture,claude,codex,key,pluginRoot,sessionId } from './fixtures/raw-fixtures.mjs';

for (const client of ['claude-code','codex']) {
  test(`${client}: exact block joins preserve Unicode and whitespace`,async t => {
    const row = client==='codex' ? codex(' A🙂 '):claude(' A🙂 ');
    const blocks = client==='codex' ? row.payload.item.content:row.message.content;
    blocks.push({ type:'text',text:'\r\nＢ\t ' });
    const f = await recordFixture(t,client,row), result = await prepareRawRecord(f.input,{ identityKey:key,limits:{ bufferBytes:1 } });
    f.workspace.defer(() => result.message.close());
    assert.deepEqual(await result.message.readPart({ start:0,maxUnits:4000 }),{ start:0,end:client==='codex' ? 10:11,text:client==='codex' ? ' A🙂 \r\nＢ\t ':' A🙂 \n\r\nＢ\t ' });
    assert.equal(f.maxRead,1);
  });
  test(`${client}: late excluded metadata with an oversized text field sends no message`,async t => {
    const row = client==='codex' ? codex('x'.repeat(280000)):claude('x'.repeat(280000));
    if (client==='codex') row.payload.item.content[0].text_elements = [{}]; else row.toolUseResult = null;
    const f = await recordFixture(t,client,row), result = await prepareRawRecord(f.input,{ identityKey:key });
    assert.equal(result.disposition,'excluded'); assert.equal(result.message,undefined);
  });
}

test('Claude native withheld and turn transitions agree on structural/policy cases',async t => {
  const rows = [
    { ...claude('synthetic'),isMeta:true },{ ...claude('synthetic'),isCompactSummary:true },
    { ...claude('synthetic'),toolUseResult:null },{ ...claude(' <system-reminder>synthetic'),promptSource:null },
    claude(' <system-reminder>typed'),
    { type:'assistant',message:{ content:[{ type:'tool_use',name:'Skill',input:{ skill:'cairn-memory:status' } }] } },
    { type:'assistant',message:{ content:'Synthetic withheld answer.' } },claude('New human question.'),
    { type:'assistant',message:{ content:'Cairn automatic memory is paused.' } },
    { type:'assistant',message:{ content:'The command said Cairn automatic memory is paused.\nMy answer.' } },
    { ...claude('Base directory for this skill: '+pluginRoot+'/skills/status'),isMeta:true },
    { type:'assistant',message:{ content:'Synthetic withheld answer.' } },
  ];
  let native = { ownSkillTurn:false }, actual = { ownSkillTurn:false };
  for (const row of rows) {
    const expected = transcriptWindow(JSON.stringify(row),'synthetic',{ turnState:native,pluginRoot });
    const f = await recordFixture(t,'claude-code',row);
    f.input.selectionState = { ...actual,pluginRoot };
    const result = await prepareRawRecord(f.input,{ identityKey:key });
    if (result.message) f.workspace.defer(() => result.message.close());
    assert.equal(result.disposition==='selected',expected.some(value => !value.withheld));
    assert.deepEqual(result.nextSelectionState,{ ownSkillTurn:native.ownSkillTurn }); actual = result.nextSelectionState;
  }
});

test('Codex native structural policy and closed selected objects remain compatible',async t => {
  for (const mutate of [row => { row.payload.item.type='FunctionCallOutput'; },row => { row.type='response_item'; },
    row => { row.payload.item.content.push({ type:'image',path:'/synthetic/ignored' }); },
    row => { row.payload.item.content[0].text_elements=[{}]; }]) {
    const row = codex('Synthetic text.'); mutate(row);
    const expected = parseLine(Buffer.from(JSON.stringify(row)),{ sessionId,wireSessionId:'synthetic-wire-session',epoch:0,start:0,end:1 });
    const f = await recordFixture(t,'codex',row), result = await prepareRawRecord(f.input,{ identityKey:key });
    if (result.message) f.workspace.defer(() => result.message.close());
    assert.equal(result.disposition==='selected',Boolean(expected.message));
  }
});

test('scanner emits one exact complete range and refuses an incomplete tail',async t => {
  const f = await recordFixture(t,'claude-code','{}\n{}\r\n{');
  const ranges = [];
  await assert.rejects(async () => {
    for await (const range of scanRawRecordRanges({ source:f.source,start:0,end:f.input.range.end },{ limits:{ bufferBytes:1 } })) ranges.push(range);
  },{ code:'raw_source_incomplete' });
  assert.deepEqual(ranges,[{ start:0,end:3 },{ start:3,end:7 }]);
});

test('duplicate decisions, malformed Unicode and nesting refuse with finite errors',async t => {
  for (const text of ['{"type":"user","type":"assistant"}\n','{"type":"user","message":{"content":"\\ud800"}}\n',
    '{"type":"user","message":{"content":"\\u0000"}}\n','{"unknown":'+ '['.repeat(65)+'0'+']'.repeat(65)+'}\n']) {
    const f = await recordFixture(t,'claude-code',text);
    await assert.rejects(() => prepareRawRecord(f.input,{ identityKey:key }),error => {
      assert.ok(['raw_source_invalid','raw_source_resource_limit'].includes(error.code)); assert.equal(error.message,error.code); return true;
    });
  }
});
