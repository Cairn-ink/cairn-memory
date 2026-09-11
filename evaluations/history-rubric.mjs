// Evaluator-only propositions. Never import this module into the capture runner.
export const historyRubric = Object.freeze([
  { id: 'H1-within-window-update', required: ['Harbor review is now Monday.'],
    forbidden: ['Friday or Tuesday asserted as current Harbor review day.'],
    note: 'An explicitly historical Friday statement is allowed; unqualified current Friday is stale.' },
  { id: 'H2-across-window-update', required: ['Harbor review is now Monday.'],
    forbidden: ['Friday or Tuesday asserted as current Harbor review day.'],
    note: 'Source-supported prior Friday is not automatically current truth after the later update.' },
  { id: 'H3-entities-and-negation', required: ['Harbor uses Go.', 'Juniper uses Python.',
    'Harbor adopted SQLite.', 'SQLite deployment completion is unknown.'],
    forbidden: ['Harbor adopted Rust.', 'Juniper adopted Go.', 'Harbor adopted Redis.', 'SQLite deployment is complete.'],
    note: 'Assistant proposals must not be promoted into adoption or completed deployment.' },
  { id: 'H4-positioned-24-messages', required: ['Preferred Harbor editor is VS Code.', 'Harbor uses Go.',
    'Harbor review is Friday.'], forbidden: [], note: 'Retain all three facts, not just the final message.' },
]);
