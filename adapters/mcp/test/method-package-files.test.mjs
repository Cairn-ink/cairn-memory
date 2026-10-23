import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdirSync,writeFileSync,symlinkSync,linkSync,renameSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {prepareMethodFiles,methodEntryName,methodExclude,methodMountId,assertMethodMount,METHOD_IMPORT_LIMITS} from '../method-package-files.mjs';

function fixture(t){const workspace=createTestWorkspace(t,{prefix:'method-import-files-'}),root=join(workspace.path,'package');mkdirSync(root);return {workspace,root};}
test('H02 descriptor reads preserve UTF-8 BOM, exact formatting and deterministic paths; exclusions prune unopened entries',t=>{
  const {root}=fixture(t);writeFileSync(join(root,'SKILL.md'),'\ufeffSynthetic\r\n');writeFileSync(join(root,'a.txt'),' first\t');
  symlinkSync('/definitely-unreadable',join(root,'.git'));symlinkSync('/definitely-unreadable',join(root,'assets'));
  const prepared=prepareMethodFiles(root,['assets/**']);t.after(()=>prepared.close());
  assert.deepEqual(prepared.files.map(file=>file.path),['SKILL.md','a.txt']);
  assert.equal(prepared.files[0].text,'\ufeffSynthetic\r\n');assert.deepEqual(prepared.pruned,['.git','assets']);prepared.validate();
  for(const [pattern,yes,no] of [['**/*.png','a/b.png','a/b.txt'],['assets/**','assets','x/assets'],['a?/[!x].txt','a1/b.txt','a1/x.txt']]){
    assert.equal(methodExclude(pattern)(yes),true);assert.equal(methodExclude(pattern)(no),false);
  }
});
test('H02 explicit component rejection and mount metadata comparison refuse malformed or distinct mount IDs',()=>{
  for(const name of ['', '.', '..','a/b','a\0b'])assert.throws(()=>methodEntryName(name));
  assert.equal(methodEntryName('%2e%2e'),'%2e%2e');
  for(const text of ['', 'mnt_id: x\n','mnt_id: 0\n','mnt_id:\n1\n','mnt_id: 1\nmnt_id: 2\n','mnt_id: 1\nmnt_id: malformed\n'])assert.throws(()=>methodMountId(text));
  assert.equal(methodMountId('pos: 0\nmnt_id:\t123\n'),123n);assert.throws(()=>assertMethodMount(123n,124n));assertMethodMount(123n,123n);
});
test('H02 empty subtrees release unreferenced directory descriptors while file parents remain pinned',t=>{
  const {root}=fixture(t);writeFileSync(join(root,'SKILL.md'),'synthetic');
  for(let i=0;i<400;i++)mkdirSync(join(root,'empty-'+i));
  const before=readdirSync('/proc/self/fd').length,prepared=prepareMethodFiles(root);t.after(()=>prepared.close());
  assert.ok(readdirSync('/proc/self/fd').length-before<=4);prepared.validate();assert.equal(prepared.files.length,1);
});
for(const kind of ['symlink','hardlink','fifo','invalid-utf8','binary','oversize'])test('H02 refuses '+kind+' without an import or blocking data open',t=>{
  const {workspace,root}=fixture(t),path=join(root,'SKILL.md');
  if(kind==='symlink')symlinkSync('/etc/passwd',path);
  else if(kind==='hardlink'){writeFileSync(join(workspace.path,'outside'),'outside');linkSync(join(workspace.path,'outside'),path);}
  else if(kind==='fifo'){const child=spawnSync('/usr/bin/mkfifo',[path],{stdio:'ignore'});assert.equal(child.error,undefined);assert.equal(child.status,0);}
  else if(kind==='invalid-utf8')writeFileSync(path,Buffer.from([0xff,0xfe]));
  else if(kind==='binary')writeFileSync(join(root,'image.png'),'synthetic');
  else writeFileSync(path,'x'.repeat(METHOD_IMPORT_LIMITS.rawFileBytes+1));
  const start=performance.now();assert.throws(()=>prepareMethodFiles(root));assert.ok(performance.now()-start<2000);
});
for(const kind of ['entry-swap','in-place','link-count'])test('H03 post-review validation refuses '+kind+' without changing frozen bytes',t=>{
  const {workspace,root}=fixture(t),path=join(root,'SKILL.md');writeFileSync(path,'frozen');
  const prepared=prepareMethodFiles(root);t.after(()=>prepared.close());
  if(kind==='entry-swap'){renameSync(path,path+'.old');writeFileSync(path,'replacement');}
  else if(kind==='in-place')writeFileSync(path,'changed');
  else linkSync(path,join(workspace.path,'extra-link'));
  assert.equal(prepared.files[0].text,'frozen');assert.throws(()=>prepared.validate());
});
test('H03 bounded change channel freezes data and refuses later replacement',t=>{
  const {workspace,root}=fixture(t);writeFileSync(join(root,'SKILL.md'),'frozen');
  const path=join(workspace.path,'change.json');writeFileSync(path,'{"items":[]}');
  const prepared=prepareMethodFiles(root);t.after(()=>prepared.close());assert.deepEqual(prepared.change(path),{items:[]});
  renameSync(path,path+'.old');writeFileSync(path,'{"items":["replacement"]}');assert.throws(()=>prepared.validate());
});
test('H02 pinned directory capabilities survive an ancestor relocation without redirecting to a replacement',t=>{
  const {workspace,root}=fixture(t);mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','SKILL.md'),'original');
  const prepared=prepareMethodFiles(root);t.after(()=>prepared.close());
  renameSync(join(root,'nested'),join(workspace.path,'relocated'));mkdirSync(join(root,'nested'));writeFileSync(join(root,'nested','SKILL.md'),'replacement');
  prepared.validate();assert.equal(prepared.files[0].text,'original');
});
