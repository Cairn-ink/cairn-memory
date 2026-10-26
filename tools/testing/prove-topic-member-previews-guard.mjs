// Offline guard proof: run with each accepted Node binary, independently of tests.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { PREVIEW_SOURCE_SQL } from '../../core/topic-member-previews-storage.mjs';
import { GRAPHEME_CANARIES, previewCapability } from '../../core/topic-member-previews-text.mjs';
export function proveGuard() {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE memories(id TEXT PRIMARY KEY, owner_id TEXT, scope TEXT, project_id TEXT,
      revision INTEGER, kind TEXT, deleted INTEGER, currentness TEXT, review_state TEXT, content TEXT)`);
    const args = ['a', 'owner', 'personal', '', 1, 'fact'];
    const code = db.prepare('EXPLAIN ' + PREVIEW_SOURCE_SQL).all(...args);
    const content = code.filter(op => op.opcode === 'Column' && op.p1 === 0 && op.p2 === 9);
    assert.equal(content.length, 5);
    assert.deepEqual(content.map(op => op.p5), [128, 192, 128, 192, 0]);
    // TYPEOFARG=0x80 and LENGTHARG=0x40: both direct octet_length
    // operands carry 0xc0; only the approved CASE branch has an ordinary load.
    const extraction = content.at(-1), branch = code.find(op => op.opcode === 'Gt' && op.addr < extraction.addr && op.p2 > extraction.addr);
    assert.ok(branch);
    assert.equal(code[branch.p2].opcode, 'Null');
    assert.ok(code.some(op => op.opcode === 'Integer' && op.p1 === 12000 && op.p2 === branch.p1));
    assert.equal(code[extraction.addr + 1].opcode, 'Cast');
    assert.equal(code[extraction.addr + 1].p2, 65); // SQLITE_BLOB
    assert.equal(code[extraction.addr + 2].p4, 'substr(3)');
    for (const column of content.filter(op => op.p5 === 192)) assert.equal(code[column.addr + 1].p4, 'octet_length(1)');
    const plan = db.prepare('EXPLAIN QUERY PLAN ' + PREVIEW_SOURCE_SQL).get(...args).detail;
    assert.match(plan, /^SEARCH memories USING INDEX sqlite_autoindex_memories_1 \(id=\?\)$/);
    db.prepare("INSERT INTO memories VALUES('a','owner','personal','',1,'fact',0,'current','none',?)").run('x'.repeat(12001));
    const rejected = db.prepare(PREVIEW_SOURCE_SQL).get(...args);
    assert.equal(rejected.source_bytes, 12001); assert.equal(rejected.source, null);
    db.prepare("UPDATE memories SET content=? WHERE id='a'").run('界'.repeat(4000));
    assert.equal(db.prepare(PREVIEW_SOURCE_SQL).get(...args).source.byteLength, 12000);
    const capability = previewCapability(); assert.ok(capability.segmenter);
    for (const [input, expected] of GRAPHEME_CANARIES) assert.deepEqual(Array.from(capability.segmenter.segment(input), p => p.segment), expected);
    return { runtime: process.version, sqlite: process.versions.sqlite, icu: process.versions.icu,
      contentColumnFlags: content.map(op => ({ addr: op.addr, flags: op.p5 })),
      oversizedBranch: { addr: branch.addr, target: branch.p2, extraction: extraction.addr }, plan,
      oversizedSourceNull: true, approvedBytes: 12000, canaries: GRAPHEME_CANARIES.length };
  } finally { db.close(); }
}
if (process.argv[1]?.endsWith('prove-topic-member-previews-guard.mjs')) console.log(JSON.stringify(proveGuard()));
