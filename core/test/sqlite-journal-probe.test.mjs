import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { createExclusiveSqliteFile } from '../sqlite-journal-probe.mjs';
import { initLocalRawStore } from '../../integrations/client/raw/local-setup-init.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

for (const fault of ['fsync', 'timeout']) test(`staged creation ${fault} failure leaves retryable target; dead stages are recovered`, async t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'new.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    if (args[2]?.includes('fsyncSync(fd)')) {
      args = [...args];
      args[2] = args[2].replace('fsyncSync(fd);', fault === 'fsync'
        ? "(() => { throw Object.assign(new Error('fsync injected'), { code: 'EIO' }); })();"
        : 'Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);');
      if (fault === 'timeout') options = { ...options, timeout: 500 };
    }
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => createExclusiveSqliteFile(path), fault === 'fsync' ? { code: 'EIO', published: false } : /sqlite_file_creation_failed/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(fs.existsSync(path), false);
  const stages = fs.readdirSync(workspace.path);
  assert.equal(stages.length, fault === 'timeout' ? 1 : 0);
  assert.equal((await initLocalRawStore({ databasePath: path })).status, 'initialized');
  assert.deepEqual(fs.readdirSync(workspace.path), ['new.sqlite']);
  assert.equal(fs.statSync(path).mode & 0o777, 0o600);
  const before = fs.readFileSync(path), inode = fs.statSync(path).ino;
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false });
  assert.equal(fs.statSync(path).ino, inode); assert.deepEqual(fs.readFileSync(path), before);
  assert.deepEqual(fs.readdirSync(workspace.path), ['new.sqlite']);
});

test('publication is no-replace even if another creator wins between stage fsync and link', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'winner.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    args = [...args]; args[2] = args[2].replace('linkSync(temporary, target);',
      "const winner = openSync(target, 'wx', 0o600); closeSync(winner); linkSync(temporary, target);");
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false }); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  assert.equal(fs.statSync(path).size, 0);
  assert.deepEqual(fs.readdirSync(workspace.path), ['winner.sqlite']);
});

test('win32 creation skips directory open/fsync and preserves live stages', t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'windows.sqlite');
  const liveStage = '.windows.sqlite.cairn-create-' + process.pid + '-00000000-0000-0000-0000-000000000000';
  fs.writeFileSync(join(workspace.path, liveStage), 'live');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    args = [...args];
    assert.ok(args[2].includes("dir = openSync(directory, 'r'); fsyncSync(dir);"));
    args[2] = "Object.defineProperty(process, 'platform', { value: 'win32' });\n" + args[2].replace(
      "dir = openSync(directory, 'r'); fsyncSync(dir);",
      "throw Object.assign(new Error('directory must not open on Windows'), { code: 'EIO' });");
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  let identity;
  try { identity = createExclusiveSqliteFile(path); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  const stat = fs.statSync(path);
  assert.deepEqual(identity, { dev: stat.dev, ino: stat.ino });
  assert.equal(stat.size, 0);
  assert.deepEqual(fs.readdirSync(workspace.path).sort(), [liveStage, 'windows.sqlite'].sort());
  assert.equal(fs.readFileSync(join(workspace.path, liveStage), 'utf8'), 'live');
});

for (const boundary of ['open', 'fsync']) for (const code of ['EISDIR', 'EPERM', 'EINVAL', 'ENOTSUP'])
test(`POSIX directory ${boundary} ${code} after publication returns the published identity`, t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'published.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    args = [...args];
    const operation = boundary === 'open' ? "dir = openSync(directory, 'r');" : 'fsyncSync(dir);';
    assert.ok(args[2].includes(operation));
    args[2] = "Object.defineProperty(process, 'platform', { value: 'linux' });\n" + args[2].replace(operation,
      `throw Object.assign(new Error('directory sync injected'), { code: '${code}' });`);
    return original(command, args, options);
  };
  syncBuiltinESMExports();
  let identity;
  try { identity = createExclusiveSqliteFile(path); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  const stat = fs.statSync(path);
  assert.deepEqual(identity, { dev: stat.dev, ino: stat.ino });
  assert.equal(stat.size, 0);
  assert.deepEqual(fs.readdirSync(workspace.path), ['published.sqlite']);
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false });
});

