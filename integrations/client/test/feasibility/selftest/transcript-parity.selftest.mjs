// Offline self-test: the harness Claude parser and the released plugin parser
// keep the same records from the committed synthetic transcript fixtures, and
// differ only where the harness is deliberately stricter.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { transcriptMessages } from '../../../../../plugins/cairn-memory/lib/transcript.mjs';
import { parseTranscript } from '../lib/parsers.mjs';

const FIXTURES = ['claude-2.1.283-print.jsonl', 'claude-2.1.283-interactive.jsonl'];

test('harness and plugin parsers keep identical Claude records', () => {
  for (const fixture of FIXTURES) {
    const text = readFileSync(new URL(`../../../../../plugins/cairn-memory/test/fixtures/${fixture}`, import.meta.url), 'utf8');
    const harness = parseTranscript('claude', Buffer.from(text), 0).messages.map(({ role, text: body }) => [role, body]);
    const plugin = transcriptMessages(text, 'session').map(({ role, content }) => [role, content]);
    assert.deepEqual(harness, plugin, fixture);
    assert.equal(JSON.stringify(harness).includes('FXMACHINE'), false, fixture);
    assert.ok(harness.some(([role]) => role === 'user'), fixture);
  }
});

test('the harness also drops assistant-level meta and summary records, which the plugin keeps as 0.1.0 did', () => {
  const text = [
    { type: 'assistant', uuid: 'a1', isMeta: true, message: { role: 'assistant', content: [{ type: 'text', text: 'FXMETA' }] } },
    { type: 'assistant', uuid: 'a2', isCompactSummary: true, message: { role: 'assistant', content: 'FXSUMMARY' } },
    { type: 'assistant', uuid: 'a3', message: { role: 'assistant', content: 'FXKEPT' } },
  ].map(record => JSON.stringify(record)).join('\n');
  const harness = parseTranscript('claude', Buffer.from(`${text}\n`), 0);
  assert.deepEqual(harness.messages.map(message => message.text), ['FXKEPT']);
  assert.equal(harness.excluded.meta, 1);
  assert.equal(harness.excluded['compact-summary'], 1);
  assert.deepEqual(transcriptMessages(text, 'session').map(message => message.content), ['FXMETA', 'FXSUMMARY', 'FXKEPT']);
});
