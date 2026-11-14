import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const allowlist = JSON.parse(readFileSync(new URL('./role-profile-help-additions.json', import.meta.url)));
assert.equal(allowlist.base, '4aa9327b');
assert.equal(allowlist.output, 'cli.stdout[0]');

// Only current help is projected back to the pin. No trimming, patterns or
// reordering: the exact added lines and both adjacent pinned lines must match.
// After earlier removals, positions are again those of the pinned help text.
export function removeReviewedRoleHelpAdditions(help) {
  assert.equal(typeof help, 'string');
  const defaults = 'Defaults: Raw retention and Raw search maintenance are on (--no-raw disables retention).\n' +
    'Preferred memory reads: find_memory_candidates and read_memory_context (contextRead is on).\n' +
    '--no-context-read removes these tools; --no-context-semantic keeps reads BM25-only.\n' +
    "With OPENAI_API_KEY available to the Cairn MCP server, memories and search text\n" +
    "go to OpenAI for semantic search, up to an estimated US$1 per server run.\n" +
    "Saved conversations are sent only with --raw-semantic or an explicit\n" +
    "--context-embedder configuration. Raw document and query embeddings are off by default.\n" +
    "To keep everything on this computer, don't give the server a key.\n" +
    "--no-context-semantic only turns off embeddings; with a key, recall and other\n" +
    "model features still send memory text to OpenAI.\n" +
    'See docs/defaults.md for costs, options and every default.\n\n';
  if (help.includes('Defaults:')) {
    assert.equal(help.split(defaults).length, 2, 'exact default help block appears once');
    assert.ok(help.startsWith('Cairn Memory — local stdio MCP developer preview\n\n' + defaults), 'default help position');
    help = help.replace(defaults, '');
    const current = '  cairn-memory --db ABS --owner ID [--project ID] [--context-read context-read-v1 | --no-context-read] [--context-read-personal] [--raw-semantic]\n' +
      '    [--context-read-sources relations-one-hop-v1,moc-v1]\n' +
      '    [--context-embedder openai --context-embed-model MODEL --context-embed-dimensions N --context-embed-max-requests N --context-embed-max-usd X]';
    const legacy = '  cairn-memory --db ABS --owner ID [--project ID] --context-read context-read-v1 [--context-read-personal]\n' +
      '    [--context-read-sources relations-one-hop-v1,moc-v1]\n' +
      '    [--context-embedder openai --context-embed-model MODEL --context-embed-dimensions N --context-embed-max-requests N --context-embed-max-usd X]';
    assert.equal(help.split(current).length, 2, 'exact default usage appears once');
    help = help.replace(current, legacy);
    const currentContext = 'fetch_memory_candidate_evidence and read_memory_context by default. Read sets are fixed at startup; personal\n' +
      'reads require project scope and --context-read-personal. Semantic defaults on with OPENAI_API_KEY; otherwise reads use BM25.\n' +
      'Raw needs --raw-semantic or an explicit --context-embedder group for document\n' +
      'and query embedding. --no-context-semantic overrides both.\n' +
      'Background turns refresh configured embeddings. Explicit provider overrides\n' +
      'require all five provider options together. Hosted uses rrf-k10.';
    const legacyContext = 'fetch_memory_candidate_evidence only. Read sets are fixed at startup; personal\n' +
      'reads require project scope and --context-read-personal. Semantic defaults to false.\n' +
      'Only explicit context refresh embeds documents. All five provider options are\n' +
      'required together; a key alone never constructs an embedder. Hosted uses rrf-k10.';
    assert.equal(help.split(currentContext).length, 2, 'exact default context help appears once');
    help = help.replace(currentContext, legacyContext);
  }
  const lines = help.split('\n');
  let previous = 0;
  for (const addition of allowlist.additions) {
    const index = addition.insertBeforePinnedLine - 1;
    assert.ok(Number.isSafeInteger(index) && index > previous);
    assert.ok(addition.feature.length && addition.lines.length);
    assert.equal(lines[index - 1], addition.previousPinnedLine, 'reviewed help addition moved: preceding pinned line');
    assert.deepEqual(lines.slice(index, index + addition.lines.length), addition.lines, 'reviewed help addition bytes/order changed');
    assert.equal(lines[index + addition.lines.length], addition.nextPinnedLine, 'reviewed help addition moved: following pinned line');
    lines.splice(index, addition.lines.length);
    previous = index;
  }
  return lines.join('\n');
}

