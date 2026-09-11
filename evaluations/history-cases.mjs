// Model-facing source histories only. Evaluation propositions live separately.
const message = (id, content, role = 'user') => ({ id, role, content });
const history = [
  { id: 'H1-within-window-update', windows: [[
    message('h1-1', 'Harbor team review happens on Friday.'),
    message('h1-2', 'I am checking the calendar now.'),
    message('h1-3', 'Should we try Tuesday instead?', 'assistant'),
    message('h1-4', 'No, Tuesday was only a suggestion and was not adopted.'),
    message('h1-5', 'Thanks, one moment while I check.'),
    message('h1-6', 'Confirmed update: Harbor team review now happens on Monday, replacing Friday.'),
    message('h1-7', 'Got it.', 'assistant'),
    message('h1-8', 'That is all for now.'),
  ]], queries: [{ id: 'h1-current', query: 'When does the Harbor team review happen now?' }] },
  { id: 'H2-across-window-update', windows: [
    [message('h2-1', 'Harbor team review happens on Friday.'), message('h2-2', 'Thanks.', 'assistant')],
    [message('h2-3', 'Could Harbor team review move to Tuesday?', 'assistant'),
      message('h2-4', 'No, Tuesday is only a proposal. We have not adopted it.')],
    [message('h2-5', 'Confirmed update: Harbor team review now happens on Monday, replacing Friday.'),
      message('h2-6', 'Understood.', 'assistant')],
  ], queries: [{ id: 'h2-current', query: 'When does the Harbor team review happen now?' }] },
  { id: 'H3-entities-and-negation', windows: [[
    message('h3-1', 'Harbor uses Go. Juniper uses Python.'),
    message('h3-2', 'Perhaps Harbor could use Rust and Juniper could use Go.', 'assistant'),
    message('h3-3', 'Neither suggestion was adopted. Harbor still uses Go and Juniper still uses Python.'),
    message('h3-4', 'Harbor adopted SQLite; it rejected Redis. Adoption does not mean deployment has finished.'),
    message('h3-5', 'I do not know whether the SQLite deployment is complete.'),
  ]], queries: [{ id: 'h3-languages', query: 'Which languages do Harbor and Juniper use?' },
    { id: 'h3-database', query: 'What database did Harbor adopt, and is deployment complete?' }] },
  { id: 'H4-positioned-24-messages', windows: [Array.from({ length: 24 }, (_, index) => {
    const content = index === 0 ? 'For Harbor work, my preferred editor is VS Code.'
      : index === 11 ? 'Harbor uses Go.' : index === 23 ? 'Harbor team review happens on Friday.'
        : `Temporary chat turn ${index + 1}: I am still checking; no new decision or preference.`;
    return message(`h4-${index + 1}`, content);
  })], queries: [{ id: 'h4-editor', query: 'What editor do I prefer for Harbor work?' },
    { id: 'h4-language', query: 'What language does Harbor use?' },
    { id: 'h4-review', query: 'When does the Harbor team review happen?' }] },
];
const freeze = value => { if (value && typeof value === 'object') {
  Object.values(value).forEach(freeze); Object.freeze(value);
} return value; };
export const historyVersion = 'conversation-history-v1';
export const historyCases = freeze(history);
