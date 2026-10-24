// Real OpenAI transport for the HR-3 harness (primary-owned; see harness/transport.d.ts).
// The key is read from a private env file inside this module and never leaves it:
// it is not logged, persisted, returned or attached to errors.
import { readFileSync, statSync } from 'node:fs';
import { TransportError } from '../harness/transport.mjs';

const API = 'https://api.openai.com/v1';

function readKey(keyFile) {
  const mode = statSync(keyFile).mode & 0o777;
  if (mode & 0o077) throw new Error('key_file_permissions');
  const line = readFileSync(keyFile, 'utf8').split('\n').find(l => l.startsWith('OPENAI_API_KEY='));
  const key = line?.slice('OPENAI_API_KEY='.length).trim();
  if (!key) throw new Error('key_missing');
  return key;
}

function outputText(body) {
  let text = '', refused = false;
  for (const item of body.output ?? []) {
    if (item.type !== 'message') continue;
    for (const part of item.content ?? []) {
      if (part.type === 'output_text') text += part.text;
      else if (part.type === 'refusal') refused = true;
    }
  }
  return { text, refused };
}

export class OpenAITransport {
  #key;
  constructor({ keyFile, fetchImpl = fetch } = {}) {
    this.#key = readKey(keyFile);
    this.fetch = fetchImpl;
  }

  async send(request, { signal } = {}) {
    const embedding = request.operation.endsWith('-embedding');
    let response;
    try {
      response = await this.fetch(`${API}/${embedding ? 'embeddings' : 'responses'}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${this.#key}`, 'content-type': 'application/json' },
        // The validated body is sent verbatim; no parameters are added.
        body: JSON.stringify(request.body),
        signal,
      });
    } catch {
      throw new TransportError('network_failure');
    }
    // Rate limits and server errors are the only retryable provider outcomes.
    if (response.status === 429 || response.status >= 500) throw new TransportError(`http_${response.status}`);
    let body;
    try { body = await response.json(); } catch { throw new TransportError('unreadable_body'); }
    if (!response.ok) {
      // A 4xx other than 429 is a contract error: the harness stops rather than retrying.
      const error = new Error(`provider_rejected_${response.status}`);
      error.providerCode = body?.error?.code ?? body?.error?.type ?? null;
      throw error;
    }
    const requestId = response.headers.get('x-request-id') ?? body.id;
    if (embedding) {
      const vectors = [...(body.data ?? [])].sort((a, b) => a.index - b.index).map(d => d.embedding);
      return { requestId, model: body.model, status: 'completed', vectors,
        usage: { inputTokens: body.usage?.prompt_tokens, outputTokens: 0 } };
    }
    const { text, refused } = outputText(body);
    const status = refused ? 'refused' : body.status === 'completed' ? 'completed' : 'incomplete';
    // output_tokens already includes billed reasoning tokens.
    return { requestId, model: body.model, status, outputText: text,
      usage: { inputTokens: body.usage?.input_tokens, outputTokens: body.usage?.output_tokens } };
  }
}
