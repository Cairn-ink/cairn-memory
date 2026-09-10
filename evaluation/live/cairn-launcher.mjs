#!/usr/bin/env node
// Experiment-only Cairn entry point. It keeps the real MCP server/core/adapter,
// replacing only the adapter's HTTP callback with the authenticated loopback proxy.

import { constants, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fail = () => { throw new Error('cairn_live_launcher_failed'); };
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function loadConfiguration() {
  const filename = process.env.CAIRN_LIVE_CONFIG;
  if (typeof filename !== 'string' || !path.isAbsolute(filename) || filename.includes('\0')) fail();
  let stat;
  try { stat = lstatSync(filename); } catch { fail(); }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16_384
    || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o600)) fail();
  let value;
  try {
    if (realpathSync(filename) !== filename) fail();
    value = JSON.parse(readFileSync(filename, 'utf8'));
  } catch { fail(); }
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || !['packageRoot,proxyUrl,version', 'diagnosticDirectory,packageRoot,proxyUrl,version']
      .includes(Object.keys(value).sort().join(','))
    || value.version !== 1 || typeof value.packageRoot !== 'string'
    || !path.isAbsolute(value.packageRoot) || typeof value.proxyUrl !== 'string') fail();
  let proxy;
  try { proxy = new URL(value.proxyUrl); } catch { fail(); }
  if (proxy.protocol !== 'http:' || proxy.hostname !== '127.0.0.1' || !proxy.port
    || proxy.username || proxy.password || proxy.search || proxy.hash
    || !['', '/'].includes(proxy.pathname)) fail();
  const root = realpathSync(value.packageRoot);
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (manifest.name !== 'cairn-memory-local-preview') fail();
  if (own(value, 'diagnosticDirectory')) {
    const directory = value.diagnosticDirectory;
    if (typeof directory !== 'string' || !path.isAbsolute(directory)
      || directory.includes('\0') || path.resolve(directory) !== directory) fail();
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
      || realpathSync(directory) !== directory || (directoryStat.mode & 0o777) !== 0o700
      || (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid())) fail();
  }
  return { packageRoot: root, proxyUrl: proxy.href.replace(/\/$/u, ''),
    ...(own(value, 'diagnosticDirectory') ? { diagnosticDirectory: value.diagnosticDirectory } : {}) };
}

function parseArguments(args) {
  const allowed = new Set(['--db', '--owner', '--project']);
  const values = new Map();
  if (!args.length || args.length % 2 !== 0) fail();
  for (let index = 0; index < args.length; index += 2) {
    if (!allowed.has(args[index]) || values.has(args[index])
      || typeof args[index + 1] !== 'string' || !args[index + 1]) fail();
    values.set(args[index], args[index + 1]);
  }
  if (!values.has('--db') || !values.has('--owner')) fail();
  return {
    path: values.get('--db'),
    namespace: {
      ownerId: values.get('--owner'),
      scope: values.has('--project') ? 'project' : 'personal',
      projectId: values.get('--project') ?? null,
    },
  };
}

async function start() {
  const config = loadConfiguration();
  const binding = parseArguments(process.argv.slice(2));
  let onDiagnostic;
  if (own(config, 'diagnosticDirectory')) {
    const { createDiagnosticCollector } = await import(pathToFileURL(
      path.join(config.packageRoot, 'evaluation/live/diagnostics.mjs'),
    ).href);
    onDiagnostic = createDiagnosticCollector(config.diagnosticDirectory);
  }
  const requireFromPackage = createRequire(path.join(config.packageRoot, 'package.json'));
  const sdk = await import(pathToFileURL(requireFromPackage.resolve('@modelcontextprotocol/server/stdio')).href);
  const { createCairnServer } = await import(pathToFileURL(
    path.join(config.packageRoot, 'adapters/mcp/server.mjs'),
  ).href);

  const token = process.env.OPENAI_API_KEY ?? '';
  if (typeof token !== 'string' || /[\r\n]/u.test(token)) fail();
  let model;
  if (token) {
    const { createOpenAIModel } = await import(pathToFileURL(
      path.join(config.packageRoot, 'adapters/openai/index.mjs'),
    ).href);
    const nativeFetch = globalThis.fetch;
    const proxyFetch = (url, options) => {
      const target = new URL(url);
      if (target.origin !== 'https://api.openai.com'
        || !['/v1/responses/input_tokens', '/v1/responses'].includes(target.pathname)
        || target.search || target.hash || !options || !own(options, 'signal')) fail();
      return nativeFetch(`${config.proxyUrl}${target.pathname}`, options);
    };
    globalThis.fetch = () => { throw new Error('cairn_live_network_route_blocked'); };
    model = createOpenAIModel({ apiKey: token, fetchImpl: proxyFetch,
      ...(onDiagnostic ? { onDiagnostic } : {}) });
  } else {
    globalThis.fetch = () => { throw new Error('cairn_live_network_route_blocked'); };
  }

  let handle;
  let closing = false;
  const stop = () => {
    if (closing) return;
    closing = true;
    void handle.close().catch(() => {})
      .finally(() => { process.stdin.destroy(); });
  };
  handle = sdk.serveStdio(() => createCairnServer({ ...binding, model }), {
    transport: new sdk.StdioServerTransport(process.stdin, process.stdout, { maxBufferSize: 65_536 }),
    onerror: () => { queueMicrotask(stop); },
  });
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  process.stdin.once('end', stop);
  return handle;
}

try { await start(); }
catch { console.error('cairn_live_launcher_failed'); process.exitCode = 1; }
