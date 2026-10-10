// Same display-width rule as the approved proposal's src/check.mjs.
export const columns = text => [...text.replace(/\x1b\[[0-9;]*m/gu, '')].reduce((n, c) =>
  n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u.test(c) ? 2 : 1), 0);
// Double quotes allow backslash continuations inside long arguments. Escape
// shell expansion as well as quotes; JSON string escaping alone is insufficient.
export const shellArgument = value => '"' + String(value).replace(/[\\"$`]/gu, '\\$&') + '"';
export function wrapLine(line) {
  const lines = [];
  const command = /^\s*(?:npx|codex|claude|node|TMPDIR=)(?:\s|$)/u.test(line);
  while (columns(line) > 80) {
    let width = 0, end = 0, space = -1;
    for (const c of line) {
      if (width + columns(c) > (command ? 78 : 80)) break;
      if (c === ' ' && end > 1) space = end;
      width += columns(c); end += c.length;
    }
    let cut = space > end / 2 ? space : end;
    // Never divide an escaped character from its backslash before inserting
    // the continuation, including inside a double-quoted argument.
    if (command && (line.slice(0, cut).match(/\\+$/u)?.[0].length ?? 0) % 2) cut--;
    const atSpace = line[cut] === ' ';
    lines.push(line.slice(0, cut) + (command ? (atSpace ? ' \\' : '\\') : ''));
    line = command && !atSpace ? line.slice(cut) : '  ' + line.slice(cut).trimStart();
  }
  return [...lines, line];
}
export const terminalWriter = write => text => {
  if (text === undefined || text === null) return;
  for (const line of String(text).split('\n')) for (const wrapped of wrapLine(line)) write(wrapped);
};
export const technical = new Set(['authorization_shared','codex_hooks_dry','codex_startup_gate',
  'claude_available','codex_available','marketplace_ready','marketplace_status','endpoint_flag',
  'endpoint_config','endpoint_default','endpoint_prompt_source','codex_user_status',
  'codex_connection','codex_enabled','codex_credential','codex_runtime_version',
  'codex_shared_pause_availability']);
