#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const stub = process.env.RMC_STUB === '1';
const key = stub ? 'synthetic-model-check' : process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API_KEY;

const modelName = 'gpt-4.1-mini-2025-04-14';
const embeddingName = 'text-embedding-3-small';
const limits = { costNanodollars: 40_000_000, modelCalls: 20 };
const rates = { input: 400, cached: 100, output: 1600, embedding: 20 };
const requiredResponses = 2;
const correction = 'Correction: The Amaranth inventory now lives in the red cabinet beside the door.';

function emptyMetrics() {
  return {
    fetchCount: 0, processesStarted: 0,
    requestsByEndpoint: { 'responses/input_tokens': 0, responses: 0, embeddings: 0 },
    endpoints: Object.fromEntries(['responses/input_tokens', 'responses', 'embeddings']
      .map(endpoint => [endpoint, { accepted: 0, refusedByErrorCode: {} }])),
    modelOutputs: { accepted: 0, refusedByErrorCode: {} }, responseStages: {},
    totalCostUsd: 0, stops: { spend: false, modelCalls: false },
  };
}

function installFetchGuard(config, fs, cp, syncBuiltinESMExports, source) {
  const { metricsPath, mode, limits, rates, modelName, embeddingName, correction } = config;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  const priced = new Map();
  let cost = 0, calls = 0, accountingLost = false;
  let turn = Promise.resolve();
  function update(change) {
    const counts = JSON.parse(fs.readFileSync(metricsPath, 'utf8'));
    change(counts);
    const next = metricsPath + '.' + process.pid + '.tmp';
    fs.writeFileSync(next, JSON.stringify(counts) + '\n', { mode: 0o600 });
    fs.renameSync(next, metricsPath);
  }
  update(counts => counts.processesStarted++);

  // Keep the extra import out of the installed daemon's launch identity.
  const flag = process.execArgv.indexOf(source);
  if (flag > 0 && process.execArgv[flag - 1] === '--import') process.execArgv.splice(flag - 1, 2);
  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'fork']) {
    const original = cp[name];
    cp[name] = (...args) => {
      if (mode !== 'keyless') refusal('unexpected_model_child');
      const options = args[Array.isArray(args[1]) ? 2 : 1];
      if (Object.hasOwn(options?.env ?? process.env, 'OPENAI_API_KEY')) refusal('credential_child');
      if (name === 'spawn' && args[1]?.[0]?.endsWith('/daemon-worker.mjs')) {
        args[1] = ['--import', source, ...args[1]];
      }
      return original(...args);
    };
  }
  syncBuiltinESMExports();

  const integer = number => Number.isSafeInteger(number) && number >= 0;
  function refusal(code, stop, endpoint) {
    update(counts => {
      const totals = counts.modelOutputs.refusedByErrorCode;
      totals[code] = (totals[code] ?? 0) + 1;
      const perEndpoint = counts.endpoints[endpoint]?.refusedByErrorCode;
      if (perEndpoint) perEndpoint[code] = (perEndpoint[code] ?? 0) + 1;
      if (stop) counts.stops[stop] = true;
    });
    throw new Error(code);
  }
  function maximumCost(endpoint, body) {
    if (endpoint === 'embeddings' && body.model === embeddingName && body.dimensions === 1536 && Array.isArray(body.input) &&
        body.input.length > 0 && body.input.every(text => typeof text === 'string')) {
      return body.input.reduce((sum, text) => sum + Buffer.byteLength(text) + 16, 0) * rates.embedding;
    }
    if (endpoint === 'responses' && body.model === modelName && body.store === false && body.stream === false &&
        integer(body.max_output_tokens)) {
      const { max_output_tokens, store, stream, ...request } = body;
      const signature = JSON.stringify(request), input = priced.get(signature);
      priced.delete(signature);
      if (integer(input)) return input * rates.input + max_output_tokens * rates.output;
    }
    if (endpoint === 'responses/input_tokens' && body.model === modelName) return 0;
    return null;
  }
  function usedCost(endpoint, payload) {
    const usage = payload?.usage;
    if (endpoint === 'embeddings' && integer(usage?.total_tokens)) return usage.total_tokens * rates.embedding;
    const input = usage?.input_tokens, cached = usage?.input_tokens_details?.cached_tokens ?? 0, output = usage?.output_tokens;
    if (endpoint === 'responses' && [input, cached, output].every(integer) && cached <= input) {
      return (input - cached) * rates.input + cached * rates.cached + output * rates.output;
    }
    return null;
  }
  function stubResponse(endpoint, body) {
    if (endpoint === 'responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 50 });
    if (endpoint === 'responses') {
      // Match capture.mjs and routing/amendments.mjs, using the ID in the real request.
      const stage = body.text?.format?.name;
      const input = JSON.parse(body.input[0].content[0].text);
      let result;
      switch (stage) {
        case 'extract_memories': result = { items: [] }; break;
        case 'detect_changes': {
          const cardId = /\[([^\]\n]+)\] date [^\n]+\nfirst line: Amaranth workshop checklist/u.exec(input)?.[1];
          result = { changes: cardId && input.includes(correction) ? [{ card_id: cardId, quote: correction,
            new_value: 'red cabinet beside the door' }] : [] };
          break;
        }
        case 'verify_change': result = { applies: true, line: 'The Amaranth inventory is in the red cabinet beside the door.' }; break;
        default: throw new Error('unknown_stub_stage');
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed', usage: {
        input_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens: 40,
      }, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] });
    }
    const embedding = [1, ...Array(body.dimensions - 1).fill(0)];
    return Response.json({ object: 'list', model: body.model, usage: { total_tokens: body.input.length * 10 },
      data: body.input.map((_, index) => ({ index, embedding })) });
  }
  function outputCode(endpoint, payload, body) {
    if (endpoint === 'embeddings') {
      const data = payload?.data;
      const indices = new Set();
      const valid = payload?.object === 'list' && payload.model === embeddingName &&
        Array.isArray(data) && data.length === body.input.length && data.every(row => {
          if (!integer(row?.index) || row.index >= data.length || indices.has(row.index)) return false;
          indices.add(row.index);
          const vector = row.embedding;
          if (!Array.isArray(vector) || vector.length !== 1536 || !vector.every(Number.isFinite)) return false;
          const norm = Math.sqrt(vector.reduce((sum, number) => sum + number ** 2, 0));
          return norm >= 0.9 && norm <= 1.1;
        });
      return valid ? null : 'embedding_failed';
    }
    if (payload?.object !== 'response' || payload.model !== modelName || payload.status !== 'completed' ||
        !Array.isArray(payload.output)) return 'invalid_model_output';
    const chunks = [];
    for (const message of payload.output) {
      if (message?.type !== 'message' || message.role !== 'assistant' || !Array.isArray(message.content)) return 'invalid_model_output';
      for (const item of message.content) {
        if (item?.type !== 'output_text' || typeof item.text !== 'string') return 'invalid_model_output';
        chunks.push(item.text);
      }
    }
    try { JSON.parse(chunks.join('')); }
    catch { return 'invalid_model_output'; }
    return null;
  }
  async function request(url, options) {
    const base = 'https://api.openai.com/v1/';
    const endpoint = typeof url === 'string' && url.startsWith(base) ? url.slice(base.length) : '';
    const refuse = (code, stop) => refusal(code, stop, endpoint);
    if (mode === 'keyless') refuse('keyless_fetch');
    if (accountingLost) refuse('usage_unavailable');
    const counted = endpoint === 'responses/input_tokens';
    if ((!counted && endpoint !== 'responses' && endpoint !== 'embeddings') ||
        options?.method !== 'POST' || options.redirect !== 'error') refuse('unexpected_request');
    if (cost >= limits.costNanodollars) refuse('spend_cap', 'spend');
    if (!counted && calls >= limits.modelCalls) refuse('model_call_cap', 'modelCalls');
    let body;
    try { body = JSON.parse(options.body); }
    catch { refuse('invalid_request'); }
    if (!body || typeof body !== 'object') refuse('invalid_request');
    const quoted = maximumCost(endpoint, body);
    if (quoted === null) refuse('unpriced_request');
    if (cost + quoted > limits.costNanodollars) refuse('spend_cap', 'spend');
    options.signal?.throwIfAborted();
    if (!counted) calls++;
    update(counts => counts.requestsByEndpoint[endpoint]++);
    let response, payload;
    try { response = mode === 'stub' ? stubResponse(endpoint, body) : await nativeFetch(url, options); }
    catch {
      if (!counted) accountingLost = true;
      refuse('provider_error');
    }
    if (!response.ok) {
      if (!counted && response.status !== 429) accountingLost = true;
      refuse(response.status === 429 ? 'rate_limited' : 'provider_error');
    }
    try { payload = await response.clone().json(); }
    catch {
      if (!counted) accountingLost = true;
      refuse('usage_unavailable');
    }
    if (counted) {
      if (payload?.object !== 'response.input_tokens' || !integer(payload.input_tokens)) refuse('token_count_unavailable');
      priced.set(JSON.stringify(body), payload.input_tokens);
      update(counts => counts.endpoints[endpoint].accepted++);
      return response;
    }
    const charged = usedCost(endpoint, payload);
    if (charged === null) {
      accountingLost = true;
      refuse('usage_unavailable');
    }
    cost += charged;
    update(counts => {
      counts.totalCostUsd = cost / 1e9;
      if (cost >= limits.costNanodollars) counts.stops.spend = true;
    });
    if (charged > quoted) {
      accountingLost = true;
      refuse('usage_over_reservation');
    }
    const code = outputCode(endpoint, payload, body);
    if (code) refuse(code);
    update(counts => {
      counts.endpoints[endpoint].accepted++;
      counts.modelOutputs.accepted++;
      if (endpoint === 'responses') {
        const name = body.text?.format?.name ?? 'unstructured';
        counts.responseStages[name] = (counts.responseStages[name] ?? 0) + 1;
      }
    });
    return response;
  }
  globalThis.fetch = (url, options) => {
    // Close the race between two sends and the first response's usage.
    const result = turn.then(() => {
      update(counts => counts.fetchCount++);
      return request(url, options);
    });
    turn = result.catch(() => {});
    return result;
  };
}

