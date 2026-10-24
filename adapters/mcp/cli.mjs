import { pathToFileURL } from 'node:url';
import { assetCommand } from './asset-command.mjs';
import { methodCommand } from './method-package-command.mjs';
import { MethodStdioServerTransport } from './method-package-transport.mjs';
import { contextCommand } from './context-read-command.mjs';
// U5c-2 source startup wiring (SQLite-free).
import { CONTEXT_SOURCE_FLAG, contextSourcesConfiguration, contextSourcesPreset } from './context-read-sources-configuration.mjs';
import { CONTEXT_FLAGS, contextHostConfiguration } from './context-read-configuration.mjs';
import { createContextEmbedding } from './context-read-provider.mjs';
import { ContextStdioServerTransport } from './context-read-transport.mjs';
// U5c-1 host boundary: SQLite-free static modules.
import { roleProfileHostConfiguration, roleProfileCheckConfiguration } from './role-profile-configuration.mjs';
import { RoleProfileStdioServerTransport } from './role-profile-transport.mjs';
import { createContextCounter } from '../openai/context-counter.mjs';
import { identifier } from '../../core/validation.mjs';
import { DEFAULT_MODEL } from '../openai/profiles.mjs';
import { assertRetainedRuntime, retainedProfilePath } from './retained-raw-profile.mjs';

const help = `Cairn Memory — local stdio MCP developer preview

Usage:
  cairn-memory --db ABS --owner ID [--project ID] --context-read context-read-v1 [--context-read-personal]
    [--context-read-sources relations-one-hop-v1,moc-v1]
    [--context-embedder openai --context-embed-model MODEL --context-embed-dimensions N --context-embed-max-requests N --context-embed-max-usd X]
  cairn-memory context refresh --db ABS --owner ID [--project ID] --types memory,card --intent current|history --max-items N --max-ms T
    --context-embedder openai --context-embed-model MODEL --context-embed-dimensions N --context-embed-max-requests N --context-embed-max-usd X [--check-config]
  cairn-memory assets import|derive|delete|export [see docs/assets-local.md]
  cairn-memory --db ABS --owner ID [--project ID] --assets local-v1
  cairn-memory methods import|adopt|disable [method command arguments; see docs/method-packages-local.md]
  cairn-memory --db PATH --owner ID [--project ID] --method-packages local-v1 [--method-read-personal]
  cairn-memory --help
  cairn-memory [--check-config] --retained-raw-profile ABS
  cairn-memory review-card --retained-raw-profile ABS --card ID --revision N [--applicability current|historical|conflict|unknown]
  cairn-memory --check-config --db PATH --owner ID [--project ID]
  cairn-memory --db PATH --owner ID [--project ID] [--client KEY] [--session ID] [--read-client KEY]
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v1
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2 --capture-deadline-ms 120000
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2 --capture-evidence staged-v1
  cairn-memory --db PATH --owner ID [--project ID] --capture-evidence-access staged-v1
  cairn-memory --db PATH --owner ID [--project ID] --source-snapshot current-admitted-v1
  cairn-memory --db PATH --owner ID [--project ID] --recall-context source-evidence
  cairn-memory --db PATH --owner ID [--project ID] --classification-recovery guarded-v1
  cairn-memory --db PATH --owner ID [--project ID] --private-cards local-v1
  cairn-memory review-card --db PATH --owner ID [--project ID] --card ID --revision N [--applicability current|historical|conflict|unknown]
  cairn-memory --db PATH --owner ID [--project ID] --session-episodes-access episode-v1
  cairn-memory --db PATH --owner ID [--project ID] --capture-qualification source-bound-v2 --capture-evidence staged-v1 --session-episodes episode-v1 [--session-episodes-draft-batches 8]

Keep the database outside node_modules; its parent directory must exist.
Reuse the exact database, owner and project across sessions.
Normal startup waits for an MCP client on stdin; stdout is protocol-only.
Tools: remember_memory, recall_memory, inspect_memory, correct_memory, forget_memory.
--retained-raw-profile selects one existing private schema29 store and exact namespace.
It is exclusive, Linux/WSL + Node>=22.16, and keyless: it never inspects a model key.
It keeps the 22 private Card tools and adds list_raw_conversations,
read_raw_conversation and resolve_source_references. Raw capture stays off.
Draft from resolved Raw sources or existing Memory refs; confirmation still needs
the separate controlling-terminal review. --check-config does not read the profile.
--private-cards local-v1 adds bounded keyless private Card read/draft/cancel tools.
Drafting uses already retained Memory receipts (excerpt-only, unknown conversation
coverage), never automatic promotion, a provider or new source capture. MCP
confirmation always returns approval_required. The separate review-card command
shows the exact untrusted draft, bindings and scope on /dev/tty and requires typed
confirmation of its ID/revision. No --yes, environment or piped approval exists.
Local plaintext only; private confirmation is curation, not truth or publication.
The same opt-in adds select_evidence, fetch_evidence and revalidate_evidence for
bounded typed canonical reads. Literal word overlap is not semantic retrieval.
Current Card reads require eligible support and an explicit current review.
review-card --applicability records a separately displayed choice, bound into
the typed confirmation phrase. Omission preserves unknown applicability.
The same opt-in adds map_evidence, apply_card_placement, propose_evidence_mapping
and list_evidence_mappings for bounded typed navigation. Filing and mapping
proposals are organization, not evidence support or current applicability.
Mapping activation/refresh/removal requires a separate trusted host API; no MCP
tool can issue that explicit-user grant. Navigation introduces no model calls.
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
--session-episodes-access episode-v1 adds keyless episode reads and management,
including read_session_start_context with the local o200k_base tokenizer.
Access alone never enables capture, retention or interpretation. Explicit keep can
propose automatic procedural tags through normal episode-mode extraction.
--session-episodes episode-v1 requires source-bound-v2 qualification and staged-v1
evidence. It records generation configuration only, pending a trusted session producer;
submitted capture stays in legacy mode. --session-episodes-draft-batches defaults
to 8 and accepts integers 2..16 only with --session-episodes. No interpretation
model or producer is wired here. Reads never draft; selected episode passages
from a separately configured producer may persist until invalidation/deletion.
--client KEY and --session ID bind explicit receipt provenance at startup
(default cairn-local-mcp / explicit-tool). --read-client KEY restricts range
reads and episode-ID tools to one exact client; per-call client can only narrow.
Session-start context reads cross-client groups in the exact namespace.
--method-packages local-v1 adds nine keyless method read tools only. Method text is
untrusted data, never instructions or execution permission. A project server reads
personal methods only with --method-read-personal. Mutations require the separate
methods command and real controlling-terminal approval. Core results are bounded
to 65,536 bytes; MCP framing is bounded separately to 262,144 encoded bytes.
--assets local-v1 adds five metadata/derivative read tools in the exact startup namespace.
No MCP asset bytes or mutations. Startup upgrades the store one-way to v31.
--check-config checks syntax only: no database access or provider requests.
It cannot verify database permissions, credentials or model availability.
--context-read context-read-v1 adds find_memory_candidates and
fetch_memory_candidate_evidence only. Read sets are fixed at startup; personal
reads require project scope and --context-read-personal. Semantic defaults to false.
Only explicit context refresh embeds documents. All five provider options are
required together; a key alone never constructs an embedder. Hosted uses rrf-k10.
Context --check-config performs no key lookup, database opening or provider creation.
Sensitive sidecars invalidate logically, without secure physical erasure. Frozen
T1 intentionally misses an embedded single Han: 中 does not match 中文.
See docs/context-read-local.md for budgets, degraded states and non-claims.
`;

