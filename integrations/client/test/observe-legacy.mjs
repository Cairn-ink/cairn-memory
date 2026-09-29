// Synthetic observations shared by the frozen-baseline generator and parity tests.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const key = '12345678-1234-4234-8234-123456789abc';
const session = 'synthetic-session/中文';
const generation = '11111111-1111-4111-8111-111111111111';
// Assemble synthetic credentials at runtime so source scanners do not flag them.
const secrets = [
  [
    ['sk', 'abcdefghijklmnopqrstuv'].join('-'),
    ['rk', 'abcdefghijklmnop'].join('-'),
    ['pk', 'abcdefghijklmnop'].join('-'),
  ].join(' '),
  [
    ['crn', 'pat', '0123456789abcdef0123456789abcdef'].join('_'),
    ['ghp', 'abcdefghijklmnopqrstuv'].join('_'),
  ].join(' '),
  ['AKIA' + 'ABCDEFGHIJKLMNOP', ['Bearer', 'syntheticBearer12345'].join(' ')].join(' '),
  ['eyJabcdefghijk', 'abcdefghijklm', 'abcdefghijklm'].join('.'),
  '-----BEGIN RSA ' + 'PRIVATE KEY-----\nsynthetic only\n-----END RSA ' + 'PRIVATE KEY-----',
  [
    ['api_token=', '"synthetic-password"'].join(''),
    ['client_secret:', 'synthetic-secret'].join(''),
    ['password=', 'abcdefgh'].join(''),
  ].join(' '),
  'unchanged 中文 🙂 \u0000 ﷽', 42, null,
];

