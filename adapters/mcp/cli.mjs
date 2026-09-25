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
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2 --capture-deadline-ms 120000
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2 --capture-evidence staged-v1
  cairn-memory --db PATH --owner ID [--project ID] --capture-evidence-access staged-v1
  cairn-memory --db PATH --owner ID [--project ID] --source-snapshot current-admitted-v1
  cairn-memory --db PATH --owner ID [--project ID] --recall-context source-evidence
  cairn-memory --db PATH --owner ID [--project ID] --source-candidate-policy bounded-keyset-v1
  cairn-memory --db PATH --owner ID [--project ID] --classification-recovery guarded-v1

Keep the database outside node_modules; its parent directory must exist.
Reuse the exact database, owner and project across sessions.
Normal startup waits for an MCP client on stdin; stdout is protocol-only.
Tools: remember_memory, recall_memory, inspect_memory, correct_memory, forget_memory.
--classification-recovery guarded-v1 adds classify_unfiled_memories for an
explicit request with inspected current unfiled memory IDs and revisions. It
sends bounded memory content to the configured model and may incur charges.
It does not rerun capture, prove failed-batch provenance, establish truth or
make every memory filed. It is independent of capture settings and remains
keyless for inspection; an actual classification call needs OPENAI_API_KEY.
Remember saves explicit content, not automatically extracted conversations.
--source-snapshot current-admitted-v1 adds keyless read_memory_sources using the
local o200k_base tokenizer, with zero provider calls. It reads the whole small
current-admitted source set, including potentially unrelated personal content.
Default 6/max 12 memories; default/max 4000 tokens and 24000 UTF-8 bytes apply to
the core success envelope, not MCP framing or the host's whole prompt. Oversize
fails without partial results or fallback. Sources are not full conversation
history, relevance, truth, current applicability or execution authority.
Semantic recall and capture still require a separately configured model.
--recall-context source-evidence makes source-only recall the default for this
server. It returns complete retained receipts instead of generated summaries
or qualifications within existing namespace and budgets. Per-call contextMode
overrides it; explicit includeQualification true conflicts with source mode.
This does not enable capture, prove source truth or currentness, or make recall
work without a configured model. Complete excerpts may expose more source text.
--source-candidate-policy bounded-keyset-v1 is an experimental opt-in for
source-evidence and rationale-evidence recall only. It examines a larger local
authorized source prefix (up to 20,000 current memories), scores body plus the
first four retained receipts, and keeps at most 1,024 candidates. Default/body
recall and model-facing bounds do not grow. This is not a semantic guarantee.
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
--capture-deadline-ms 1..120000 requires --capture-qualification
source-bound-v1 or source-bound-v2.
It applies one cooperative monotonic budget to each submitted capture, not to
other tools or server lifetime. It is not a hard return guarantee or API spend cap.
Admission can commit before classification. Opt into --classification-recovery
guarded-v1 to inspect the batch before any explicit classification request.
No capture, classification or rationale stage is automatically retried.
--capture-evidence staged-v1 requires --capture-qualification source-bound-v2.
It retains bounded submitted sources locally for 24 hours, including failed capture:
up to 24 messages of 800 UTF-16 units, 128KiB per event, 64 payloads/1MiB per namespace.
Staging adds keyless inspect_capture_evidence and discard_capture_evidence.
--capture-evidence-access staged-v1 adds only those management tools; it does not
enable retention, qualification, model work or automatic capture. Both modes can
start without a key. Inspection exposes untrusted sources, not truth or authority.
Live identical batches report processing; admitted duplicates do not rerun models.
Failed, expired, discarded or forgotten staged batches are closed, even after staging
is disabled. Inspect or discard them; never use fresh batch IDs to bypass closure.
Successful correction or forgetting clears ALL staged payloads in the exact configured
namespace, even with staging disabled; other admitted memories remain. Discarding a
stage does not forget an admitted memory. Retention is not an archive, a semantic
quality guarantee or physical erasure; local journals and backups may retain copies.
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
  const allowed = new Set(['--db', '--owner', '--project', '--capture-qualification', '--capture-rationale',
    '--capture-evidence', '--capture-evidence-access', '--source-snapshot', '--recall-context',
    '--classification-recovery', '--capture-deadline-ms', '--source-candidate-policy']);
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
  if (!values.get('--db').trim() || values.get('--db').includes('\0')) throw new Error('invalid_mcp_configuration');
  if (values.has('--capture-qualification')
    && !['source-bound-v1', 'source-bound-v2'].includes(values.get('--capture-qualification'))) {
    throw new Error('invalid_mcp_configuration');
  }
  let captureDeadlineMs;
  if (values.has('--capture-deadline-ms')) {
    const raw = values.get('--capture-deadline-ms');
    if (!values.has('--capture-qualification') || !/^[1-9][0-9]*$/u.test(raw)) {
      throw new Error('invalid_mcp_configuration');
    }
    captureDeadlineMs = Number(raw);
    if (!Number.isSafeInteger(captureDeadlineMs) || captureDeadlineMs > 120_000) {
      throw new Error('invalid_mcp_configuration');
    }
  }
  if (values.has('--capture-rationale') && (values.get('--capture-rationale') !== 'source-bound-v1' ||
      values.get('--capture-qualification') !== 'source-bound-v2')) throw new Error('invalid_mcp_configuration');
  if (values.has('--capture-evidence') && (values.get('--capture-evidence') !== 'staged-v1' ||
      values.get('--capture-qualification') !== 'source-bound-v2')) throw new Error('invalid_mcp_configuration');
  if (values.has('--capture-evidence-access') && values.get('--capture-evidence-access') !== 'staged-v1') {
    throw new Error('invalid_mcp_configuration');
  }
  if (values.has('--source-snapshot') && values.get('--source-snapshot') !== 'current-admitted-v1') {
    throw new Error('invalid_mcp_configuration');
  }
  if (values.has('--recall-context') && values.get('--recall-context') !== 'source-evidence') {
    throw new Error('invalid_mcp_configuration');
  }
  if (values.has('--source-candidate-policy') && values.get('--source-candidate-policy') !== 'bounded-keyset-v1') {
    throw new Error('invalid_mcp_configuration');
  }
  if (values.has('--classification-recovery') && values.get('--classification-recovery') !== 'guarded-v1') {
    throw new Error('invalid_mcp_configuration');
  }
  return { path: values.get('--db'), namespace: { ownerId: values.get('--owner'),
    scope: values.has('--project') ? 'project' : 'personal', projectId: values.get('--project') ?? null },
    ...(values.has('--capture-qualification') ? { captureQualification: values.get('--capture-qualification') } : {}),
    ...(values.has('--capture-deadline-ms') ? { captureDeadlineMs } : {}),
    ...(values.has('--capture-rationale') ? { captureRationale: values.get('--capture-rationale') } : {}),
    ...(values.has('--capture-evidence') ? { captureEvidence: values.get('--capture-evidence') } : {}),
    ...(values.has('--capture-evidence-access') ? { captureEvidenceAccess: values.get('--capture-evidence-access') } : {}),
    ...(values.has('--source-snapshot') ? { sourceSnapshot: values.get('--source-snapshot') } : {}),
    ...(values.has('--recall-context') ? { recallContext: values.get('--recall-context') } : {}),
    ...(values.has('--source-candidate-policy') ? { sourceCandidatePolicy: values.get('--source-candidate-policy') } : {}),
    ...(values.has('--classification-recovery') ? {
      classificationRecovery: values.get('--classification-recovery') } : {}) };
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
      ...(config.recallContext ? { recallContext: config.recallContext } : {}),
      ...(config.sourceCandidatePolicy ? { sourceCandidatePolicy: config.sourceCandidatePolicy } : {}),
      ...(config.sourceSnapshot ? { sourceSnapshot: config.sourceSnapshot,
        sourceSnapshotTokenizer: 'o200k_base' } : {}),
      ...(config.captureQualification ? { captureQualification: config.captureQualification,
        capture: key ? 'configured-not-verified' : 'model_not_configured',
        qualificationModel: key ? DEFAULT_MODEL : null } : {}),
      ...(Object.hasOwn(config, 'captureDeadlineMs') ? { captureDeadlineMs: config.captureDeadlineMs } : {}),
      ...(config.classificationRecovery ? { classificationRecovery: config.classificationRecovery,
        classification: key ? 'configured-not-verified' : 'model_not_configured' } : {}),
      databaseOpened: false, providerContacted: false,
      ...(config.captureRationale ? { captureRationale: config.captureRationale,
        rationale: key ? 'configured-not-verified' : 'model_not_configured' } : {}),
      ...(config.captureEvidence ? { captureEvidence: config.captureEvidence } : {}),
      ...(config.captureEvidence || config.captureEvidenceAccess ? {
        captureEvidenceAccess: 'staged-v1', stagedRetentionEnabled: Boolean(config.captureEvidence),
      } : {}),
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
  } else if (config.sourceSnapshot) {
    const { countOpenAITokens } = await import('../openai/index.mjs');
    model = { countTokens: countOpenAITokens };
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
