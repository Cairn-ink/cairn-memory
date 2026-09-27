import { createHash } from 'node:crypto';

// Frozen synthetic source-only cases. Scripted answers live in oracle.mjs.
const message = (content, role = 'user') => ({ id: `message-${createHash('sha256').update(role + content).digest('hex').slice(0, 16)}`, role, content });
const noise = seed => Array.from({ length: 13 }, (_, i) => createHash('sha256').update(`${seed}-${i}`).digest('hex')).join('').slice(0, 800);
const cases = [
  ['short-fact', [message('My preferred editor is Vim.')]],
  ['uncertain-cause', [message('The outage may have been caused by DNS; I am not sure.')]],
  ['proposal-adoption', [message('We could use SQLite.'), message('For this local prototype, we adopted SQLite.')]],
  ['assistant-suggestion', [message('I suggest Redis for caching.', 'assistant')]],
  ['reason-challenge', [message('We chose A because its latency was lower.'), message('The new measurement shows A is slower. We have not changed the decision.')]],
  ['older-imported-later', [message('Imported today: on 2022-01-03 I used Emacs. This is historical.')]],
  ['unicode-boundary', [message('界'.repeat(199) + '🚋' + '界'.repeat(599) + 'END')]],
  ['five-short', Array.from({ length: 5 }, (_, i) => message(`Synthetic source ${i}: project ${i} uses tool ${i}.`))],
  ['five-distinct-long', Array.from({ length: 5 }, (_, i) => message(noise(i)))],
  ['five-repeated-long', Array.from({ length: 5 }, (_, i) => ({ ...message(noise('same')), id: `repeated-${i}` }))],
  ['five-multi-source-medium', Array.from({ length: 20 }, (_, i) => message(noise(i + 40).slice(0, 300)))],
  ['unfit', Array.from({ length: 24 }, (_, i) => message(noise(i + 100)))],
];
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export const fixtures = freeze(cases.map(([id, messages]) => ({ id,
  input: { namespace: { ownerId: 'synthetic', scope: 'project', projectId: 'experiment' },
    client: 'synthetic', sessionId: id, eventId: id, messages } })));
export const fixtureSha256 = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
