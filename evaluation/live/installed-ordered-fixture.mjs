// Fixed synthetic source protocol, not model-facing semantic review labels.
const first = 'Harbor team review happens on Friday.';
const update = 'Confirmed update: Harbor team review now happens on Monday, replacing Friday.';
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
export const ORDERED_CAPTURE_LOOP_VERSION = 'installed-ordered-capture-mcp-v1';
export const ORDERED_CAPTURE_LOOP_FIXTURE = freeze({
  first, update,
  correction: 'Harbor team review happens on Tuesday.',
  query: 'When does the Harbor team review happen now?',
  client: 'installed-ordered-capture-loop', streamId: 'synthetic-ordered-stream',
  extractionModel: 'gpt-5.4-mini-2026-03-17',
  windows: [
    { sessionId: 'synthetic-source-1', eventId: 'synthetic-event-1', sequence: 1,
      messages: [{ id: 'synthetic-message-1', role: 'user', content: first }] },
    { sessionId: 'synthetic-source-2', eventId: 'synthetic-event-2', sequence: 2,
      messages: [{ id: 'synthetic-message-2', role: 'user', content: update }] },
  ],
});
