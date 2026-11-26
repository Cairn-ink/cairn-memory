import { createInterface } from 'node:readline';
import { createContinuations } from './continuations.mjs';
import { initialize, tools } from './profile.mjs';
import { toolInputError } from './tool-input.mjs';
import { callTool, missingAuthority, textResult } from './wire-tools.mjs';

export async function openLocalService(storageOptions, shared) {
  if (typeof storageOptions?.database !== 'string' || !storageOptions.database || storageOptions.database.includes('\0')) {
    throw new Error('invalid_core_local_storage_options');
  }
  const open = async () => {
    const { openStorage } = await import('./adapter-slot.mjs');
    return openStorage(storageOptions.database);
  };
  return shared ? (shared.runtime ??= open()) : open();
}

const rpcError = (code, message) => ({ code, message });
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const supportedProtocols = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);

export async function serveStdio(input, output, options, { shared, closed = () => false } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  const handles = createContinuations();
  const scope = options && { owner: options.owner,
    namespace: options.project === undefined ? 'personal\0' : 'project\0' + options.project };
  let runtime;
  const send = reply => { if (!closed()) output.write(JSON.stringify(reply) + '\n'); };
  try {
    for await (const line of lines) {
      if (closed()) break;
      let request;
      try { request = JSON.parse(line); }
      catch {
        send({ jsonrpc: '2.0', id: null, error: rpcError(-32700, 'Parse error') });
        continue;
      }
      if (request?.jsonrpc !== '2.0' || request.id === undefined) continue;
      const reply = { jsonrpc: '2.0', id: request.id };
      switch (request.method) {
        case 'initialize': {
          const protocol = request.params?.protocolVersion;
          reply.result = { ...initialize, protocolVersion: supportedProtocols.has(protocol) ? protocol : initialize.protocolVersion };
          break;
        }
        case 'ping':
          reply.result = {};
          break;
        case 'tools/list':
          reply.result = { tools };
          break;
        case 'tools/call': {
          const params = request.params;
          if (!isObject(params) || typeof params.name !== 'string' ||
              (params.arguments !== undefined && !isObject(params.arguments))) {
            reply.error = rpcError(-32602, 'Invalid params');
            break;
          }
          const tool = tools.find(({ name }) => name === params.name);
          if (!tool) {
            reply.error = rpcError(-32602, 'Tool ' + params.name + ' not found');
            break;
          }
          const args = params.arguments ?? {};
          const error = toolInputError(tool, args);
          if (scope && !error) {
            try {
              const release = await shared?.enter?.();
              let result;
              try {
                await shared?.authorize();
                if (closed()) break;
                runtime = shared ? await openLocalService(options, shared) : runtime ?? await openLocalService(options);
                if (closed()) break;
                result = await callTool(runtime.service, scope, handles, tool.name, args);
              } finally {
                await release?.(result !== undefined && tool.name === 'forget_memory');
              }
              await shared?.authorize();
              reply.result = result;
            } catch {
              reply.error = rpcError(-32603, 'Internal error');
            }
          } else {
            reply.result = error ? textResult(error) : missingAuthority(tool.name);
          }
          break;
        }
        default:
          reply.error = rpcError(-32601, 'Method not found');
      }
      send(reply);
    }
  } finally {
    handles.close();
    if (!shared) await runtime?.close();
  }
}
