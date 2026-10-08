import { Duplex } from 'node:stream';
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';

// Real Node HTTP parsers over in-memory duplex streams. The test sandbox cannot
// bind loopback sockets. IPC carries wire bytes, never argv/env/temp files.
export function socket(send) {
  const stream = new Duplex({
    read() {},
    write(chunk, _encoding, done) { send(Buffer.from(chunk)); done(); },
    final(done) { send(null); done(); },
  });
  stream.setNoDelay = () => stream;
  stream.setKeepAlive = () => stream;
  stream.ref = stream.unref = () => stream;
  stream.remoteAddress = '127.0.0.1';
  return stream;
}

export function wireChild(proc, server) {
  const connections = new Map();
  const send = message => { if (proc.connected) proc.send(message, () => {}); };
  proc.on('message', message => {
    if (message.kind === 'connect') {
      const stream = socket(chunk => {
        send({ kind: 'wire', id: message.id, data: chunk?.toString('base64') ?? null });
      });
      connections.set(message.id, stream);
      stream.on('error', () => {});
      stream.once('close', () => {
        connections.delete(message.id);
        send({ kind: 'end', id: message.id });
      });
      server.emit('connection', stream);
    } else if (message.kind === 'wire') connections.get(message.id)?.push(message.data === null ? null : Buffer.from(message.data, 'base64'));
    else if (message.kind === 'end') connections.get(message.id)?.destroy();
  });
  proc.once('close', () => { for (const stream of connections.values()) stream.destroy(); });
}

export function installChildWire() {
  let id = 0;
  const connections = new Map();
  const original = http.request;
  http.request = (url, options, callback) => original(url, {
    ...options, agent: undefined,
    createConnection: () => {
      const key = ++id;
      const stream = socket(chunk => process.send({ kind: 'wire', id: key, data: chunk?.toString('base64') ?? null }, () => {}));
      connections.set(key, stream);
      stream.once('close', () => {
        connections.delete(key);
        if (process.connected) process.send({ kind: 'end', id: key }, () => {});
      });
      process.send({ kind: 'connect', id: key }, () => {});
      return stream;
    },
  }, callback);
  const message = value => {
    const stream = connections.get(value.id);
    if (value.kind === 'wire') stream?.push(value.data === null ? null : Buffer.from(value.data, 'base64'));
    else if (value.kind === 'end') stream?.destroy();
  };
  process.on('message', message);
  return () => { http.request = original; process.off('message', message); process.disconnect(); };
}

export async function localWireRequest(server, request, url, options) {
  const original = http.request;
  http.request = (target, opts, callback) => original(target, {
    ...opts, agent: undefined,
    createConnection: () => {
      const client = socket(chunk => peer.push(chunk));
      const peer = socket(chunk => client.push(chunk));
      server.emit('connection', peer);
      client.on('close', () => peer.destroy());
      peer.on('error', () => {});
      return client;
    },
  }, callback);
  try { return await request(url, options); }
  finally { http.request = original; }
}

export async function virtualNetwork(servers, action, ca) {
  const originals = { http: http.request, https: https.request, tls: tls.connect };
  const connections = new Set();
  const connect = url => {
    const server = servers.get(url.host);
    if (!server) throw new Error('unexpected virtual network destination');
    const client = socket(chunk => peer.push(chunk));
    const peer = socket(chunk => client.push(chunk));
    connections.add(client); connections.add(peer);
    client.on('error', () => {}); peer.on('error', () => {});
    client.on('close', () => peer.destroy()); peer.on('close', () => client.destroy());
    server.emit('connection', peer);
    return client;
  };
  http.request = (url, options, callback) => originals.http(url, {
    ...options, agent: undefined, createConnection: () => connect(url),
  }, callback);
  https.request = (url, options, callback) => originals.https(url, options.agent && options.agent !== false ? options : {
    ...options, agent: undefined,
    createConnection: opts => originals.tls({ ...opts, ca, socket: connect(url) }),
  }, callback);
  // CONNECT's destination TLS uses the same explicit test CA. Verification
  // remains enabled; no insecure option is introduced into production code.
  tls.connect = options => {
    const stream = originals.tls({ ...options, ca });
    stream.on('error', () => {});
    return stream;
  };
  try { return await action(); }
  finally {
    http.request = originals.http; https.request = originals.https; tls.connect = originals.tls;
    for (const stream of connections) stream.destroy();
  }
}