export function parseConfiguration(args) {
  const allowed = new Set(['--db', '--owner', '--project', '--capture-qualification', '--capture-rationale',
    '--capture-evidence', '--capture-evidence-access', '--source-snapshot', '--recall-context',
    '--classification-recovery', '--capture-deadline-ms', '--session-episodes-access',
    '--session-episodes', '--session-episodes-draft-batches', '--client', '--session', '--read-client', '--private-cards', '--retained-raw-profile', '--method-packages', '--assets', '--role-profiles', ...CONTEXT_FLAGS, CONTEXT_SOURCE_FLAG]);
  const values = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if(args[i]==='--method-read-personal'||args[i]==='--context-read-personal'){
      if(values.has(args[i]))throw Error('invalid_mcp_configuration');
      values.set(args[i],true);i--;continue;
    }
    if (!allowed.has(args[i]) || values.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('invalid_mcp_configuration');
    }
    values.set(args[i], args[i + 1]);
  }
  if (values.has('--retained-raw-profile')) {
    if (values.size !== 1 || !retainedProfilePath(values.get('--retained-raw-profile'))) throw new Error('invalid_mcp_configuration');
    return { retainedRawProfile: values.get('--retained-raw-profile') };
  }
  if (!values.get('--db') || !values.get('--owner')) throw new Error('invalid_mcp_configuration');
  identifier(values.get('--owner'));
  if (values.has('--project')) identifier(values.get('--project'));
  if (!values.get('--db').trim() || values.get('--db').includes('\0')) throw new Error('invalid_mcp_configuration');
  if(values.has('--method-packages')&&values.get('--method-packages')!=='local-v1'||values.has('--method-read-personal')&&(!values.has('--method-packages')||!values.has('--project')))throw Error('invalid_mcp_configuration');
  if(values.has('--assets')&&values.get('--assets')!=='local-v1')throw Error('invalid_mcp_configuration');
  const context = { ...contextHostConfiguration(values), ...contextSourcesConfiguration(values) };
  // U5c-1: never union independently configured read grants.
  if (values.has('--role-profiles')) roleProfileHostConfiguration({ roleProfiles: values.get('--role-profiles'),
    methodPackages: values.get('--method-packages'), methodReadPersonal: values.has('--method-read-personal'), ...context });
  if (values.has('--private-cards') && values.get('--private-cards') !== 'local-v1') throw new Error('invalid_mcp_configuration');
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
  if (values.has('--classification-recovery') && values.get('--classification-recovery') !== 'guarded-v1') {
    throw new Error('invalid_mcp_configuration');
  }
  for (const flag of ['--client', '--read-client']) {
    if (values.has(flag) && !/^[A-Za-z0-9._-]{1,64}$/.test(values.get(flag))) throw new Error('invalid_mcp_configuration');
  }
  if (values.has('--session')) identifier(values.get('--session'));
  if (values.has('--session-episodes-access') && values.get('--session-episodes-access') !== 'episode-v1') throw new Error('invalid_mcp_configuration');
  if (values.has('--session-episodes') && (values.get('--session-episodes') !== 'episode-v1' ||
      values.get('--capture-qualification') !== 'source-bound-v2' || values.get('--capture-evidence') !== 'staged-v1')) throw new Error('invalid_mcp_configuration');
  let draftEveryBatches = 8;
  if (values.has('--session-episodes-draft-batches')) {
    const raw = values.get('--session-episodes-draft-batches');
    if (!values.has('--session-episodes') || !/^(?:[2-9]|1[0-6])$/.test(raw)) throw new Error('invalid_mcp_configuration');
    draftEveryBatches = Number(raw);
  }
  return { path: values.get('--db'), namespace: { ownerId: values.get('--owner'),
    scope: values.has('--project') ? 'project' : 'personal', projectId: values.get('--project') ?? null },
    ...context,
    ...(values.has('--role-profiles') ? { roleProfiles: values.get('--role-profiles') } : {}),
    ...(values.has('--assets')?{assets:'local-v1'}:{}),
    ...(values.has('--method-packages')?{methodPackages:'local-v1'}:{}),
    ...(values.has('--method-read-personal')?{methodReadPersonal:true}:{}),
    ...(values.has('--private-cards') ? { privateCards: 'local-v1' } : {}),
    ...(values.has('--client') ? { client: values.get('--client') } : {}),
    ...(values.has('--session') ? { sessionId: values.get('--session') } : {}),
    ...(values.has('--read-client') ? { readClient: values.get('--read-client') } : {}),
    ...(values.has('--session-episodes-access') ? { sessionEpisodesAccess: 'episode-v1' } : {}),
    ...(values.has('--session-episodes') ? { sessionEpisodes: { mode: 'episode-v1', draftEveryBatches } } : {}),
    ...(values.has('--capture-qualification') ? { captureQualification: values.get('--capture-qualification') } : {}),
    ...(values.has('--capture-deadline-ms') ? { captureDeadlineMs } : {}),
    ...(values.has('--capture-rationale') ? { captureRationale: values.get('--capture-rationale') } : {}),
    ...(values.has('--capture-evidence') ? { captureEvidence: values.get('--capture-evidence') } : {}),
    ...(values.has('--capture-evidence-access') ? { captureEvidenceAccess: values.get('--capture-evidence-access') } : {}),
    ...(values.has('--source-snapshot') ? { sourceSnapshot: values.get('--source-snapshot') } : {}),
    ...(values.has('--recall-context') ? { recallContext: values.get('--recall-context') } : {}),
    ...(values.has('--classification-recovery') ? {
      classificationRecovery: values.get('--classification-recovery') } : {}) };
}

