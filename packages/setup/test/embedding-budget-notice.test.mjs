import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { message } from '../lib/messages.mjs';
import { wrapLine, columns } from '../lib/output.mjs';

for (const lang of ['en', 'zh']) test(`daily server embedding allowance in setup and capture notices (${lang})`, () => {
  const snapshot = readFileSync(new URL(`./snapshots/local-setup-${lang}.txt`, import.meta.url), 'utf8');
  const unit = lang === 'en' ? 'up to an estimated US$1 per day per running Cairn server' : '每個執行中的 Cairn server 每天預估上限約 US$1';
  for (const [key, params] of [['local_privacy', {}], ['local_capture_notice', { client: 'Claude Code' }], ['local_capture_notice', { client: 'Codex' }]]) {
    const text = message(lang, key, params);
    assert.ok(text.includes(unit));
    const lines = text.split('\n').flatMap(wrapLine);
    assert.ok(lines.every(line => columns(line) <= 80));
    assert.ok(snapshot.includes(lines.join('\n')), key + ' must match the committed screen snapshot');
  }
  assert.doesNotMatch(snapshot, /per server run|每次 server|執行的預估費用上限/);
});
