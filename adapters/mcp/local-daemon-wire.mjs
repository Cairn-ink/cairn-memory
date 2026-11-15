import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { Transform } from 'node:stream';
import { canonical, DAEMON_PROTOCOL } from './local-daemon-identity.mjs';
import { refuse } from './local-daemon-state.mjs';

export const FRAME_BYTES = 262144, QUEUE_BYTES = 1048576, TOOL_CALLS = 8;
export const queuedBytes = (...streams) => streams.reduce((sum, stream) => sum +
  (stream?.pendingBytes ?? 0) + (stream?.readableLength ?? 0) + (stream?.writableLength ?? 0), 0);
const nonce = () => randomBytes(32).toString('hex');
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function proof(capability, phase, transcript) {
  return createHmac('sha256', Buffer.from(capability, 'hex')).update(phase + '\0' + canonical(transcript)).digest('hex');
}
export function verifyProof(actual, expected) {
  if (!hex(actual) || !hex(expected) || !timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'))) throw refuse('daemon_auth');
}
// Own stream errors through final close. Handshake bytes never reach the SDK.
function preface(socket, deadline) {
  let buffer = Buffer.alloc(0), pending, ended = false;
  const fail = error => { ended = true; pending?.reject(error); pending = undefined; };
  const pump = () => {
    if (!pending) return;
    const end = buffer.indexOf(10);
    if (end < 0) return;
    const line = buffer.subarray(0, end); buffer = buffer.subarray(end + 1);
    const waiter = pending; pending = undefined;
    try { waiter.resolve(JSON.parse(line.toString('utf8'))); } catch { waiter.reject(refuse('daemon_preface')); }
  };
  const data = chunk => {
    if (buffer.length + chunk.length > 65536) { fail(refuse('daemon_preface_limit')); socket.destroy(); return; }
    buffer = Buffer.concat([buffer, chunk]); pump();
  };
  const error = () => fail(refuse('daemon_transport'));
  const timer = setTimeout(() => { fail(refuse('daemon_connect_timeout')); socket.destroy(); }, Math.max(1, deadline - performance.now()));
  socket.on('data', data); socket.on('error', error); socket.on('close', error); socket.resume();
  return {
    read: () => new Promise((resolve, reject) => { if (ended) return reject(refuse('daemon_transport')); pending = { resolve, reject }; pump(); }),
    send(value) { const bytes = Buffer.from(JSON.stringify(value) + '\n'); if (bytes.length > 65536) throw refuse('daemon_preface_limit'); socket.write(bytes); },
    release() {
      clearTimeout(timer); socket.pause(); socket.off('data', data); socket.off('error', error); socket.off('close', error);
      if (buffer.length) socket.unshift(buffer); buffer = Buffer.alloc(0);
    },
  };
}
export async function authenticateClient(socket, descriptor, identity, deadline) {
  const io = preface(socket, deadline);
  try {
    if (descriptor.protocol !== DAEMON_PROTOCOL || identity.protocol !== DAEMON_PROTOCOL) throw refuse('daemon_protocol');
    if (canonical(descriptor.identity) !== canonical(identity)) throw refuse('daemon_identity');
    if (!hex(descriptor.capability) || !hex(descriptor.incarnation)) throw refuse('daemon_descriptor');
    const clientNonce = nonce();
    io.send({ kind: 'hello', protocol: DAEMON_PROTOCOL, identity, incarnation: descriptor.incarnation, clientNonce });
    const challenge = await io.read();
    if (challenge.kind !== 'challenge' || !hex(challenge.serverNonce) || challenge.clientNonce !== clientNonce) throw refuse('daemon_nonce');
    const transcript = { protocol: DAEMON_PROTOCOL, identity, incarnation: descriptor.incarnation, clientNonce, serverNonce: challenge.serverNonce };
    verifyProof(challenge.mac, proof(descriptor.capability, 'server', transcript));
    io.send({ kind: 'authenticate', mac: proof(descriptor.capability, 'client', transcript) });
    const ready = await io.read();
    verifyProof(ready.mac, proof(descriptor.capability, 'ready', { ...transcript, metadata: ready.metadata }));
    if (ready.kind !== 'ready') throw refuse('daemon_auth');
    return ready;
  } finally { io.release(); }
}
export async function authenticateServer(socket, descriptor, { deadline, admitting, authenticated = async () => {}, ready = () => ({}) }) {
  const io = preface(socket, deadline);
  try {
    const admission = () => { if (!admitting()) throw refuse('daemon_draining'); };
    const hello = await io.read();
    admission();
    if (hello.protocol !== DAEMON_PROTOCOL) throw refuse('daemon_protocol');
    if (hello.kind !== 'hello' || !hex(hello.clientNonce)) throw refuse('daemon_nonce');
    if (canonical(hello.identity) !== canonical(descriptor.identity)) throw refuse('daemon_identity');
    if (hello.incarnation !== descriptor.incarnation) throw refuse('daemon_incarnation');
    const transcript = { protocol: DAEMON_PROTOCOL, identity: descriptor.identity,
      incarnation: descriptor.incarnation, clientNonce: hello.clientNonce, serverNonce: nonce() };
    io.send({ kind: 'challenge', clientNonce: hello.clientNonce, serverNonce: transcript.serverNonce, mac: proof(descriptor.capability, 'server', transcript) });
    const response = await io.read();
    if (response.kind !== 'authenticate') throw refuse('daemon_auth');
    verifyProof(response.mac, proof(descriptor.capability, 'client', transcript));
    admission();
    await authenticated();
    admission();
    const metadata = ready();
    io.send({ kind: 'ready', metadata, mac: proof(descriptor.capability, 'ready', { ...transcript, metadata }) });
  } finally { io.release(); }
}

export function requestLedger() {
  // Only ids and method classes survive parsing. Never retain tool parameters.
  const pending = new Map();
  return {
    pending,
    get tools() { return [...pending.values()].filter(kind => kind === 'tool').length; },
    request(message) {
      if (!Object.hasOwn(message, 'id') || !message.method) return;
      if (!['string', 'number'].includes(typeof message.id) || pending.has(message.id)) throw refuse('daemon_request_id');
      if (message.method === 'tools/call' && this.tools >= TOOL_CALLS) throw refuse('daemon_tool_limit');
      if (pending.size >= 256) throw refuse('daemon_request_limit');
      pending.set(message.id, message.method === 'tools/call' ? 'tool' : 'request');
    },
    response(message) { if (!message.method && Object.hasOwn(message, 'id')) pending.delete(message.id); },
    clear() { pending.clear(); },
  };
}
export function frameGuard({ onFrame = () => {}, queued = () => 0 } = {}) {
  let buffer = Buffer.alloc(0);
  const stream = new Transform({ highWaterMark: 16384,
    transform(chunk, encoding, callback) {
      try {
        if (buffer.length + chunk.length + this.readableLength + this.writableLength + queued() > QUEUE_BYTES) throw refuse('daemon_queue_limit');
        buffer = Buffer.concat([buffer, chunk]);
        let end;
        while ((end = buffer.indexOf(10)) >= 0) {
          if (end + 1 > FRAME_BYTES) throw refuse('daemon_frame_limit');
          const bytes = Buffer.from(buffer.subarray(0, end + 1)); buffer = Buffer.from(buffer.subarray(end + 1));
          let message; try { message = JSON.parse(bytes.toString('utf8')); } catch { throw refuse('daemon_frame'); }
          if (!message || typeof message !== 'object' || Array.isArray(message)) throw refuse('daemon_frame');
          onFrame(message, bytes); this.push(bytes);
        }
        if (buffer.length >= FRAME_BYTES) throw refuse('daemon_frame_limit');
        callback();
      } catch (error) { callback(error); }
    },
    flush(callback) { callback(buffer.length ? refuse('daemon_frame_truncated') : undefined); },
    destroy(error, callback) { buffer = Buffer.alloc(0); callback(error); },
  });
  Object.defineProperty(stream, 'pendingBytes', { get: () => buffer.length });
  return stream;
}
