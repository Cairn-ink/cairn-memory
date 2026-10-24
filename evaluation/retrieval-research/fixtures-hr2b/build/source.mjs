// Individually authored bilingual factual cores. No HR-1 row is reused.
// Each line: Traditional Chinese | English | additional forbidden forms (~).
// Row order: historical decision, successor, separate reason, bounded amount,
// primary assignment, nearby assignment, explicit rejected/proposed option,
// plausible absent fact. The last row is never sent to the renderer.
export function family(id, domain, name, alias, person, personAlias, text) {
  const rows = text.trim().split('\n').map((line, index) => {
    const [zh, en, terms, ...rest] = line.trim().split('|').map(value => value.trim());
    if (!zh || !en || !terms || rest.length) throw new Error(`${id}: malformed authored row ${index}`);
    return { zh, en, terms: terms.split('~').map(value => value.trim()) };
  });
  if (rows.length !== 8) throw new Error(`${id}: expected eight authored rows`);
  return { id, domain, name, alias, person, personAlias, rows };
}
export const SETTING = 'All organizations, people, chat turns and incidents are invented; independent Taiwan-based founder workspaces.';
