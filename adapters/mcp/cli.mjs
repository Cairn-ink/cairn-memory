import { pathToFileURL } from 'node:url';
import { identifier } from '../../core/validation.mjs';
import { DEFAULT_MODEL } from '../openai/profiles.mjs';

const help = `Cairn Memory — local stdio MCP developer preview

Usage:
  cairn-memory --help
  cairn-memory --check-config --db PATH --owner ID [--project ID]
  cairn-memory --db PATH --owner ID [--project ID]

Keep the database outside node_modules; its parent directory must exist.
Reuse the exact database, owner and project across sessions.
Normal startup waits for an MCP client on stdin; stdout is protocol-only.
Tools: remember_memory, recall_memory, inspect_memory, correct_memory, forget_memory.
Remember saves explicit content, not automatically extracted conversations.
Semantic recall needs OPENAI_API_KEY in the process environment (never arguments).
Recall sends selected memory context to OpenAI and may incur charges; no account
spending cap is enforced. Other tools work without a model key.
--check-config checks syntax only: no database access or provider requests.
It cannot verify database permissions, credentials or model availability.
`;

export function parseConfiguration(args) {
  const allowed = new Set(['--db', '--owner', '--project']);
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('invalid_mcp_configuration');
    }
    values.set(args[i], args[i + 1]);
  }
  if (!values.get('--db') || !values.get('--owner')) throw new Error('invalid_mcp_configuration');
  identifier(values.get('--owner'));
  if (values.has('--project')) identifier(values.get('--project'));
  if (values.get('--db').includes('\0')) throw new Error('invalid_mcp_configuration');
  return { path: values.get('--db'), namespace: { ownerId: values.get('--owner'),
    scope: values.has('--project') ? 'project' : 'personal', projectId: values.get('--project') ?? null } };
}

export async function start(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  const check = args[0] === '--check-config';
  const config = parseConfiguration(check ? args.slice(1) : args);
  const key = env.OPENAI_API_KEY;
  if (key && (typeof key !== 'string' || !key.trim() || /[\r\n]/.test(key))) {
    throw new Error('invalid_mcp_configuration');
  }
  if (check) {
    console.log(JSON.stringify({ ok: true, mode: 'configuration-check',
      scope: config.namespace.scope, modelKeyPresent: Boolean(key),
      recallModel: key ? DEFAULT_MODEL : null,
      recall: key ? 'configured-not-verified' : 'model_not_configured',
      cloudProcessing: Boolean(key), automaticCapture: false,
      databaseOpened: false, providerContacted: false,
      unverified: ['database-readiness', 'credential-validity', 'model-availability'],
    }, null, 2));
    return;
  }
  const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const { createCairnServer } = await import('./server.mjs');
  let model;
  if (env.OPENAI_API_KEY) {
    const { createOpenAIModel } = await import('../openai/index.mjs');
    model = createOpenAIModel({ apiKey: env.OPENAI_API_KEY });
  }
  let handle;
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void handle.close().catch(() => { console.error('cairn_mcp_close_failed'); })
      .finally(() => { process.stdin.destroy(); });
  };
  handle = serveStdio(() => createCairnServer({ ...config, model }), {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65536 }),
    onerror: () => { console.error('cairn_mcp_transport_error'); queueMicrotask(stop); },
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.stdin.once('end', stop);
  return handle;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await start(); }
  catch { console.error('cairn_mcp_start_failed: check documented startup arguments and dependencies'); process.exitCode = 1; }
}