function preload(directory, mode, label = mode) {
  const metricsPath = join(directory, label + '-counts.json');
  const source = join(directory, label + '-fetch.mjs');
  writeFileSync(metricsPath, JSON.stringify(emptyMetrics()) + '\n', { mode: 0o600 });
  const config = JSON.stringify({ metricsPath, mode, limits, rates, modelName, embeddingName, correction });
  writeFileSync(source, `
import fs from 'node:fs';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
(${installFetchGuard.toString()})(${config}, fs, cp, syncBuiltinESMExports, fileURLToPath(import.meta.url));
`, { mode: 0o600 });
  return { source, read: () => JSON.parse(readFileSync(metricsPath, 'utf8')) };
}

const questions = [
  'Where is the Amaranth workshop inventory?',
  'What does the Borealis crew check before opening?',
  'Where does the Cinnabar crew copy the map?',
  'What is in the Limestone observatory?',
  'What does the Quartz crew use to label crates?',
];
const facts = [
  'The Limestone observatory has a paper star chart beside the window.',
  'The Quartz crew uses copper tags to label crates.',
  'The Redwood courier carries a violet notebook.',
];

async function ask(tool, rows) {
  for (const question of questions) {
    const answer = await tool('read_memory_context', { query: question, types: ['memory', 'card'], intent: 'current' });
    if (!answer.ok || !Array.isArray(answer.value?.items)) throw new Error('read_failed');
    const items = answer.value.items;
    rows.push({ question, cards: items.filter(item => item.ref?.type === 'card').length,
      memories: items.filter(item => item.ref?.type === 'memory').length });
  }
}

