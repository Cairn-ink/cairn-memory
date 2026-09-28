// Offline self-test: the harness Claude parser and the released plugin parser
// keep the same records from the committed synthetic transcript fixtures.
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
