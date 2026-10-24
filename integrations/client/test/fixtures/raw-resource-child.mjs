import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { join, basename } from 'node:path';
import { createTestWorkspace } from '../../../../tools/testing/workspace.mjs';

const mode = process.argv[2], original = { ...fs }, workspace = createTestWorkspace(null,{ prefix:'raw-resource-child-' });
const files = new Map(), handles = new Set(); let injected = false, foreign, maxFiles = 0, maxBytes = 0, maxWrite = 0, maxScratchRead = 0, maxSourceRead = 0, scratchReadBytes = 0, planningReadBytes = 0;
let source, prepared, errorCode = null;
function metrics() {
  maxFiles = Math.max(maxFiles,files.size);
  maxBytes = Math.max(maxBytes,[...files.values()].reduce((sum,file) => sum+file.size,0));
}
try {
  const path = join(workspace.path,'source.jsonl'), prefixUnits = mode==='heap' ? 32*1024*1024:24000;
  const tail = mode==='heap' ? '_api_key='+'v'.repeat(128):'';
  const targetUnits = prefixUnits+(mode==='heap' ? '_api_key=[REDACTED]'.length:0);
  const writer = await original.open(path,'wx',0o600);
  try {
    await writer.write('{"type":"user","uuid":"synthetic-message","promptSource":"typed","message":{"content":"');
    const chunk = (mode==='heap' ? 'a':'x').repeat(16384);
    for (let at=0;at<prefixUnits;at+=chunk.length) await writer.write(chunk.slice(0,Math.min(chunk.length,prefixUnits-at)));
    await writer.write(tail);
    await writer.write('"}}\n');
  } finally { await writer.close(); }
  const end = (await original.stat(path)).size;
  source = await original.open(path,'r');
  workspace.defer(() => source.close());
  fs.open = async (path,...args) => {
    if (mode==='directory-open' && !injected && String(path).includes('/cairn-raw-prepare-') && !/\/stage-\d+$/.test(String(path))) {
      injected = true; throw Error('Synthetic private open failure');
    }
    const handle = await original.open(path,...args);
    if (!String(path).includes('/cairn-raw-prepare-')) return handle;
    handles.add(handle);
    const directory = !/\/stage-\d+$/.test(String(path));
    const close = handle.close.bind(handle), stat = handle.stat.bind(handle), read = handle.read.bind(handle), write = handle.write.bind(handle);
    handle.close = async () => { const result = await close(); handles.delete(handle); return result; };
    handle.stat = async (...args) => {
      if (!injected && (mode==='file-stat' && !directory || mode==='directory-stat' && directory)) {
        injected = true; throw Error('Synthetic private stat failure');
      }
      return stat(...args);
    };
    if (!directory) {
      const record = { size:0 }; files.set(String(path),record); metrics();
      handle.read = async (buffer,offset,length,position) => {
        maxScratchRead = Math.max(maxScratchRead,length); const result = await read(buffer,offset,length,position); scratchReadBytes += result.bytesRead; return result;
      };
      handle.write = async (buffer,offset,length,position) => {
        maxWrite = Math.max(maxWrite,length);
        if (mode==='scratch-write' && !injected) { injected = true; throw Error('Synthetic private write failure'); }
        const result = await write(buffer,offset,length,position); record.size = Math.max(record.size,position+result.bytesWritten); metrics(); return result;
      };
    }
    return handle;
  };
  fs.mkdtemp = async (...args) => {
    if (mode==='mkdtemp' && !injected) { injected = true; throw Error('Synthetic private mkdir failure'); }
    return original.mkdtemp(...args);
  };
  fs.unlink = async path => { const result = await original.unlink(path); files.delete(String(path)); return result; };
  fs.lstat = async (...args) => {
    if (mode==='directory-lstat' && !injected && String(args[0]).includes('/cairn-raw-prepare-')) {
      injected = true; throw Error('Synthetic private lstat failure');
    }
    return original.lstat(...args);
  };
  syncBuiltinESMExports();
  const { prepareRawRecord,planRawBatch } = await import('../../raw/index.mjs');
  const controller = new AbortController();
  const input = { source:{ async read(buffer,offset,length,position) {
    maxSourceRead = Math.max(maxSourceRead,length);
    if (mode==='source-read' && !injected) { injected = true; throw Error('Synthetic source read failure'); }
    if (mode==='cancel' && !injected) { injected = true; controller.abort(); }
    if (mode==='foreign' && !injected) {
      injected = true; foreign = [...files.keys()][0];
      await original.unlink(foreign); await original.writeFile(foreign,'synthetic foreign replacement',{ mode:0o600,flag:'wx' });
    }
    return source.read(buffer,offset,length,position);
  } },range:{ start:0,end },client:'claude-code',sessionId:'synthetic-session',wireSessionId:'synthetic-wire',generation:'initial',epoch:0,messageOrdinal:1,
    selectionState:{ ownSkillTurn:false,pluginRoot:'/synthetic/plugin' },formatAuthority:null };
  try {
    const result = await prepareRawRecord(input,{ identityKey:Buffer.alloc(32,0x71),signal:controller.signal,
      limits:{ bufferBytes:mode==='heap' ? 16384:7,...(mode==='scratch-cap' ? { scratchByteLimit:16 }:{}),...(mode==='heap' ? { deadlineMs:300000 }:{}) } });
    prepared = result.message;
    workspace.defer(() => prepared.close());
    assert.equal(prepared.metadata.totalUnits,targetUnits);
    if (mode==='heap') {
      assert.equal(prepared.metadata.totalBytes,targetUnits);
      assert.equal((await prepared.readPart({ start:prefixUnits,maxUnits:4000 })).text,'_api_key=[REDACTED]');
    }
    const before = scratchReadBytes;
    let position = { index:0,start:0 }, batches = 0;
    while (position) {
      const batch = await planRawBatch({ message:prepared,projectId:null,position }); position = batch.nextPosition; batches++;
      if (mode==='heap' && batches===3) break;
    }
    planningReadBytes = scratchReadBytes-before;
    await prepared.close();
  } catch (error) { errorCode = error.code; assert.equal(error.message,error.code); }
  const expected = { mkdtemp:'raw_source_unavailable','directory-open':'raw_source_unavailable','file-stat':'raw_source_unavailable','directory-stat':'raw_source_unavailable','directory-lstat':'raw_source_unavailable',
    'scratch-write':'raw_source_unavailable','source-read':'raw_source_unavailable','scratch-cap':'raw_source_resource_limit',cancel:'raw_source_cancelled',foreign:'raw_source_unavailable' }[mode] ?? null;
  assert.equal(errorCode,expected);
  assert.ok(maxSourceRead>0 || ['file-stat','directory-stat','directory-lstat','directory-open','mkdtemp'].includes(mode));
  assert.ok(maxSourceRead<= (mode==='heap' ? 16384:7));
  assert.ok(maxScratchRead<=16384 && maxWrite<=16384);
  assert.ok(maxFiles<=2); assert.equal(handles.size,0);
  if (foreign) {
    assert.equal(await original.readFile(foreign,'utf8'),'synthetic foreign replacement');
    // Only this fixture removes its own known replacement after asserting that
    // production cleanup refused it. Runtime cleanup never adopts that inode.
    await original.unlink(foreign); await original.rmdir(join(foreign,'..')); files.delete(foreign);
  }
  const residue = (await original.readdir(process.env.TMPDIR)).filter(name => name!==basename(workspace.path));
  assert.deepEqual(residue,[]);
  console.log(JSON.stringify({ mode,errorCode,targetUnits,maxSourceRead,maxScratchRead,maxWrite,maxFiles,maxBytes,planningReadBytes,openHandles:handles.size,residue,
    heapUsed:process.memoryUsage().heapUsed,heapLimitMiB:mode==='heap' ? 32:null }));
} finally {
  Object.assign(fs,original); syncBuiltinESMExports();
  await workspace.cleanup();
}
