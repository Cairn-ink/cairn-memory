import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { LOCAL_RAW_PRIVACY_DDL } from '../content-safety-schema.mjs';
import { installLocalRawPrivacy } from '../local-authority-schema.mjs';

test('local installer uses the complete attestor-owned package, including both trigger bodies',()=>{
  let installed;
  installLocalRawPrivacy({exec:sql=>{installed=sql;}});
  assert.equal(installed,LOCAL_RAW_PRIVACY_DDL.join('\n'));
  assert.equal(LOCAL_RAW_PRIVACY_DDL.filter(sql=>sql.startsWith('CREATE TRIGGER')).length,2);
  assert.equal(LOCAL_RAW_PRIVACY_DDL.length,11);assert.equal(Object.isFrozen(LOCAL_RAW_PRIVACY_DDL),true);
});

for(const replacement of ['CREATE VIEW IF NOT EXISTS local_raw_hide_windows','UNSUPPORTED local_raw_hide_windows'])
test(`unsupported local declaration fails at module load with a closed code (${replacement})`,()=>{
  const target=new URL('../content-safety-schema.mjs',import.meta.url).href;
  const loader=`let data;export function initialize(value){data=value;}export async function load(url,context,next){const result=await next(url,context);if(url===data.target)return {...result,source:String(result.source).replace('CREATE TABLE IF NOT EXISTS local_raw_hide_windows',data.replacement)};return result;}`;
  const source=`import{register}from'node:module';import assert from'node:assert/strict';register('data:text/javascript,'+encodeURIComponent(${JSON.stringify(loader)}),{parentURL:import.meta.url,data:{target:${JSON.stringify(target)},replacement:${JSON.stringify(replacement)}}});await assert.rejects(import(${JSON.stringify(target)}),error=>!(error instanceof TypeError)&&error.code==='unsupported_database');`;
  const child=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:10000,env:{NODE_TEST_CONTEXT:'child-v8',NODE_NO_WARNINGS:'1'}});
  assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);
});
