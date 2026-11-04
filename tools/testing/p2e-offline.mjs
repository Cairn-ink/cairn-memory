import { registerHooks, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';

const refused = () => { throw Error('p2e_test_network_forbidden'); };
globalThis.fetch = refused;
net.connect = net.createConnection = net.Socket.prototype.connect = refused;
tls.connect = http.request = http.get = https.request = https.get = refused;
dgram.createSocket = dns.lookup = dns.resolve = refused;
syncBuiltinESMExports();
registerHooks({ resolve(specifier, context, next) {
  const result = next(specifier, context);
  if (result.url.endsWith('/adapters/openai/embedding.mjs')) throw Error('p2e_test_real_provider_import_forbidden');
  return result;
} });
