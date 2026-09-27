import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { captureEpisodeParity } from '../testing/episode-parity.mjs';
import { migrateVersion14 } from '../episode-schema.mjs';
import { transaction } from '../database.mjs';

const ns={ownerId:'migration',scope:'personal',projectId:null};
const options={sessionEpisodes:{mode:'episode-v1'},captureEvidence:'staged-v1',captureQualification:'source-bound-v2'};
function directory(t) {const dir=mkdtempSync(join(tmpdir(),'se1-migration-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));return dir;}
const frozen = JSON.parse(readFileSync(new URL('../testing/episode-v14-fixture.json', import.meta.url), 'utf8'));
const schemaV14 = readFileSync(new URL('../testing/episode-schema-v14.sql', import.meta.url), 'utf8');
function legacy(t, schema = schemaV14) {
  const path = join(directory(t), 'store.sqlite');
  writeFileSync(path, '', { mode: 0o600 });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON');
  transaction(db, () => {
    db.exec('PRAGMA defer_foreign_keys=ON');
    db.exec(schema);
    for (const [name, rows] of Object.entries(frozen.tables)) {
      for (const row of rows) db.prepare(`INSERT INTO ${name}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
    }
  });
  t.after(() => db.close());
  return { path, db };
}
const oldTables=['admission_claims','staged_capture_evidence','capture_initial_classification'];

test('E11 fresh v15 and current-v14 transactional child-first migration preserve rows/FKs/journal',t=>{
  const fresh=openMemoryCore({path:join(directory(t),'fresh.sqlite'),...options});fresh.close();
  const f=legacy(t),before=oldTables.map(name=>f.db.prepare(`SELECT * FROM ${name}`).all());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,14);
  const core=openMemoryCore({path:f.path,...options});t.after(()=>core.close());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,16);
  for(let i=0;i<oldTables.length;i++) for(const [j,row]of before[i].entries()) {
    const actual=f.db.prepare(`SELECT * FROM ${oldTables[i]}`).all()[j];for(const [key,value]of Object.entries(row))assert.equal(actual[key],value);
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.throws(()=>f.db.exec("INSERT INTO staged_capture_evidence(owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload_bytes) VALUES('x','personal','','x','missing','pending',0,0,0)"),/FOREIGN KEY/);
  assert.equal(core.inspectAdmission({namespace:ns,client:'synthetic',eventId:'old',includeInitialClassification:true}).value.initialClassification.status,'skipped_empty');
});

test('E11 failed rebuild rolls back parent, every child and version; FK-off caller rejects',t=>{
  const f=legacy(t);f.db.exec('CREATE TABLE episode_identity(precious TEXT); INSERT INTO episode_identity VALUES(\'keep\')');
  const schema=f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),rows=oldTables.map(name=>f.db.prepare(`SELECT * FROM ${name}`).all());
  assert.throws(()=>openMemoryCore({path:f.path,...options}));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,14);
  assert.deepEqual(f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),schema);
  assert.deepEqual(oldTables.map(name=>f.db.prepare(`SELECT * FROM ${name}`).all()),rows);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  f.db.exec('PRAGMA foreign_keys=OFF');assert.throws(()=>transaction(f.db,()=>migrateVersion14(f.db)),/storage_error/);
});

test('E10 frozen v14 prompt/request/output/stored-field/digest parity with episodes off', async t => {
  const root = new URL('../../', import.meta.url).pathname, dir = directory(t);
  for (const [index, { config, expected }] of frozen.parity.entries()) {
    const path = join(dir, 'parity-' + index + '.sqlite');
    assert.deepEqual(await captureEpisodeParity(root, path, config), expected);
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 16);
      for (const name of ['session_episodes', 'episode_events', 'procedural_tags']) {
        assert.equal(db.prepare('SELECT count(*) n FROM ' + name).get().n, 0);
      }
    } finally { db.close(); }
  }
});

test('E11 eager feature-off open upgrades v14 before requests, independent of DDL whitespace', t => {
  const reformatted = schemaV14.replace("('pending','completed')", "( 'pending', 'completed' )");
  assert.notEqual(reformatted, schemaV14);
  const f = legacy(t, reformatted);
  const core = openMemoryCore({ path: f.path }); t.after(() => core.close());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 16);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  const before = f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  const result = core.admit({ namespace: ns, memory: { content: 'Rejected fact tag', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 's', eventId: 'bad', role: 'user', excerpt: 'Synthetic' }],
    procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 1 }] } });
  assert.equal(result.error.code, 'invalid_input');
  assert.deepEqual(f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM procedural_tags').get().n, 0);
});

test('E10 unexpected automatic tag output is still rejected with episodes off',async t=>{
  const core=openMemoryCore({path:join(directory(t),'automatic.sqlite'),model:{countTokens:()=>1,contextWindow:8192,
    extract:()=>({items:[{content:'Do reviews',kind:'instruction',confidence:0.8,sourceIndices:[0],procedural:true}]})}});t.after(()=>core.close());
  const result=await core.capture({namespace:ns,client:'synthetic',sessionId:'session',eventId:'tag-output',messages:[{id:'m',role:'user',content:'Always review changes.'}]});
  assert.equal(result.ok,false);assert.equal(result.error.code,'invalid_model_output');
});

test('E11 original v13 synthetic schema migrates through v14 journal into v15',t=>{
  const f=legacy(t);f.db.exec('DROP TABLE capture_initial_classification; PRAGMA user_version=13');
  const before=f.db.prepare('SELECT * FROM admission_claims').all();
  openMemoryCore({path:f.path,...options}).close();
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version,16);
  assert.deepEqual(f.db.prepare('SELECT * FROM admission_claims').all(),before);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('E11 reserved parent and released staging CHECK constraints enforce non-leased/content-free shapes',t=>{
  const f=legacy(t);openMemoryCore({path:f.path,...options}).close();
  assert.throws(()=>f.db.exec("UPDATE admission_claims SET state='reserved'"),/CHECK/);
  f.db.exec("UPDATE admission_claims SET state='reserved',memory_ids=NULL,suppressed_count=NULL");
  assert.throws(()=>f.db.exec("UPDATE admission_claims SET token='fake-lease'"),/CHECK/);
  assert.throws(()=>f.db.exec("UPDATE staged_capture_evidence SET state='released'"),/CHECK/);
  f.db.exec("UPDATE staged_capture_evidence SET event_mode='episode-v1',state='released',payload=NULL,payload_bytes=0,release_reason='capacity'");
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('E11 v15 rejects invalid namespaces, digests, oversized records and unknown processing states', async t => {
  const { fixture, register, batch, ns: episodeNs, draft } = await import('../testing/episode-helpers.mjs');
  const f = fixture(t), input = batch(), r = register(f, input), job = draft(f, r, input);
  f.runtime.commitEpisodeDraft(episodeNs, job.commit);
  for (const table of ['episode_controls', 'session_episodes', 'episode_events']) {
    for (const change of ["scope='wrong'", "scope='personal',project_id='not-empty'", "scope='project',project_id=''"]) {
      assert.throws(() => f.db.exec('UPDATE ' + table + ' SET ' + change), /CHECK/);
    }
  }
  for (const [table, column] of [['episode_identity', 'secret'], ['episode_events', 'payload_digest'], ['episode_sources', 'digest']]) {
    for (const value of ['a'.repeat(63), 'g'.repeat(64), 'A'.repeat(64)]) {
      assert.throws(() => f.db.prepare('UPDATE ' + table + ' SET ' + column + '=?').run(value), /CHECK/);
    }
  }
  const record = JSON.parse(f.db.prepare('SELECT record FROM session_episodes').get().record);
  for (const invalid of [{ ...record, processing: { state: 'invented' } }, { ...record, processing: {} },
    { ...record, gist: 'x'.repeat(32768) }]) {
    assert.throws(() => f.db.prepare('UPDATE session_episodes SET record=?').run(JSON.stringify(invalid)), /CHECK/);
  }
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('E10/E11 indexed evidence rejects episode options before getters or eager migration, then opens v14 atomically', t => {
  const f = legacy(t), before = f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  for (const sessionEpisodes of [undefined, { mode: 'episode-v1' }]) {
    assert.throws(() => openMemoryCore({ path: f.path, captureSourcePolicy: 'indexed-evidence-v1', sessionEpisodes }),
      { code: 'invalid_input' });
  }
  let reads = 0;
  const config = { path: f.path, captureSourcePolicy: 'indexed-evidence-v1' };
  Object.defineProperty(config, 'sessionEpisodes', { enumerable: true, get() { reads++; throw new Error('unexpected getter'); } });
  assert.throws(() => openMemoryCore(config), { code: 'invalid_input' });
  assert.equal(reads, 0);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 14);
  assert.deepEqual(f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before);
  const core = openMemoryCore({ path: f.path, captureSourcePolicy: 'indexed-evidence-v1' }); t.after(() => core.close());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 16);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(core.inspectAdmission({ namespace: ns, client: 'synthetic', eventId: 'old',
    includeInitialClassification: true }).value.initialClassification.status, 'skipped_empty');
});

test('E11 v15 committed fixture eagerly upgrades to v16 with empty content-free message ledger',t=>{
  const data=JSON.parse(readFileSync(new URL('../testing/episode-v15-fixture.json',import.meta.url),'utf8'));
  const schema=readFileSync(new URL('../testing/episode-schema-v15.sql',import.meta.url),'utf8');
  const path=join(directory(t),'v15.sqlite');writeFileSync(path,'',{mode:0o600});
  const db=new DatabaseSync(path);t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
  transaction(db,()=>{db.exec('PRAGMA defer_foreign_keys=ON');db.exec(schema);
    for(const [name,rows]of Object.entries(data.tables))for(const row of rows)
      db.prepare(`INSERT INTO ${name}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
  });
  openMemoryCore({path}).close();
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,16);
  assert.equal(db.prepare('SELECT count(*) n FROM episode_messages').get().n,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  for(const [name,rows]of Object.entries(data.tables)) {
    const actual=db.prepare(`SELECT * FROM ${name}`).all().map(row=>Object.fromEntries(Object.keys(rows[0]??{}).map(key=>[key,row[key]])));
    assert.deepEqual(JSON.parse(JSON.stringify(actual)),rows);
  }
  const layout=JSON.parse(readFileSync(new URL('../testing/episode-v16-layout.json',import.meta.url),'utf8'));
  for(const [name,expected] of Object.entries(layout))
    assert.deepEqual(JSON.parse(JSON.stringify(db.prepare('PRAGMA table_info('+name+')').all())),expected);
  assert.ok(db.prepare('PRAGMA table_info(episode_attempts)').all().some(column=>column.name==='keep_state'));
  assert.ok(db.prepare('PRAGMA table_info(episode_events)').all().some(column=>column.name==='omitted_indices'));
});

test('E11 failed v14/v15 -> v16 migration rolls back schema, rows and version',t=>{
  for(const version of [14,15]) {
    const data=JSON.parse(readFileSync(new URL(`../testing/episode-v${version}-fixture.json`,import.meta.url),'utf8'));
    const path=join(directory(t),`rollback-${version}.sqlite`);writeFileSync(path,'',{mode:0o600});
    const db=new DatabaseSync(path);t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON');
    transaction(db,()=>{db.exec('PRAGMA defer_foreign_keys=ON');db.exec(readFileSync(new URL(`../testing/episode-schema-v${version}.sql`,import.meta.url),'utf8'));
      for(const [name,rows]of Object.entries(data.tables))for(const row of rows)
        db.prepare(`INSERT INTO ${name}(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(()=>'?').join(',')})`).run(...Object.values(row));
      db.exec("CREATE TABLE episode_messages(precious TEXT); INSERT INTO episode_messages VALUES('keep')");
    });
    const before=db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
    assert.throws(()=>openMemoryCore({path}), { code: 'ERR_SQLITE_ERROR' });
    assert.deepEqual(db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(),before);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,version);
    assert.equal(db.prepare('SELECT precious FROM episode_messages').get().precious,'keep');
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }
});

test('E11 frozen v15 database opener refuses v16 rather than reopening it as an older format',async t=>{
  const {openDatabase}=await import('../testing/episode-v15-database.mjs');
  const path=join(directory(t),'old-binary.sqlite');openMemoryCore({path}).close();
  assert.throws(()=>openDatabase(path),{code:'unsupported_database'});
});
