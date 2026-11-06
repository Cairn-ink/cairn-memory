import { mkdtempSync,mkdirSync,readFileSync,writeFileSync,rmSync,readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join,relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

const root=fileURLToPath(new URL('../',import.meta.url)),scratch=mkdtempSync(join(tmpdir(),'lineage-baseline-'));
const run=(command,args,options={})=>{const r=spawnSync(command,args,{cwd:root,timeout:60000,maxBuffer:64*1024*1024,...options});assert.equal(r.status,0,String(r.stderr));return r.stdout;};
try {
  const revision=String(run('git',['rev-parse','fd5c59ef'])).trim(),base=join(scratch,'baseline');mkdirSync(base,{mode:0o700});
  const paths=String(run('git',['ls-tree','-r','--name-only',revision,'--','core','plugins/cairn-memory/lib'])).trim().split('\n').filter(p=>!/^core\/(test|testing)\//.test(p));
  run('tar',['-xC',base],{input:run('git',['archive',revision,'--',...paths])});
  const actual=[];function walk(path){for(const entry of readdirSync(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isDirectory())walk(next);else actual.push(relative(base,next));}}walk(base);
  assert.deepEqual(actual.sort(),paths.sort(),'Git and extracted filesystem inventories');
  if(process.argv.includes('--wide')) {
    const target=new URL('../core/test/fixtures/card-lineage-off-wide-baseline.json',import.meta.url);
    const fixture=JSON.parse(readFileSync(target,'utf8')),records={};
    const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
    for(const cell of [23,52,33,53])for(const mode of ['open','workload']) {
      const worker=fileURLToPath(new URL('../core/testing/card-lineage-off-wide-worker.mjs',import.meta.url));
      const execute=(source,name)=>JSON.parse(String(run(process.execPath,[worker,source,join(scratch,name+'.sqlite'),mode,String(cell)],{timeout:120000})));
      const old=execute(base,`old-${mode}-${cell}`),current=execute(root,`new-${mode}-${cell}`);
      // Never record a current-tree difference as a new baseline.
      for(const key of ['effectWitnesses','statements','calls','dump'])for(let i=0;i<Math.max(current[key].length,old[key].length);i++)
        assert.equal(JSON.stringify(current[key][i]),JSON.stringify(old[key][i]),`${mode}:${cell} exact ${key}[${i}]`);
      records[mode+':'+cell]={calls:old.calls.map(([method,result,start,end])=>[method,hash(result),start??null,end??null]),
        statements:old.statements.length,sql:hash(old.statements),tables:old.dump.map(([name,rows])=>[name,rows.length,hash(rows)]),
        effectWitnesses:hash(old.effectWitnesses)};
      console.log(JSON.stringify({cell,mode,calls:old.calls.length,statements:old.statements.length,tables:old.dump.length,directBaseline:true}));
    }
    writeFileSync(target,JSON.stringify({...fixture,revision,records},null,2)+'\n');
    console.log(JSON.stringify({revision,node:process.version,sourceFiles:actual.length,cells:Object.keys(records).length}));
  } else {
  const record=JSON.parse(String(run(process.execPath,[fileURLToPath(new URL('../core/testing/card-lineage-off-worker.mjs',import.meta.url)),base,join(scratch,'store.sqlite')])));
  writeFileSync(new URL('../core/test/fixtures/card-lineage-off-baseline.json',import.meta.url),JSON.stringify({revision,node:process.version,record},null,2)+'\n');
  console.log(JSON.stringify({revision,node:process.version,sourceFiles:actual.length,calls:record.calls.length,statements:record.statements.length,tables:record.dump.length}));
  }
} finally {rmSync(scratch,{recursive:true,force:true});}