async function probeRecall(tool, report) {
  for (const query of questions.slice(0, requiredResponses)) {
    const answer = await tool('recall_memory', { query });
    if (answer.ok) {
      report.delivered++;
      report.memories += answer.value?.items?.length ?? 0;
    } else {
      const code = answer.error?.code ?? 'unknown_tool_error';
      report.refusedByErrorCode[code] = (report.refusedByErrorCode[code] ?? 0) + 1;
    }
  }
}

function recordNativeCorrection(f, entry, source) {
  const readJSON = path => JSON.parse(readFileSync(path, 'utf8'));
  const { cutover } = readJSON(join(f.root, 'installation.json')).migration;
  const { generation } = readJSON(join(f.root, '.cutover-' + cutover.id, 'capture-claude.json'));
  const installation = join(f.root, 'capture', 'claude', 'core-' + generation);
  const session = randomUUID();
  const transcript = join(f.home, '.claude', 'projects', session + '.jsonl');
  const hook = event => {
    const child = spawnSync(process.execPath, ['--import', source, join(dirname(entry), 'capture-cli.mjs'),
      'hook', '--installation', installation, '--event', event], {
      cwd: f.parent, env: f.environment, stdio: ['pipe', 'ignore', 'ignore'],
      input: JSON.stringify({ hook_event_name: event, session_id: session, transcript_path: transcript }),
      timeout: 45_000, killSignal: 'SIGKILL',
    });
    if (child.status !== 0) throw new Error('capture_failed');
  };
  writeFileSync(transcript, '', { mode: 0o600 });
  hook('SessionStart');
  writeFileSync(transcript, JSON.stringify({ type: 'user', uuid: randomUUID(), promptSource: 'typed',
    timestamp: '2025-02-05T00:00:00.000Z', message: { content: [{ type: 'text', text: correction }] },
  }) + '\n', { mode: 0o600 });
  hook('Stop');
}

