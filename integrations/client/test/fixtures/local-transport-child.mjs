// Copied into an owned fake runtime; all behavior is synthetic and baked in.
import { readFileSync, writeFileSync } from 'node:fs';
const settings = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));
const note = value => writeFileSync(new URL('./observed.json', import.meta.url), JSON.stringify(value), { mode: 0o600 });
if (settings.ignoreTerm) process.on('SIGTERM', () => {});
if (settings.mode === 'hang') { note({ pid: process.pid }); setInterval(() => {}, 1000); }
else {
  const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  note({ pid: process.pid, argv: process.argv.slice(2), environmentKeys: Object.keys(process.env).sort(),
    selectedKeyMatches: settings.keyName ? process.env[settings.keyName] === 'synthetic-key-sentinel' : true,
    eventId: request.event_id, sourceMatches: request.messages[0].content === 'synthetic-source-sentinel' });
  const raw = { conversationId: 'synthetic-conversation', revision: 1,
    parts: request.messages.map(message => ({ messageId: message.id, index: message.part.index, saved: true, reason: null })) };
  let reply = { status: 200, body: { version: 2, duplicate: false, memoryCount: 0, raw } };
  if (settings.mode === 'duplicate') reply.body.duplicate = true;
  if (settings.mode === 'processing') reply = { status: 202, body: { ...reply.body, processing: true } };
  if (settings.mode === 'quota') reply = { status: 429, body: { error: 'quota_reached' } };
  if (settings.mode === 'incomplete') reply = { status: 503, body: { error: 'interpretation_incomplete', raw } };
  if (settings.mode === 'refused') reply = { status: 403, body: { error: 'capture_disabled' } };
  if (settings.mode === 'wrong-part') reply.body.raw.parts[0].index++;
  if (settings.mode === 'unknown-error') reply = { status: 500, body: { error: 'synthetic-source-sentinel synthetic-key-sentinel' } };
  if (settings.mode === 'invalid-utf8') process.stdout.write(Buffer.from([0xc0, 0xaf]));
  else if (settings.mode === 'flood') process.stdout.write('x'.repeat(262145));
  else if (settings.mode === 'stderr-flood') { process.stderr.write('x'.repeat(65537)); process.stdout.write(JSON.stringify(reply) + '\n'); }
  else process.stdout.write(JSON.stringify(reply) + (settings.mode === 'no-newline' ? '' : '\n') + (settings.mode === 'two-lines' ? '{}\n' : ''));
  if (settings.mode === 'nonzero') process.exitCode = 7;
  if (settings.mode === 'reply-hang') { process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); }
}