for (const fault of ['directory-fsync', 'post-link-timeout']) test(`${fault}: interrupted publication retains target and never replaces it`, t => {
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'published.sqlite');
  const original = childProcess.spawnSync;
  childProcess.spawnSync = (command, args, options) => {
    args = [...args];
    args[2] = fault === 'directory-fsync'
      ? args[2].replace('fsyncSync(dir);', "(() => { throw Object.assign(new Error('directory fsync'), { code: 'EIO' }); })();")
      : args[2].replace('published = true;', 'published = true; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);');
    return original(command, args, fault === 'post-link-timeout' ? { ...options, timeout: 500 } : options);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => createExclusiveSqliteFile(path), fault === 'directory-fsync' ? { code: 'EIO', published: true } : /sqlite_file_creation_failed/); }
  finally { childProcess.spawnSync = original; syncBuiltinESMExports(); }
  const before = fs.statSync(path);
  assert.equal(before.size, 0);
  assert.throws(() => createExclusiveSqliteFile(path), { code: 'EEXIST', published: false });
  assert.equal(fs.statSync(path).ino, before.ino);
  assert.deepEqual(fs.readdirSync(workspace.path), ['published.sqlite']);
});

for (const code of [5, 261, 6, 7, 10]) test(`Fix round 4 legacy probe SQLite ${code} retains its original result and refusal`, async t => {
  const { DatabaseSync } = await import('node:sqlite');
  const { probeRollbackJournal } = await import('../sqlite-journal-probe.mjs');
  const { assertContextReadCanonicalDelete } = await import('../context-read-sidecar.mjs');
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'legacy.sqlite');
  createExclusiveSqliteFile(path);
  const db = new DatabaseSync(path); db.exec('CREATE TABLE synthetic(id INTEGER)'); db.close();
  const spawn = childProcess.spawnSync;
  t.mock.method(childProcess, 'spawnSync', (command, args, options) => {
    args = [...args];
    args[2] = args[2].replace("db.prepare('PRAGMA journal_mode').get().journal_mode",
      `(() => { throw Object.assign(Error('synthetic'), { errcode: ${code} }); })()`);
    return spawn(command, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  assert.deepEqual(probeRollbackJournal(path), { stage: 'query', code: code & 255 });
  assert.throws(() => assertContextReadCanonicalDelete(path), { code: 'index_unavailable', reason: 'unsafe_file' });
});

for(const fault of ['stale-identity','stage-fsync','competing-selection'])test('Fix1 cache replacement '+fault+' preserves the incumbent until atomic publication',t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'repair.context-read-product-v1.1.sqlite');
  createExclusiveSqliteFile(path);const before=fs.statSync(path),expected=before.dev+':'+before.ino;
  const spawn=childProcess.spawnSync;
  t.mock.method(childProcess,'spawnSync',(command,args,options)=>{
    args=[...args];
    if(fault==='stale-identity')args[2]=`import {writeFileSync,renameSync as replaceWinner} from 'node:fs';
      writeFileSync(process.argv[1]+'.winner','newer certificate',{mode:0o600});replaceWinner(process.argv[1]+'.winner',process.argv[1]);\n`+args[2];
    if(fault==='stage-fsync')args[2]=args[2].replace('fsyncSync(fd);',"throw Object.assign(Error('stage fault'),{code:'EIO'});");
    if(fault==='competing-selection')args[2]=args[2].replace('fsyncSync(fd);',`fsyncSync(fd);
      const {spawnSync}=await import('node:child_process');
      const competitor=spawnSync(process.execPath,['--input-type=module','-e',
        ${JSON.stringify("import {createExclusiveSqliteFile} from '"+new URL('../sqlite-journal-probe.mjs',import.meta.url).href+"';try{createExclusiveSqliteFile(process.argv[1],process.argv[2]);process.exit(9);}catch(e){if(e.code!=='EEXIST')process.exit(8);}")},target,process.argv[3]],{encoding:'utf8',env:{}});
      if(competitor.status!==0)throw Object.assign(Error('repair not coordinated'),{code:'EIO'});
      const incumbent=(await import('node:fs')).lstatSync(target);
      if(incumbent.dev+':'+incumbent.ino!==process.argv[3])throw Error('target disappeared before publish');`);
    return spawn(command,args,options);
  });syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  if(fault==='competing-selection'){
    const successor=createExclusiveSqliteFile(path,expected);assert.notEqual(successor.ino,before.ino);
    assert.deepEqual(fs.readdirSync(workspace.path),['repair.context-read-product-v1.1.sqlite']);
  }else{
    assert.throws(()=>createExclusiveSqliteFile(path,expected),{code:fault==='stage-fsync'?'EIO':'ESTALE',published:false});
    assert.equal(fs.existsSync(path),true);
    if(fault==='stage-fsync')assert.equal(fs.statSync(path).ino,before.ino);
    else assert.notEqual(fs.statSync(path).ino,before.ino);
  }
});
