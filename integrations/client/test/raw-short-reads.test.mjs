import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { prepareRawRecord, scanRawRecordRanges } from '../raw/index.mjs';
import { openLocalSource } from '../raw/local-source-open.mjs';
import { readBytes } from '../../codex/source.mjs';
import { recordFixture, key, claude, codex } from './fixtures/raw-fixtures.mjs';
import { redactSecrets } from '../redact.mjs';

for (const client of ['claude-code', 'codex']) for (const cap of [1, 3, 4093, 4097]) {
  test(`${client} capture keeps exact text with every transcript and scratch read capped at ${cap} bytes`, async t => {
    const text = (cap < 4 ? '' : 'x'.repeat(3999)) + '🙂 𠮷 中繁 Ａ e\u0301 '.repeat(cap < 4 ? 3 : 700);
    const f = await recordFixture(t, client, (client === 'codex' ? codex : claude)(text));
    const source = await openLocalSource(f.path); f.workspace.defer(() => source.close());
    const prototype = Object.getPrototypeOf(source), read = prototype.read;
    let shortReads = 0, oddReads = 0;
    t.mock.method(prototype, 'read', async function(buffer, offset, length, position) {
      const result = await read.call(this, buffer, offset, Math.min(length, cap), position);
      if (result.bytesRead < length) shortReads++;
      if (result.bytesRead % 2) oddReads++;
      return result;
    });
    const original = await readBytes(source, f.input.range.start, f.input.range.end);
    assert.equal(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(original)).type, client === 'codex' ? 'event_msg' : 'user');
    const ranges = [];
    for await (const range of scanRawRecordRanges({ source, ...f.input.range })) ranges.push(range);
    assert.deepEqual(ranges, [f.input.range]);
    const selected = await prepareRawRecord({ ...f.input, source }, { identityKey: key });
    assert.equal(selected.disposition, 'selected'); f.workspace.defer(() => selected.message.close());
    const parts = [];
    for (let start = 0; start < selected.message.metadata.totalUnits;) {
      const part = await selected.message.readPart({ start, maxUnits: cap < 4 ? 3 : 4000 });
      assert.ok(part.text.isWellFormed());
      parts.push(Buffer.from(part.text)); start = part.end;
    }
    const bytes = Buffer.concat(parts), expected = Buffer.from(redactSecrets(text));
    assert.ok(bytes.equals(expected), 'captured UTF-8 bytes match exactly');
    assert.equal(selected.message.metadata.totalBytes, expected.length);
    assert.ok(shortReads > 0 && oddReads > 0, 'actual short and odd-byte reads occurred');
  });
}

for (const client of ['claude-code', 'codex']) test(`${client} short-read UTF-8 decoder still refuses malformed input and premature EOF`, async t => {
  const f = await recordFixture(t, client, (client === 'codex' ? codex : claude)('e\u0301 Ａ🙂'));
  const bytes = await readBytes(f.source, 0, f.input.range.end);
  // Replace a continuation byte, retaining a complete, newline-terminated row.
  bytes[bytes.indexOf(Buffer.from('\u0301')) + 1] = 0xff;
  await writeFile(f.path, bytes);
  const source = { read: (buffer, offset, length, position) => f.source.read(buffer, offset, Math.min(length, 1), position) };
  await assert.rejects(prepareRawRecord({ ...f.input, source }, { identityKey: key }), { code: 'raw_source_invalid' });
  await assert.rejects(readBytes(source, 0, bytes.length + 1), /source_changed/);
  const truncated = { read: async () => ({ bytesRead: 0 }) };
  await assert.rejects(prepareRawRecord({ ...f.input, source: truncated }, { identityKey: key }), { code: 'raw_source_changed' });
});
