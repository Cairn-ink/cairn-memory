import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { ContextStdioServerTransport } from './context-read-transport.mjs';
import { createLocalCairnRuntime } from './server.mjs';
import { createLocalContextContinuations } from './local-context-continuations.mjs';
import { createCommitDispatcher } from '../../core/commit-dispatch.mjs';

/** One exact configuration, one runtime, independent SDK instances per stream.
 * Authentication and identity selection belong to the caller (R3).
 */
export function createLocalSharedRuntime(options = {}) {
  const configuration = { ...options, namespace: structuredClone(options.namespace) };
  const closingSignal = new AbortController();
  const dispatcher = createCommitDispatcher({ signal: closingSignal.signal });
  const connections = new Set();
  let runtime, closed = false, closing, inFlight = 0, sdkServers = 0;
  return {
    attach(input, output) {
      if (closed) throw Error('local_host_closed');
      // Activate before discovery, even if this connection never calls a tool.
      runtime ??= dispatcher.open(() => createLocalCairnRuntime(configuration,
        { dispatcher, signal: closingSignal.signal }));
      let key = Object.freeze({});
      const instances = new Set();
      const continuations = createLocalContextContinuations();
      let disconnected = false, disconnecting, active = 0, entry;
      const disconnect = new AbortController();
      const transport = new ContextStdioServerTransport(input, output);
      const handle = {
        close() {
          if (disconnected) return disconnecting ?? Promise.resolve();
          disconnected = true; key = null; continuations.close(); connections.delete(handle);
          disconnect.abort();
          input.off('end', onEnd); input.off('close', onEnd); output.off('close', onEnd);
          // close() revokes each SDK instance synchronously before awaiting IO.
          const stopped = [...instances].map(server => server.close());
          disconnecting = Promise.allSettled(stopped).then(() => entry?.close()).finally(() => {
            input.destroy(); output.destroy();
          });
          return disconnecting;
        },
        inspect: () => ({ closed: disconnected, inFlight: active, sdkServers: instances.size, continuations: continuations.inspect() }),
      };
      const onEnd = () => { void handle.close().catch(() => {}); };
      // SDK close removes its input error listener before destroy completes.
      // Own both endpoints through their final close, including abort errors
      // emitted asynchronously by Duplex.from() and already-ending peers.
      for (const stream of new Set([input, output])) {
        stream.on('error', onEnd);
        stream.once('close', () => stream.off('error', onEnd));
      }
      input.once('end', onEnd); input.once('close', onEnd); output.once('close', onEnd);
      connections.add(handle);
      try {
        entry = serveStdio(() => {
          if (disconnected) throw Error('local_connection_closed');
          let server;
          server = runtime.server({ key, lifecycle: {
            continuations, closed: () => disconnected, signal: disconnect.signal,
            async run(work) {
              active++; inFlight++;
              // Initialization must finish before an access port issues its
              // synchronously consumed token, never between issue and call.
              try { await runtime.ready; return await work(); }
              finally { active--; inFlight--; }
            },
            // Probe disposal is instance-local: the factory may run twice.
            dispose() { if (instances.delete(server)) sdkServers--; },
          } });
          instances.add(server); sdkServers++;
          return server;
        }, { transport, onerror: onEnd });
        const onTransportClose = transport.onclose;
        transport.onclose = () => { onTransportClose?.(); onEnd(); };
      } catch (error) { void handle.close().catch(() => {}); throw error; }
      return handle;
    },
    close() {
      if (closing) return closing;
      closed = true;
      closingSignal.abort();
      const stopped = [...connections].map(connection => connection.close());
      return closing = Promise.allSettled(stopped).then(() => runtime?.close());
    },
    inspect() {
      return { connections: connections.size, inFlight, sdkServers,
        runtime: runtime?.inspect() ?? { state: closed ? 'closed' : 'dormant', cores: 0, rawManagers: 0, rawMaintenanceTimers: 0, refreshers: 0 } };
    },
    inspectTransactions: () => dispatcher.inspectTransactions(),
  };
}