// PR 2 adds this optional knob only to the two context-enabled tools lists.
// Preserve the historical oracle: remove exactly its approved schema, then
// let the caller compare every remaining serialized byte with the frozen pin.
export function removeReviewedDatedContextOption(probe) {
  for (const mode of ['context', 'combined']) {
    const original = probe[mode].tools, listed = JSON.parse(original);
    assert.equal(JSON.stringify(listed), original, 'tools serialization changed');
    const matches = listed.tools.filter(tool => tool.name === 'read_memory_context');
    assert.equal(matches.length, 1, 'one context assembly tool per reviewed mode');
    const schema = matches[0].inputSchema;
    assert.equal(JSON.stringify(schema.properties.representation),
      '{"type":"string","enum":["representation-v2","representation-v2-dated"]}',
      'reviewed dated representation option changed');
    assert.ok(!schema.required.includes('representation'), 'representation stays optional');
    delete schema.properties.representation;
    probe[mode].tools = JSON.stringify(listed);
  }
  return probe;
}

// Project only the documented default presentation and explicit opt-out fields.
export function withReviewedReadDefaults(probe) {
  const expected = structuredClone(probe);
  for (const mode of ['plain', 'methods', 'context', 'combined', 'assets']) {
    const listed = JSON.parse(expected[mode].tools);
    for (const tool of listed.tools) {
      tool.description = tool.description
        .replace('Retrieve relevant current memories and source receipts.', 'Legacy model-assisted recall; prefer find_memory_candidates and read_memory_context. Retrieve relevant current memories and source receipts.')
        .replace('Search the fixed host read set. Semantic defaults to false; explicit semantic true', 'Preferred memory read: search the fixed host read set. Semantic defaults on with a configured embedding provider; semantic false selects BM25 only. Semantic lookup')
        .replace('Assemble whole canonical bodies and sources within an exact local token budget. Semantic defaults to false; explicit semantic true', 'Preferred memory read: assemble dated Memory and Raw sources within an exact local token budget. Semantic defaults on with a configured embedding provider; semantic false selects BM25 only. Semantic lookup');
      if (tool.name === 'read_memory_context') tool.inputSchema.properties.maxTokens.maximum = 6000;
    }
    expected[mode].tools = JSON.stringify(listed);
    // Reviewed core facade addition: the forgotten-text read follows reject on the core facade. No MCP tool changes.
    const core = JSON.parse(expected[mode].core);
    const anchor = core.keys.indexOf('reject');
    if (anchor < 0 || core.keys.includes('isSuppressed')) throw new Error('reviewed core facade anchor');
    core.keys.splice(anchor + 1, 0, 'isSuppressed');
    expected[mode].core = JSON.stringify(core);
  }
  for (const index of [1, 2]) {
    const { ok, mode, ...check } = JSON.parse(expected.cli.stdout[index]);
    expected.cli.stdout[index] = JSON.stringify({ ok, mode, raw: false, rawSearch: false, rawSemantic: false, rawSemanticReason: 'raw_semantic_not_enabled', contextRead: false, ...check }, null, 2);
  }
  const { ok: contextOk, mode: contextMode, contextRead, ...contextCheck } = JSON.parse(expected.cli.stdout[3]);
  expected.cli.stdout[3] = JSON.stringify({ ok: contextOk, mode: contextMode, contextRead, rawSemantic: false, rawSemanticReason: 'raw_semantic_not_enabled', ...contextCheck });
  expected.cli.parse = JSON.stringify({ ...JSON.parse(expected.cli.parse), contextRead: false, raw: false });
  return expected;
}
