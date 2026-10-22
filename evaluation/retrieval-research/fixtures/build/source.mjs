// Authored records: marker | canonical fact | extracted body | verbatim excerpt.
// S means the complete fact is only in the excerpt; the body deliberately omits it.
export function family(id, domain, lang, summary, entities, changed, text, absent = null) {
  const rows = text.trim().split('\n').map(line => {
    const [coverage, statement, content, span, ...rest] = line.trim().split('|').map(x => x.trim());
    if (rest.length || !['B', 'S'].includes(coverage) || !statement || !content || !span)
      throw new Error(`Malformed authored row in ${id}: ${line}`);
    return { coverage: coverage === 'B' ? 'body' : 'span-only', statement, content, span, lang };
  });
  if (rows.length !== 7) throw new Error(`${id}: expected seven authored rows`);
  const optionStatement = rows[6].statement;
  const optionState = /rejected|拒絕|否決/i.test(optionStatement) ? 'rejected' : /propos|提案|未獲核准/i.test(optionStatement) ? 'proposed' : null;
  if (!optionState) throw new Error(`${id}: option state must be explicit in canonical wording`);
  return { id, domain, lang, summary, entities, changed, rows, absent, optionState, handExtras: [] };
}

export function extras(f, text) {
  f.handExtras = text.trim().split('\n').map(line => {
    const [statement, span, ...rest] = line.trim().split('|').map(x => x.trim());
    if (rest.length || !statement || !span) throw new Error(`Malformed extra in ${f.id}`);
    return { statement, content: statement, span, lang: f.lang };
  });
  if (f.handExtras.length !== 9) throw new Error(`${f.id}: expected nine authored extras`);
  return f;
}
