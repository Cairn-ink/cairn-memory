import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { buildArtifact,command } from '../build.mjs';
import { safetyFixture,copySqliteFixture,quiescence,ns,ok } from '../../core/testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../../core/testing/card-lineage-fixture.mjs';

test('packaged lineage supports trusted service operations and authenticated terminal review across restart',async t=>{
  const f=safetyFixture(t,23),artifact=buildArtifact();
  command('tar',['-xzf',artifact.artifactPath,'-C',f.workspace.path],f.workspace.path,artifact.userconfig);
  const installed=join(f.workspace.path,'package');
  const required=['core/card-lineage.mjs','core/card-lineage-schema.mjs','core/card-lineage-base-schema.mjs',
    'adapters/mcp/private-card-access.mjs','adapters/mcp/review-card.mjs'];
  for(const file of required)assert.equal(createHash('sha256').update(readFileSync(join(installed,file))).digest('hex'),artifact.sourceHashes[file]);
  const load=file=>import(pathToFileURL(join(installed,file)));
  const {openMemoryCore}=await load('core/index.mjs'),{migrateCardLineage}=await load('core/content-safety-migration.mjs');
  const {createScopedCardAccess}=await load('adapters/mcp/private-card-access.mjs');
  copySqliteFixture(f.path,f.backupPath);
  await migrateCardLineage({path:f.path,backupPath:f.backupPath,expected:{base:23,storeId:f.storeId},quiescence});
  const trusted=lineageHost(),human=openMemoryCore({path:f.path,privateCards:trusted.options});
  const source=ok(trusted.call(human,'submitSourceNote',{actionId:'packaged-note',text:'Synthetic packaged source',occurredAt:null})).source;
  human.close();
  const service=createScopedCardAccess(ns,{actorId:'synthetic-service'}),core=openMemoryCore({path:f.path,privateCards:service.configuration});
  let card;
  try {
    card=ok(service.call(core,'createCardDraft',{actionId:'packaged-draft',drafting:'authored',input:{title:'Synthetic packaged title',body:'Synthetic packaged body',sources:[source]}}));
    assert.equal(service.call(core,'confirmCardDraft',{actionId:'no-service-confirm',cardId:card.id,expectedRevision:card.revision}).error.code,'authority_required');
  } finally {core.close();}
  const script=`import {reviewCard} from ${JSON.stringify(pathToFileURL(join(installed,'adapters/mcp/review-card.mjs')).href)}; reviewCard(process.argv.slice(1));`;
  const supervisor=fileURLToPath(new URL('../../adapters/mcp/test/fixtures/card-review-pty.py',import.meta.url));
  const child=spawn('/usr/bin/python3',[supervisor,process.execPath,'--input-type=module','-e',script,'--',
    '--db',f.path,'--owner',ns.ownerId,'--project',ns.projectId,'--card',card.id,'--revision',String(card.revision)],{stdio:'pipe'});
  const lines=createInterface({input:child.stdout});let completed,stderr='',prompted=false;
  child.stderr.on('data',chunk=>{stderr+=chunk;});
  const timeout=setTimeout(()=>child.kill('SIGTERM'),30000);
  try {
    await new Promise((resolve,reject)=>{
      lines.on('line',line=>{try {
        const event=JSON.parse(line);
        if(event.event==='prompt') {prompted=true;assert.match(event.output,/Synthetic packaged body/);child.stdin.write(JSON.stringify({answer:`CONFIRM ${card.id} ${card.revision}`})+'\n');}
        if(event.event==='done')completed=event;
      }catch(error){reject(error);}});
      child.once('error',reject);child.once('close',(code,signal)=>{try{assert.equal(code,0,stderr);assert.equal(signal,null);resolve();}catch(error){reject(error);}});
    });
    assert.equal(prompted,true);assert.equal(completed.code,0,completed.output);
  } finally {clearTimeout(timeout);lines.close();if(child.exitCode===null)child.kill('SIGTERM');}
  const reopened=openMemoryCore({path:f.path,privateCards:trusted.options});
  try {assert.equal(ok(trusted.call(reopened,'getCard',{cardId:card.id})).card.state,'confirmed');}
  finally {reopened.close();}
  const db=f.connect();
  try {
    assert.equal(db.prepare("SELECT actor_id FROM card_body_authorizations WHERE host_action_id='packaged-draft'").get().actor_id,'synthetic-service');
    const review=db.prepare("SELECT actor_id,authorized_at FROM card_body_authorizations WHERE method='confirmCardDraft'").get();
    assert.match(review.actor_id,/^local-user:\d+$/);assert.equal(new Date(review.authorized_at).toISOString(),review.authorized_at);
  } finally {db.close();}
  t.diagnostic(`verified ${required.length} installed module hashes; service operation and terminal human audit survived restart`);
});