export async function observeMechanisms(moduleRoot, { shared = false } = {}) {
  // Frozen from the former literals: prove input bytes, not just redacted output.
  assert.deepEqual(secrets.slice(0, 6).map(hash), [
    '82c036951f22ac43c73d37b22f647f2c10209c1d8630359976ba98061a23bc6c',
    'f3504cee31114b62ca13e476dad591e54a51183bc28b445addd9cdc958fcb922',
    '92d1014403c78f8af2f125c9b7834c9ec5d0a318be1f596f7275f5d6588d2b80',
    'd4e5a2c3a6d3cbb09d3cd53293b9d2f2b6e49d1be80004cb4308a938bb7dadf9',
    'f5f26b0bf1c4fc8e3c3a71f7b60e9c3819979cbb11e194cad88d2773abe86e75',
    '0de29084c24e2edc6cb8268feb3d070bca04d9aff573688e9d85a0f7cfe29f3b',
  ], 'Synthetic credential input bytes must remain unchanged');
  const load = name => import(pathToFileURL(join(moduleRoot, `${name}.mjs`)));
  const redactor = await load('redact');
  const identity = await load('identity');
  const cursor = await load('capture-cursor');
  const control = await load('control-state');
  const lock = await load('file-lock');
  const query = await load('recall-query');
  const transport = await load(shared ? 'transport-hosted' : 'http');
  const dir = await mkdtemp(join(tmpdir(), 'cairn-mechanisms-test-'));
  try {
    await writeFile(join(dir, 'project-key'), ` ${key}\n`, { mode: 0o600 });
    await writeFile(join(dir, 'install-id'), `${key}\n`, { mode: 0o600 });
    const identities = [];
    for (const cwd of ['/synthetic/project', '/synthetic/Project', '/synthetic/project/', '', '中文/🙂']) {
      identities.push(await identity.opaqueProjectId(dir, cwd) ?? null);
    }
    const cursorPath = cursor.captureCursorPath(dir, session);
    const cursorFiles = [];
    for (const value of [{ offset: 0 }, { offset: 15, generation: 'initial', discardUntilNewline: true, pendingEnd: 30 },
      { offset: 30, generation, discardUntilNewline: false, pendingEnd: undefined }]) {
      await cursor.writeCaptureCursor(cursorPath, value);
      cursorFiles.push({ bytes: await readFile(cursorPath, 'utf8'), value: await cursor.readCaptureCursor(cursorPath),
        mode: (await stat(cursorPath)).mode & 0o777 });
    }
    const invalidCursors = [];
    for (const value of ['{', '{"offset":-1}', '{"offset":1.5}', '{"offset":4,"pendingEnd":2}', '{"offset":4,"generation":42}']) {
      await writeFile(cursorPath, value);
      invalidCursors.push(await cursor.readCaptureCursor(cursorPath) ?? null);
    }
    const states = [await control.readControlState(dir)];
    await writeFile(join(dir, 'paused'), 'paused\n');
    states.push(await control.readControlState(dir));
    await writeFile(join(dir, 'control.json'), JSON.stringify({ version: 1, paused: true, generation }));
    states.push(await control.setPaused(dir, true));
    const pausedBytes = await readFile(join(dir, 'control.json'), 'utf8');
    states.push(await control.setPaused(dir, false));
    const resumedBytes = await readFile(join(dir, 'control.json'), 'utf8');
    let runs = 0;
    const active = await control.startIfActive(dir, generation, () => ++runs);
    await active.operation;
    const stale = await control.runIfActive(dir, 'initial', () => ++runs);
    await writeFile(join(dir, 'control.json'), '{');
    states.push(await control.readControlState(dir));
    let lockHeld;
    const locked = await lock.withFileLock(join(dir, 'synthetic.lock'), async () => {
      const owner = JSON.parse(await readFile(join(dir, 'synthetic.lock'), 'utf8'));
      lockHeld = owner.pid === process.pid && typeof owner.token === 'string';
    });
    const requests = [];
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = async (url, options) => {
        requests.push({ url, method: options.method, headers: options.headers, body: options.body,
          hasSignal: options.signal instanceof AbortSignal });
        if (url.endsWith('/error')) return new Response('', { status: 503 });
        if (url.endsWith('/empty')) return new Response(null, { status: 204 });
        return Response.json({ accepted: true });
      };
      const post = transport.createJsonPoster({ endpoint: 'https://synthetic.invalid/base/', token: 'synthetic-token' });
      const replies = [await post('/capture', { content: '中文🙂\n', omitted: undefined }, 1000),
        await post('/empty', {}, 1000, false)];
      await assert.rejects(post('/error', {}, 1000), error => { replies.push(error.message); return true; });
      await assert.rejects(transport.createJsonPoster({ endpoint: 'https://synthetic.invalid' })('/missing', {}, 1000),
        error => { replies.push(error.message); return true; });
      return JSON.parse(JSON.stringify({ redaction: secrets.map(redactor.redactSecrets), identities,
        installId: await identity.installId(dir), projectKeyBytes: await readFile(join(dir, 'project-key'), 'utf8'),
        cursorPath: relative(dir, cursorPath), cursorFiles, invalidCursors, states, pausedBytes, resumedBytes,
        active: active.started, stale, runs, locked, lockHeld,
        queries: [null, '', '  api_token=synthetic-secret 中文 ', '🙂'.repeat(2001)].map(value => {
          const output = query.prepareRecallQuery(value);
          return output === undefined ? null : { hash: hash(output), units: output.length };
        }), requests, replies }));
    } finally { globalThis.fetch = originalFetch; }
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export async function observeHosted(pluginRoot) {
  const dir = await mkdtemp(join(tmpdir(), 'cairn-hosted-test-'));
  const dataDir = join(dir, 'data');
  const transcript = join(dir, 'synthetic.jsonl');
  const requests = [];
  let captures = 0;
  const server = createServer(async (request, response) => {
    request.setEncoding('utf8');
    let bytes = '';
    for await (const chunk of request) bytes += chunk;
    const body = JSON.parse(bytes);
    requests.push({ path: request.url, bytes: Buffer.byteLength(bytes), sha256: hash(bytes),
      authorization: request.headers.authorization, contentType: request.headers['content-type'],
      sessionId: body.session_id ?? null, eventId: body.event_id ?? null,
      messages: body.messages?.map(message => ({ id: message.id, role: message.role, units: message.content.length })) ?? null });
    if (request.url.endsWith('/capture')) captures++;
    response.writeHead(captures === 2 ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(request.url.endsWith('/recall') ? { memories: [] } :
      captures === 4 ? { processing: true } : { duplicate: false, memoryCount: 1 }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await mkdir(dataDir, { mode: 0o700 });
    await writeFile(join(dataDir, 'project-key'), `${key}\n`, { mode: 0o600 });
    const record = (content, index) => JSON.stringify({ type: index % 2 ? 'assistant' : 'user',
      ...(index % 3 ? { uuid: `synthetic-${index}` } : {}), message: { content } }) + '\n';
    // Tool-result blocks sit on assistant rows only: a user row carrying one is a
    // tool result, which the 0.1.1 D1 privacy exception excludes as a whole.
    const rows = Array.from({ length: 25 }, (_, index) => record(index === 0 ?
      `${'🙂'.repeat(9999)}abc api_token=synthetic-secret` :
      [{ type: 'text', text: `Synthetic ${index} api_token=synthetic-secret 中文` },
        ...(index % 2 ? [{ type: 'tool_result', content: 'EXCLUDED_TOOL_CANARY' }] : [])], index));
    await writeFile(transcript, '\nmalformed\n' + rows.join('') + '{"partial":');
    const input = { session_id: session, transcript_path: transcript, cwd: '/synthetic/project',
      prompt: '  api_token=synthetic-secret 中文 🙂  ' };
    async function run(action) {
      const child = spawn(process.execPath, [join(pluginRoot, 'scripts/hook.mjs'), action], {
        env: { PATH: process.env.PATH, HOME: dir, CLAUDE_PLUGIN_DATA: dataDir,
          CLAUDE_PLUGIN_OPTION_API_ENDPOINT: `http://127.0.0.1:${server.address().port}`,
          CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = '';
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.stdin.end(JSON.stringify(input));
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      assert.equal(code, 0, stderr);
      return { code, stdout, stderr };
    }
    const { captureCursorPath } = await import(pathToFileURL(join(pluginRoot, 'lib/capture-cursor.mjs')));
    const cursorPath = captureCursorPath(dataDir, session);
    const cursorFiles = []; const outcomes = [];
    outcomes.push(await run('capture'));
    cursorFiles.push(await readFile(cursorPath, 'utf8'));
    await appendFile(transcript, 'true}\n' + record('Synthetic appended after failure', 25));
    for (let i = 0; i < 3; i++) {
      outcomes.push(await run('capture'));
      cursorFiles.push(await readFile(cursorPath, 'utf8'));
    }
    outcomes.push(await run('recall'));
    return { requests, cursorPath: relative(dataDir, cursorPath), cursorFiles, outcomes };
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}