function stageBuildNode(directory, cache) {
  mkdirSync(directory, { mode: 0o700 });
  const node = join(directory, 'node');
  try { linkSync(process.execPath, node); }
  catch (error) {
    if (error.code !== 'EXDEV') throw error;
    copyFileSync(process.execPath, node);
  }
  const cli = pathToFileURL(realpathSync(join(dirname(process.execPath), 'npm'))).href;
  // The generator invokes npm with a fresh environment. Supply its default
  // cache through the scratch-local executable it resolves beside Node.
  writeFileSync(join(directory, 'npm'), `#!${node}
process.env.npm_config_cache ??= ${JSON.stringify(cache)};
import(${JSON.stringify(cli)}).catch(() => { process.exitCode = 1; });
`, { mode: 0o700 });
  return node;
}

async function run(repo, scratch, report) {
  let phase = 'workspace';
  const copy = join(scratch, 'source');
  const home = join(scratch, 'home');
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(copy, { mode: 0o700 });
  const temp = join(scratch, 'tmp');
  mkdirSync(temp, { mode: 0o700 });
  const safeEnv = { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: home, TMPDIR: temp, TMP: temp, TEMP: temp,
    XDG_CONFIG_HOME: home, LANG: 'C.UTF-8', npm_config_cache: join(temp, 'npm-cache') };
  const original = new Map(Object.keys(safeEnv).map(name => [name, process.env[name]]));
  Object.assign(process.env, safeEnv);
  let keyed, control, capture;
  try {
    for (const name of ['LICENSE', 'SEAM.md', 'core', 'adapters', 'docs', 'evaluation', 'integrations', 'packaging', 'packages', 'plugins', 'tools']) {
      cpSync(join(repo, name), join(copy, name), { recursive: true, filter: path =>
        basename(path) !== 'node_modules' && basename(path) !== '.git' && !lstatSync(path).isSymbolicLink() });
    }
    phase = 'build';
    const buildNode = stageBuildNode(join(scratch, 'build-bin'), safeEnv.npm_config_cache);
    const build = spawnSync(buildNode, [join(copy, 'packages/setup/build-runtime.mjs')], {
      cwd: copy, env: safeEnv, stdio: 'ignore', timeout: 180_000, killSignal: 'SIGKILL',
    });
    report.buildExit = build.status;
    if (build.status !== 0) throw new Error('build_failed');
    phase = 'install';
    const fixture = await import(pathToFileURL(join(copy, 'tools/testing/local-cutover-keyed-fixture.mjs')));
    keyed = preload(scratch, stub ? 'stub' : 'live');
    control = preload(scratch, 'keyless');
    capture = preload(scratch, 'keyless', 'capture');
    await fixture.withUpgradeInstallers(async installers => {
      phase = 'legacy_seed';
      const { f, source, legacy } = await fixture.legacyKeyedFixture(installers, 'real-model');
      phase = 'consent';
      await fixture.setupInstalledConsent(installers, f, key);
      phase = 'confirm';
      const { entry, database } = fixture.confirmInstalledUpgrade(installers, f, source, legacy);
      await fixture.withInstalledMcp(f, async tool => {
        phase = 'remember';
        for (const content of facts) {
          if (!(await tool('remember_memory', { content })).ok) throw new Error('remember_failed');
          report.newMemories++;
        }
        phase = 'card_maintenance';
        fixture.buildInstalledDocumentCards(f, entry);
        report.documentCardsBuilt = fixture.scalar(database, 'SELECT count(*) FROM cairn_document_cards');
        if (report.documentCardsBuilt !== 3) throw new Error('card_build_failed');
        phase = 'native_correction';
        const rawCount = () => fixture.scalar(database, 'SELECT count(*) FROM cairn_raw_messages');
        const before = rawCount();
        recordNativeCorrection(f, entry, capture.source);
        report.nativeCorrection.rawMessages = rawCount() - before;
        report.nativeCorrection.amendments = fixture.scalar(database, 'SELECT count(*) FROM cairn_document_card_amendments');
        if (report.nativeCorrection.rawMessages !== 1) throw new Error('correction_not_captured');
        phase = 'recall_tool';
        await probeRecall(tool, report.recallTool);
        phase = 'keyed_read';
        await ask(tool, report.questions);
      }, { key, preload: keyed.source });
      phase = 'copy_control';
      fixture.copyStoreForControl(f, database);
      phase = 'keyless_read';
      try {
        await fixture.withInstalledMcp(f, tool => ask(tool, report.keylessControl.questions), { preload: control.source });
      } finally {
        f.run(installers.candidate, ['daemon', 'stop', '--local']);
      }
      phase = 'telemetry';
      const { fetchCount, endpoints } = keyed.read();
      if (control.read().fetchCount !== 0 || capture.read().fetchCount !== 0 || fetchCount === 0) {
        throw new Error('unexpected_fetch_count');
      }
      report.workflowCompleted = true;
      phase = 'recall_model_coverage';
      if (endpoints.responses.accepted < requiredResponses) throw new Error('recall_model_coverage');
    });
    report.completed = true;
  } catch {
    report.failureStage = phase;
    process.exitCode = 1;
  } finally {
    if (keyed) Object.assign(report, keyed.read());
    if (control) Object.assign(report.keylessControl, control.read());
    if (capture) Object.assign(report.nativeCorrection, capture.read());
    for (const [name, value] of original) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function workspaceAt(path) {
  const root = realpathSync(path);
  if (root !== '/tmp' && !/^\/tmp\/cairn-i8d-(?:flip|fix3b)-[\w.-]+(?:\/|$)/u.test(root)) throw new Error('scratch_outside_tmp');
  return mkdtempSync(join(root, 'cairn-i8d-fix3b-'));
}

let scratch;
try {
  if (process.argv.length !== 5) throw new Error('arguments');
  if (typeof key !== 'string' || !key.trim() || /[\r\n\0]/u.test(key)) throw new Error('credential');
  const repo = realpathSync(process.argv[2]);
  const output = resolve(process.argv[4]);
  scratch = workspaceAt(process.argv[3]);
  const outputRelative = relative(scratch, output);
  if (!outputRelative || (!outputRelative.startsWith('..' + '/') && !isAbsolute(outputRelative))) {
    throw new Error('output_in_owned_scratch');
  }
  const report = { mode: stub ? 'stub' : 'live', completed: false, workflowCompleted: false, requiredResponses,
    newMemories: 0, documentCardsBuilt: 0, recallTool: { delivered: 0, memories: 0, refusedByErrorCode: {} }, questions: [],
    nativeCorrection: { rawMessages: 0, amendments: 0, ...emptyMetrics() },
    keylessControl: { questions: [], ...emptyMetrics() }, ...emptyMetrics() };
  await run(repo, scratch, report);
  writeFileSync(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
} catch {
  process.stderr.write('real_model_check_failed\n');
  process.exitCode = 1;
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
