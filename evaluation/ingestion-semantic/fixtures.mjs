import { createHash } from 'node:crypto';

// Synthetic source-only cases. Semantic expectations are frozen separately in rubric.json.
const message = (content, role = 'user') => ({
  id: `message-${createHash('sha256').update(role + content).digest('hex').slice(0, 16)}`,
  role,
  content,
});

const cases = [
  ['explicit-preference', [
    message('For the weekly field-notes project, I prefer plain-text files over a shared dashboard.'),
  ]],
  ['tentative-incident-cause', [
    message('The 2026-08-14 rehearsal export failed. I suspect the font cache, but we have not confirmed the cause.'),
  ]],
  ['proposal-not-adopted', [
    message('For the Cedar greenhouse inventory, switching from labels to etched marks is only a proposal; I have not approved it.'),
  ]],
  ['dated-scoped-adoption', [
    message('We could use paper logs for the kiln audit.'),
    message('On 2026-05-12, I approved paper logs for the April kiln audit only; the June audit stays electronic.'),
  ]],
  ['invalidated-reason-choice-unchanged', [
    message('We chose the north entrance for the July exhibit because it was expected to need fewer staff.'),
    message('The estimate was wrong: the north entrance needs more staffing than the west entrance. We are keeping north for July anyway.'),
  ]],
  ['adopted-reversal-with-reason', [
    message('On 2026-02-04, I chose glass jars for the tea display.'),
    message('On 2026-02-09, a transit test showed the glass jars leak. Because of that, I reversed my choice and adopted sealed tins for the tea display.'),
  ]],
  ['late-import-historical-event', [
    message('Imported 2026-09-26: my journal says I used a copper lantern during the 2021-06 Bracken Marsh survey.'),
  ]],
  ['distinct-environment-scopes', [
    message('The production dashboard ends idle sessions after 90 seconds.'),
    message('The staging dashboard keeps idle sessions for 15 minutes.'),
  ]],
  ['quoted-third-party-claim', [
    message('In a draft, Morgan wrote, “the archive is complete.” I have not verified Morgan’s claim.'),
  ]],
  ['dated-one-day-reflection', [
    message('Keep this as a dated journal entry: on 2026-09-26, I felt impatient while waiting in the ferry queue. That was just that day’s mood, not a usual trait.'),
  ]],
  ['assistant-suggestion-only', [
    message('For the Apricot lab sample register, you might add a checksum column.', 'assistant'),
  ]],
  ['conditional-cap-exception', [
    message('For the first two winter-crate shipments, keep delivery under $40 unless temperature-controlled shipping is required; then that crate’s cap may be lifted.'),
    message('Temperature-controlled shipping is required for shipment two, so I am lifting the $40 cap for that crate only. Shipment one remains under $40.'),
  ]],
];

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const fixtures = freeze(cases.map(([id, messages]) => ({
  id,
  input: {
    namespace: { ownerId: 'synthetic', scope: 'project', projectId: 'ingestion-semantic-probe' },
    client: 'synthetic',
    sessionId: id,
    eventId: id,
    messages,
  },
})));

export const fixtureSha256 = createHash('sha256').update(JSON.stringify(fixtures)).digest('hex');
