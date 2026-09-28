import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { qualificationCandidatesPrompt } from '../qualification-candidates-prompt.mjs';
import { openMemoryCore } from '../index.mjs';

export const prompts = Object.fromEntries(['interpret-episode', 'extract-episode-sources', 'qualify-episode-candidates']
  .map(name => [name, name === 'qualify-episode-candidates'
    ? qualificationCandidatesPrompt(new URL(`../prompts/${name}.md`, import.meta.url))
    : readFileSync(new URL(`../prompts/${name}.md`, import.meta.url), 'utf8')]));
export const ns = { ownerId: 'synthetic', scope: 'project', projectId: 'episode-test' };
export const sourceText = '請在 review 使用 diagrams 😀。';
export const interpretationInput = () => ({ sources: [{ sourceIndex: 0, role: 'user', text: sourceText }],
  classificationTarget: [0], prior: {} });
export const interpretation = (input = interpretationInput(), type = 'work') => {
  const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.sources[0].text.length }] });
  return { type: field(type), language: 'zh-Hant', gist: field('討論 review 習慣'), outcome: null, nextStep: null, disposition: null };
};
export const qualifications = input => ({ qualifications: Object.fromEntries(input.items.map(item => [
  `item_${item.itemIndex}`, { itemIndex: item.itemIndex,
    ...Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'].map(field =>
      [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
        evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [] }])),
    ...(['instruction', 'preference'].includes(item.kind)
      ? { procedural: { evidenceIndices: [item.candidates[0].candidateIndex] } } : {}),
  }])) });
export const request = (method = 'interpret-episode', input = interpretationInput()) => ({
  system: prompts[method], input, maxOutputTokens: 1024, signal: new AbortController().signal });
export const envelope = (model, output) => ({ object: 'response', model, status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
export function fakeModel({ respond, transport, onDiagnostic, ...options } = {}) {
  const calls = [], diagnostics = [];
  const model = createOpenAIModel({ apiKey: ['sk', 'synthetic', 'only'].join('-'), episodeModel: DEFAULT_MODEL,
    ...options, onDiagnostic: onDiagnostic ?? (event => diagnostics.push(event)),
    fetchImpl: async (url, init) => {
      const payload = JSON.parse(init.body), input = JSON.parse(payload.input[0].content[0].text);
      const method = payload.text.format.name.slice('cairn_'.length);
      calls.push({ url, payload, signal: init.signal });
      if (transport) return transport({ url, init, payload, input, method, calls });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      let output;
      if (respond) output = await respond(method, input);
      else if (method === 'interpretEpisode') output = interpretation(input);
      else if (method === 'extract') output = { items: [{ content: 'Use diagrams in reviews.', kind: 'preference',
        confidence: 0.9, sourceIndices: [0], procedural: true }] };
      else if (method === 'qualifyCandidates') output = qualifications(input);
      else if (method === 'classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      else assert.fail(`unexpected synthetic method ${method}`);
      return Response.json(envelope(payload.model, output));
    } });
  return { model, calls, diagnostics };
}
export function setup(t, fakeOptions = {}, coreOptions = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'openai-episodes-' });
  const fake = fakeModel(fakeOptions);
  const path = join(workspace.path, 'store.sqlite');
  const config = { path, model: fake.model, captureQualification: 'source-bound-v2',
    captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' }, ...coreOptions };
  if (config.sessionEpisodes === undefined) delete config.sessionEpisodes;
  const core = openMemoryCore(config);
  workspace.defer(() => core.close());
  return { ...fake, core, path, workspace };
}
export const captureInput = (position = 1) => ({ namespace: ns, client: 'synthetic', sessionId: 'private-session',
  eventId: `event-${position}`, episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
  messages: [{ id: `message-${position}`, role: 'user', content: `${sourceText} ${position}` }] });
export const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
