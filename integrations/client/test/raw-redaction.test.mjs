import assert from 'node:assert/strict';
import test from 'node:test';
import { redactSecrets } from '../redact.mjs';
import { prepareRawRecord } from '../raw/index.mjs';
import { recordFixture,claude,key } from './fixtures/raw-fixtures.mjs';

const token = 'a'.repeat(24);
const cases = [
  '  Synthetic 🙂\r\nＢ  ',
  '-----BEGIN RSA PRIVATE KEY-----x-----END EC PRIVATE KEY-----',
  '-----BEGIN PRIVATE KEY-----missing',
  '-----BEGIN '+ 'A'.repeat(100000)+' PRIVATE KEY-----x-----END PRIVATE KEY-----',
  'sk-'+token+'---- rk-'+token+'_ pk-'+token+'---tail',
  'CRN_PAT_'+'a'.repeat(40)+' crn_pat_'+'a'.repeat(40)+'_suffix',
  'ghp_'+token+' github_pat_'+token,
  'AKIA'+'A'.repeat(16)+' AKIA'+'A'.repeat(17),
  'eyJ'+token+'.'+token+'.'+token+'----',
  'eyJ'+token+'.eyJ'+token+'.'+token+'.'+token,
  'Bearer abcdefghijk-===_suffix Bearer abcdefghijk-===x Bearer abcdefghijk-===é',
  'Bearer /Bearer abcdefghijkl Bearer x/Bearer abcdefghijkl Bearer short/Bearer abcdefghijkl',
  'Bearer\u2028abcdefghijklmnop Bearer\u0085abcdefghijklmnop',
  'api_key="'+token+"' password='"+token+'"',
  'password=🙂🙂🙂🙂 password=🙂🙂🙂',
  'password=api_key = abcdefghijklmnop',
  'a'.repeat(100000)+'_api_key\t : \n"'+token+'"',
  'api_key=abc_api_key='+token+' password=sk-'+token+' api_key=Bearer '+token,
  '[REDACTED] api_key=[REDACTED]',
];
for (const bufferBytes of [7,16384]) test(`all ordered native redaction stages agree with ${bufferBytes}-byte reads`,async t => {
  for (const text of cases) {
    const f = await recordFixture(t,'claude-code',claude(text));
    const result = await prepareRawRecord(f.input,{ identityKey:key,limits:{ bufferBytes } });
    try {
      let actual = '';
      for (let start=0;start<result.message.metadata.totalUnits;) {
        const part = await result.message.readPart({ start,maxUnits:4000 }); actual += part.text; start = part.end;
      }
      assert.equal(actual,redactSecrets(text));
    } finally { await result.message.close(); }
  }
});

test('seeded combinations agree with the independent ordered native regex oracle',async t => {
  let seed = 0x671ea532;
  const random = size => { seed ^= seed<<13; seed ^= seed>>>17; seed ^= seed<<5; return (seed>>>0)%size; };
  const pieces = ['a','_','-','.','/','=',':','"',"'",' ','\t','\n','🙂','é','sk-','rk-','pk-','crn_pat_','ghp_','github_pat_',
    'AKIA','eyJ','Bearer ','api_key=','password:','access_token = ','[REDACTED]','-----BEGIN PRIVATE KEY-----',
    '-----END EC PRIVATE KEY-----','a'.repeat(16),'b'.repeat(20),'1'.repeat(32)];
  for (let index=0;index<500;index++) {
    let text = '';
    for (let count=1+random(32);count>0;count--) text += pieces[random(pieces.length)];
    const f = await recordFixture(t,'claude-code',claude(text)); let prepared;
    try {
      prepared = await prepareRawRecord(f.input,{ identityKey:key,limits:{ bufferBytes:index%2 ? 3:16384 } });
      const actual = await prepared.message.readPart({ start:0,maxUnits:4000 });
      assert.equal(actual.text,redactSecrets(text),'seeded case '+index);
    } finally { await prepared?.message.close(); await f.workspace.cleanup(); }
  }
});
