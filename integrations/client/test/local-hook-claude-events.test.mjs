import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { events as setupEvents, mergeNative } from '../raw/local-setup-files.mjs';
import { events as coreLocalEvents, hookSelection } from '../../../packaging/core-local/capture-input.mjs';

// Tripwire, not a proof of safety. What it guards against: someone adds a
// prompt-time hook for Claude Code to a local install (for example a
// UserPromptSubmit recall that injects context) and nobody checks that what
// gets injected matches what the hosted plugin delivers. Local installs today
// do no automatic context read; local users read memory only through the
// model-called read_memory_context tool. If you add such a hook on purpose,
// update this test in the same change and bring the parity check with it.
// What it does not cover: a hook that writes context through some other
// mechanism, or a change to what Codex registers (Codex is pinned separately).

const CLAUDE = Object.freeze(['SessionStart', 'Stop', 'PreCompact']);
const PROMPT_EVENTS = Object.freeze(['UserPromptSubmit']);

test('local Claude Code installs register exactly SessionStart, Stop and PreCompact', () => {
  for (const events of [setupEvents, coreLocalEvents]) {
    assert.deepEqual(events('claude-code'), CLAUDE);
    for (const event of PROMPT_EVENTS) assert.equal(events('claude-code').includes(event), false);
  }
});

test('the settings Claude Code reads get hooks only for those events', () => {
  const request = { client: 'claude-code', installationDirectory: '/synthetic/cairn-local/capture/claude' };
  const written = JSON.parse(mergeNative('', request, true));
  assert.deepEqual(Object.keys(written.hooks).sort(), [...CLAUDE].sort());
  const kept = JSON.parse(mergeNative(JSON.stringify({ hooks: { UserPromptSubmit: [] } }), request, true));
  assert.deepEqual(kept.hooks.UserPromptSubmit, []);
  for (const event of CLAUDE) assert.equal(kept.hooks[event].length, 1);
});

test('a Claude Code prompt event is refused before any capture work', () => {
  const payload = { hook_event_name: 'UserPromptSubmit', session_id: 'synthetic-session', transcript_path: '/synthetic/session.jsonl' };
  assert.throws(() => hookSelection(payload, 'UserPromptSubmit', 'claude-code'), { reason: 'event_refused' });
  assert.doesNotThrow(() => hookSelection({ ...payload, hook_event_name: 'Stop' }, 'Stop', 'claude-code'));
});

test('the installed hook entry writes nothing that Claude Code could take as context', () => {
  const cli = readFileSync(fileURLToPath(new URL('../raw/local-setup-cli.mjs', import.meta.url)), 'utf8');
  const branch = cli.slice(cli.indexOf("} else if (hook &&"), cli.indexOf("} else fail('invalid_input');"));
  assert.ok(branch.includes('runLocalRawHook'), 'hook branch located');
  assert.equal(/stdout|stderr|console\.|additionalContext/.test(branch), false);
  assert.match(cli, /catch \(error\) \{\s*if \(hook\) return 0;/);
});