export async function start(args = process.argv.slice(2), env = process.env) {
  if (args.length === 1 && args[0] === '--help') { console.log(help); return; }
  if(args[0]==='assets')return assetCommand(args.slice(1));
  if(args[0]==='methods')return methodCommand(args.slice(1));
  if(args[0]==='context')return contextCommand(args.slice(1),env);
  if(args[0]==='--check-config'&&args[1]==='context')return contextCommand([...args.slice(2),'--check-config'],env);
  if (args[0] === 'review-card') {
    if (args.includes('--retained-raw-profile')) {
      const { reviewRetainedRawCard } = await import('./retained-raw.mjs');
      return reviewRetainedRawCard(args.slice(1));
    }
    const { reviewCard } = await import('./review-card.mjs');
    return reviewCard(args.slice(1));
  }
  const check = args[0] === '--check-config';
  const config = parseConfiguration(check ? args.slice(1) : args);
  if (config.retainedRawProfile) {
    assertRetainedRuntime();
    if (check) {
      console.log(JSON.stringify({ ok: true, mode: 'configuration-check',
        retainedRawProfile: 'local-raw-retained-profile-v1', privateCards: 'local-v1',
        cardConfirmation: 'separate-local-tty-required', modelKeyInspected: false,
        profileRead: false, databaseOpened: false, providerContacted: false,
        cloudProcessing: false, automaticCapture: false, recall: 'model_not_configured',
        unverified: ['profile-readiness', 'database-readiness'] }, null, 2));
      return;
    }
    const { prepareRetainedRawServer } = await import('./retained-raw.mjs');
    const factory = await prepareRetainedRawServer({ profilePath: config.retainedRawProfile });
    const stdio = await import('@modelcontextprotocol/server/stdio');
    return startStdio(factory, stdio);
  }
  if (check && config.contextRead) {
    console.log(JSON.stringify({ ok: true, mode: 'configuration-check', contextRead: config.contextRead,
      contextReadPersonal: config.contextReadPersonal ?? false,
      ...(config.roleProfiles ? roleProfileCheckConfiguration(config) : {}), scope: config.namespace.scope,
      provider: config.contextProvider ?? null, preset: contextSourcesPreset(config.contextReadSources, Boolean(config.contextProvider)),
      ...(config.contextReadSources ? { sources: config.contextReadSources } : {}),
      modelKeyInspected: false, databaseOpened: false, providerContacted: false, automaticCapture: false }));
    return;
  }
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
      ...(config.assets?{assets:config.assets,assetMutations:'separate-local-tty-required',assetBytes:'separate-local-export-only'}:{}),
      ...(config.methodPackages?{methodPackages:config.methodPackages,methodReadPersonal:config.methodReadPersonal??false,methodMutations:'separate-local-tty-required'}:{}),
      ...(config.privateCards ? { privateCards: 'local-v1', cardConfirmation: 'separate-local-tty-required',
        cardSourcePolicy: 'retained-receipts-v1' } : {}),
      ...(config.sessionEpisodesAccess || config.sessionEpisodes ? { sessionEpisodesAccess: 'episode-v1',
        sessionContextTokenizer: 'o200k_base', episodeGeneration: 'awaiting-trusted-session-producer',
        episodeGenerationEnabled: false } : {}),
      ...(config.sessionEpisodes ? { sessionEpisodes: config.sessionEpisodes } : {}),
      ...(config.readClient ? { readClient: config.readClient } : {}),
      ...(config.recallContext ? { recallContext: config.recallContext } : {}),
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
  // Context's local tokenizer is independent of the legacy model and check mode.
  let contextCounter;
  if (config.contextRead) {
    try { contextCounter = await createContextCounter(); }
    catch {
      console.error('cairn_context_tokenizer_unavailable: check the documented tiktoken runtime dependency');
      throw Error('context_tokenizer_unavailable');
    }
  }
  const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const { createCairnServer } = await import('./server.mjs');
  let model;
  if (env.OPENAI_API_KEY) {
    const { createOpenAIModel } = await import('../openai/index.mjs');
    model = createOpenAIModel({ apiKey: env.OPENAI_API_KEY });
  } else if (config.sourceSnapshot || config.sessionEpisodesAccess || config.sessionEpisodes) {
    const { countOpenAITokens } = await import('../openai/index.mjs');
    model = { countTokens: countOpenAITokens };
  }
  const { contextProvider, ...serverConfiguration } = config;
  const contextEmbedding = createContextEmbedding(contextProvider,env);
  const Transport=config.roleProfiles?RoleProfileStdioServerTransport:config.contextRead?ContextStdioServerTransport:(config.methodPackages||config.assets)?MethodStdioServerTransport:StdioServerTransport;
  return startStdio(() => createCairnServer({ ...serverConfiguration, model, ...(contextCounter ? { contextCounter } : {}), ...(contextEmbedding?{contextEmbedding}:{}) }),
    { serveStdio, StdioServerTransport:Transport },config.methodPackages||config.assets||config.contextRead?262144:65536);
}

function startStdio(factory, { serveStdio, StdioServerTransport },maxBufferSize=65536) {
  let handle;
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void handle.close().catch(() => { console.error('cairn_mcp_close_failed'); })
      .finally(() => { process.stdin.destroy(); });
  };
  handle = serveStdio(factory, {
    transport: new StdioServerTransport(process.stdin, process.stdout, { maxBufferSize }),
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
