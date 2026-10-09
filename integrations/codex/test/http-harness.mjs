import { requestJSON } from '../../../packages/setup/lib/transport.mjs';
import { localWireRequest, wireChild, installChildWire } from '../../../packages/setup/test/http-wire.mjs';

// Keep real loopback coverage on hosts that permit it. In a socket-restricted
// sandbox, reuse setup's real HTTP parsers over duplex streams and child IPC.
// No test is skipped, and request/response handlers still consume wire bytes.
export async function testServer(server, workspace) {
  let wire = false;
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject);
        resolve();
      });
    });
  } catch (error) {
    if (error.code !== 'EPERM') throw error;
    wire = true;
  }
  const endpoint = `http://127.0.0.1:${wire ? 31417 : server.address().port}/capture`;
  workspace.defer(async () => {
    server.closeAllConnections();
    if (server.listening) await new Promise(resolve => server.close(resolve));
  });
  return {
    endpoint, wire, server,
    async capture(body, { signal } = {}) {
      const options = { body, signal };
      const response = wire ? await localWireRequest(server, requestJSON, new URL(endpoint), options)
        : await requestJSON(new URL(endpoint), options);
      return response.value;
    },
  };
}
export function childEnvironment() {
  const env = { ...process.env };
  // This is a program, not another node:test worker. Do not inherit its protocol.
  delete env.NODE_TEST_CONTEXT;
  return env;
}
export { wireChild, installChildWire, requestJSON };
