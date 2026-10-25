import assert from 'node:assert/strict';
import test from 'node:test';
import { createPrimaryCheck, scanPrimary } from '../topic-members-primary.mjs';

function inspect(sql, expected, stride) {
  const state = createPrimaryCheck(expected), bytes = Buffer.from(sql);
  for (let offset = 0; offset < bytes.length; offset += stride) {
    scanPrimary(state, bytes.subarray(offset, offset + stride).toString('latin1'));
    assert.ok(Buffer.byteLength(JSON.stringify(state)) < 4096, 'lexer retains bounded state, not the whole declaration');
  }
  scanPrimary(state, '', true); return state.keys;
}
for (const [name, sql, expected] of [
  ['inline', 'CREATE TABLE t(id TEXT PRIMARY KEY)', ['id']],
  ['named and case insensitive', 'CREATE TABLE t(id TEXT, CONSTRAINT "primary key" PRIMARY KEY ("ID")) STRICT', ['id']],
  ['composite', 'CREATE TABLE t(a TEXT,b TEXT,PRIMARY KEY(a COLLATE BINARY ASC,b ASC))', ['a','b']],
  ['single quoted identifier', "CREATE TABLE t('id' TEXT PRIMARY KEY)", ['id']],
  ['bracket identifier', 'CREATE TABLE t([id] TEXT PRIMARY KEY)', ['id']],
  ['backtick identifier', 'CREATE TABLE t(`id` TEXT PRIMARY KEY)', ['id']],
  ['escaped quote', 'CREATE TABLE t("i""d" TEXT PRIMARY KEY)', ['i"d']],
  ['escaped backtick', 'CREATE TABLE t(`i``d` TEXT PRIMARY KEY)', ['i`d']],
  ['comments and strings', "CREATE /* PRIMARY KEY(fake) */ TABLE t(id TEXT, note TEXT DEFAULT 'PRIMARY KEY(fake)', CHECK(note != 'x'), -- PRIMARY KEY(fake)\n PRIMARY /* gap */ KEY(id))", ['id']],
  ['quoted constraint names', 'CREATE TABLE t("PRIMARY" TEXT UNIQUE,id TEXT CONSTRAINT "PRIMARY KEY" PRIMARY KEY)', ['id']],
  ['literal doubled quote', "CREATE TABLE t(note TEXT DEFAULT 'x''PRIMARY KEY(fake)', id TEXT PRIMARY KEY)", ['id']],
  ['nested expressions', 'CREATE TABLE t(note TEXT CHECK (length(note) > 0 AND note != "PRIMARY KEY(fake)"), id TEXT PRIMARY KEY)', ['id']],
  ['trailing comment', 'CREATE TABLE t(id TEXT PRIMARY KEY) -- tail', ['id']],
  ['long comment', 'CREATE TABLE t(/*' + 'x'.repeat(100000) + '*/ id TEXT PRIMARY KEY)', ['id']],
]) test('Primary-key identity lexer: ' + name, () => {
  for (const stride of [1,2,3,7,64,256]) assert.deepEqual(inspect(sql, expected, stride), expected);
});
for (const [name, sql, expected] of [
  ['nullable unique', 'CREATE TABLE t(surrogate INTEGER PRIMARY KEY,id TEXT UNIQUE)', ['id']],
  ['table unique', 'CREATE TABLE t(surrogate INTEGER PRIMARY KEY,a TEXT,b TEXT,UNIQUE(a,b))', ['a','b']],
  ['fake comment', 'CREATE TABLE t(id TEXT UNIQUE /* PRIMARY KEY(id) */)', ['id']],
  ['fake string', "CREATE TABLE t(id TEXT UNIQUE,note TEXT DEFAULT 'PRIMARY KEY(id)')", ['id']],
  ['fake quoted column', 'CREATE TABLE t("PRIMARY KEY(id)" TEXT,id TEXT UNIQUE)', ['id']],
  ['wrong order', 'CREATE TABLE t(a TEXT,b TEXT,PRIMARY KEY(b,a))', ['a','b']],
  ['wrong column', 'CREATE TABLE t(id TEXT,other TEXT PRIMARY KEY)', ['id']],
  ['descending inline', 'CREATE TABLE t(id TEXT PRIMARY KEY DESC)', ['id']],
  ['descending table', 'CREATE TABLE t(id TEXT,PRIMARY KEY(id DESC))', ['id']],
  ['collated table', 'CREATE TABLE t(id TEXT,PRIMARY KEY(id COLLATE NOCASE))', ['id']],
  ['duplicate declarations', 'CREATE TABLE t(id TEXT PRIMARY KEY,other TEXT PRIMARY KEY)', ['id']],
  ['unterminated quote', 'CREATE TABLE t("id TEXT PRIMARY KEY)', ['id']],
]) test('Primary-key identity lexer refuses: ' + name, () => {
  for (const stride of [1,2,3,7,64,256]) assert.throws(() => inspect(sql, expected, stride), { code: 'unsupported_database' });
});
