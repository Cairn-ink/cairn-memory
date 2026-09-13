import { pathToFileURL } from 'node:url';
import { identifier } from '../../core/validation.mjs';
import { DEFAULT_MODEL } from '../openai/profiles.mjs';

const help = `Cairn Memory — local stdio MCP developer preview

Usage:
  cairn-memory --help
  cairn-memory --check-config --db PATH --owner ID [--project ID]
  cairn-memory --db PATH --owner ID [--project ID]
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v1
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2

Keep the database outside node_modules; its parent directory must exist.
Reuse the exact database, owner and project across sessions.
Normal startup waits for an MCP client on stdin; stdout is protocol-only.
Tools: remember_memory, recall_memory, inspect_memory, correct_memory, forget_memory.
Remember saves explicit content, not automatically extracted conversations.
--capture-qualification source-bound-v1 or source-bound-v2 adds capture_memory for explicitly
submitted messages. No background capture or hooks are installed. Submitted
roles/text are claims, not authenticated human intent. Qualification binds
source text, not semantic truth; incompatible active memories may remain.
Semantic recall and opted-in capture need OPENAI_API_KEY in the process
environment (never arguments). They send selected text to OpenAI and may incur
charges; no account spending cap is enforced. Inspection (including source
qualification), explicit remember, correction and forgetting remain keyless.
V2 uses core-owned source candidates; v1 retains model-written source anchors.
Neither mode proves meaning, resolves currentness or grants update authority.
--capture-rationale source-bound-v1 requires --capture-qualification source-bound-v2.
It attempts proposed rationale after saving/classification and adds keyless inspect_rationale.
Check the separate rationale status; duplicate batches do not repeat this pass.
Allow at least 180 seconds for opted-in capture (four bounded model stages).
recall_memory contextMode rationale-evidence includes linked unverified evidence.
Save only on actual user intent. Remembered consent is not execution authority.
--check-config checks syntax only: no database access or provider requests.
It cannot verify database permissions, credentials or model availability.
`;

export function parseConfiguration(args) {
  const allowed = new Set(['--db', '--owner', '--project', '--capture-qualification', '--capture-rationale']);
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
  if (values.has('--capture-qualification')
    && !['source-bound-v1', 'source-bound-v2'].includes(values.get('--capture-qualification'))) {
    throw new Error('invalid_mcp_configuration');
  }
  if (values.has('--capture-rationale') && (values.get('--capture-rationale') !== 'source-bound-v1' ||
      values.get('--capture-qualification') !== 'source-bound-v2')) throw new Error('invalid_mcp_configuration');
  return { path: values.get('--db'), namespace: { ownerId: values.get('--owner'),
    scope: values.has('--project') ? 'project' : 'personal', projectId: values.get('--project') ?? null },
    ...(values.has('--capture-qualification') ? { captureQualification: values.get('--capture-qualification') } : {}),
    ...(values.has('--capture-rationale') ? { captureRationale: values.get('--capture-rationale') } : {}) };
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
      ...(config.captureQualification ? { captureQualification: config.captureQualification,
        capture: key ? 'configured-not-verified' : 'model_not_configured',
        qualificationModel: key ? DEFAULT_MODEL : null } : {}),
      databaseOpened: false, providerContacted: false,
      ...(config.captureRationale ? { captureRationale: config.captureRationale,
        rationale: key ? 'configured-not-verified' : 'model_not_configured' } : {}),
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
