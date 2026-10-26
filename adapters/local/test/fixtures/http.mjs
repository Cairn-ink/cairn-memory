// Synthetic provider only; this preload never reads an application credential.
import { appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { syncBuiltinESMExports } from 'node:module';

const forbidden = () => { throw Error('synthetic_network_forbidden'); };
http.request = http.get = https.request = https.get = net.connect = net.createConnection = net.Socket.prototype.connect = forbidden;
syncBuiltinESMExports();
const json = value => new Response(JSON.stringify(value));
globalThis.fetch = async (url, options) => {
  if (!['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses'].includes(url)) forbidden();
  const payload = JSON.parse(options.body), method = payload.text.format.name, mode = process.env.SYNTHETIC_MODE ?? 'empty';
  appendFileSync(process.env.SYNTHETIC_TRACE, JSON.stringify({ method, count: url.endsWith('/input_tokens') }) + '\n', { mode: 0o600 });
  if (mode === 'provider-error' || mode === 'qualification-error' && method === 'cairn_qualifyCandidates' ||
      mode === 'filing-error' && method === 'cairn_classify') throw Error('synthetic_source_secret synthetic_key_secret');
  if (url.endsWith('/input_tokens')) {
    if (mode === 'planning-delay') {
      writeFileSync(process.env.SYNTHETIC_READY, 'ready', { flag: 'wx', mode: 0o600 });
      await delay(2500);
    }
    if (['revoke', 'notice', 'raw-off'].includes(mode)) {
      const config = JSON.parse(readFileSync(process.env.SYNTHETIC_CONFIG, 'utf8'));
      const { openMemoryCore } = await import(pathToFileURL(process.env.SYNTHETIC_CORE));
      const core = openMemoryCore({ path: config.databasePath, rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
      try {
        const { namespace, client, targetId } = config.authority;
        const current = core.getLocalCaptureControl({ namespace, client }).value;
        const result = mode === 'raw-off'
          ? core.setRawCaptureControl({ ownerId: namespace.ownerId, client, enabled: false, expectedRevision: core.getRawCaptureControl({ ownerId: namespace.ownerId, client }).value.revision })
          : core.setLocalCaptureControl({ namespace, client, targetId, expectedStoreId: current.storeId, expectedRevision: current.revision,
            automaticCaptureEnabled: mode !== 'revoke', rawNoticeVersion: mode === 'notice' ? null : current.rawNoticeVersion });
        if (!result.ok) throw Error('synthetic_control_failed');
      } finally { core.close(); }
    }
    return json({ object: 'response.input_tokens', input_tokens: 100 });
  }
  if (mode === 'hang') return new Promise(() => {});
  if (mode === 'hold') {
    writeFileSync(process.env.SYNTHETIC_READY, 'ready', { flag: 'wx', mode: 0o600 });
    while (!existsSync(process.env.SYNTHETIC_RELEASE)) await delay(10);
  }
  const input = JSON.parse(payload.input[0].content[0].text);
  let output;
  if (method === 'cairn_extract') output = { items: mode === 'empty' || mode === 'hold' ? [] : [
    { content: 'Synthetic preference.', kind: 'preference', confidence: 0.9, sourceIndices: [0] },
  ] };
  else if (method === 'cairn_qualifyCandidates') output = { wireVersion: 'evidence-pool-v1', qualifications: Object.fromEntries(input.items.map(item => [
    `item_${item.itemIndex}`, { itemIndex: item.itemIndex, pool: [item.candidates[0].candidateIndex], ...Object.fromEntries(
      ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field => [field,
        { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null, evidenceSlots: field === 'value' ? [0] : [] }])) },
  ])) };
  else if (method === 'cairn_classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
  else forbidden();
  return json({ id: 'resp_synthetic', object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed', content: [
      { type: 'output_text', text: JSON.stringify(output), annotations: [] },
    ] }], usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
};
