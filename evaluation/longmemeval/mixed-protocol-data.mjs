// Cold protocol data only. Deliberate factory changes require the ordered drift gate;
// never refresh these snapshots automatically or import execution-bearing factories.
import { freeze, hash } from './mixed-validation.mjs';

const sourceBody = freeze({
  version: 'cairn-lme-mixed-source-v2',
  date: { grammar: 'YYYY/MM/DD (Ddd) HH:mm', years: [1900, 9999],
    clock: 'dataset-local-floating-minute', cutoff: 'include-at-or-before;preserve-source-order',
    canonicalLabel: 'YYYY-MM-DD HH:mm' },
  normalization: 'NFKC;redactSecrets;Unicode-whitespace-to-ASCII-space;trim',
  rendering: { prefix: '[session-date: ${YYYY-MM-DD HH:mm}; clock: dataset-local] source{',
    suffix: ' }', roles: ['user', 'assistant'],
    chunks: 'greedy-longest-capture-stable-code-point-prefix;full-turn-first' },
  limits: { inputUtf8Bytes: 8 * 1024 * 1024, traversalDepth: 16, traversalNodes: 200_000,
    sessions: 2_500, originalTurns: 60_000, messageUtf16: 4_000,
    partitionProbeUtf16: 32 * 1024 * 1024, batchMessages: 24, batchUtf16: 20_000,
    indexedWindowUtf16: 800, indexedWindowsPerBatch: 64, batches: 2_500,
    queryUtf16: 4_000, queryUtf8Bytes: 16 * 1024, mem0InputUtf8Bytes: 8 * 1024 * 1024 },
  originClasses: ['metadata-or-mixed', 'normalized-source', 'original-source'],
  query: 'normalizeCaptureText(JSON.stringify({question:originalText,date:canonicalDate}))',
  hashDomains: { policy: 'cairn.lme.mixed-source.policy.v2',
    history: 'cairn.lme.mixed-source.original-history.v2',
    turn: 'cairn.lme.mixed-source.rendered-turn.v2', case: 'cairn.lme.mixed-source.case.v2' },
});
export const MIXED_SOURCE_POLICY = freeze({ ...sourceBody,
  digest: hash(sourceBody.hashDomains.policy, sourceBody) });
const suppliedBody = freeze({ ...sourceBody, version: 'cairn-lme-supplied-history-v1',
  date: { ...sourceBody.date, cutoff: 'include-all-supplied;preserve-source-order',
    timestamps: 'preserve;no-repair' },
  hashDomains: { policy: 'cairn.lme.supplied-history.policy.v1',
    history: 'cairn.lme.supplied-history.original-history.v1',
    turn: 'cairn.lme.supplied-history.rendered-turn.v1', case: 'cairn.lme.supplied-history.case.v1' },
});
export const SUPPLIED_HISTORY_POLICY = freeze({ ...suppliedBody,
  digest: hash(suppliedBody.hashDomains.policy, suppliedBody) });

export const MEM0_WIRE_PROFILE = freeze({
  "version": "mem0-text-wire-v1",
  "chat": {
    "model": "gpt-4.1-mini-2025-04-14",
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "encoding": "o200k_base",
    "maxInputTokens": 32768,
    "maxOutputTokens": 2000,
    "inputFramingTokens": 1024,
    "maxRequestBytes": 1048576,
    "maxResponseBytes": 262144,
    "inputPrice": {
      "microUsdNumerator": 2,
      "tokenDenominator": 5
    },
    "outputPrice": {
      "microUsdNumerator": 8,
      "tokenDenominator": 5
    },
    "reservedMicroUsd": 16308,
    "maxFacts": 256,
    "maxFactTokens": 8192
  },
  "embedding": {
    "model": "text-embedding-3-small",
    "endpoint": "https://api.openai.com/v1/embeddings",
    "encoding": "cl100k_base",
    "maxItemInputTokens": 8192,
    "maxInputTokens": 300000,
    "maxOutputTokens": 0,
    "inputFramingTokens": 0,
    "maxRequestBytes": 4194304,
    "maxResponseBytes": 8388608,
    "inputPrice": {
      "microUsdNumerator": 1,
      "tokenDenominator": 50
    },
    "outputPrice": {
      "microUsdNumerator": 0,
      "tokenDenominator": 1
    },
    "minimumReservedMicroUsd": 1,
    "dimensions": 1536,
    "encodingFormat": "float",
    "maxItems": 100
  }
});

export const BENCHMARK_STAGE_POLICY = freeze({
  "answer": {
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4.1-mini-2025-04-14",
    "reservedMicroUsd": 50820,
    "maxRequestBytes": 1500000,
    "maxResponseBytes": 262144,
    "timeoutMs": 180000,
    "maxInputTokens": 125000,
    "maxOutputTokens": 512,
    "inputTokenFraming": 1024,
    "inputPrice": {
      "microUsdNumerator": 2,
      "tokenDenominator": 5
    },
    "outputPrice": {
      "microUsdNumerator": 8,
      "tokenDenominator": 5
    }
  },
  "judge": {
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4o-2024-08-06",
    "reservedMicroUsd": 10400,
    "maxRequestBytes": 100000,
    "maxResponseBytes": 65536,
    "timeoutMs": 60000,
    "maxInputTokens": 4096,
    "maxOutputTokens": 16,
    "inputTokenFraming": 256,
    "inputPrice": {
      "microUsdNumerator": 5,
      "tokenDenominator": 2
    },
    "outputPrice": {
      "microUsdNumerator": 10,
      "tokenDenominator": 1
    }
  }
});

export const EXPERIMENT_POLICY = freeze({
  "version": 1,
  "hostCompletion": {
    "endpoint": "https://api.openai.com/v1/chat/completions",
    "model": "gpt-4.1-mini-2025-04-14",
    "reservedMicroUsd": 50000,
    "maxRequestBytes": 98000,
    "maxResponseBytes": 262144,
    "timeoutMs": 60000,
    "maxInputTokens": 100000,
    "maxOutputTokens": 1024,
    "inputTokenFraming": 1024,
    "inputPrice": {
      "microUsdNumerator": 2,
      "tokenDenominator": 5
    },
    "outputPrice": {
      "microUsdNumerator": 8,
      "tokenDenominator": 5
    }
  },
  "cairnCount": {
    "endpoint": "https://api.openai.com/v1/responses/input_tokens",
    "model": "gpt-4.1-mini-2025-04-14",
    "reservedMicroUsd": 5000,
    "maxRequestBytes": 100000,
    "maxResponseBytes": 262144,
    "timeoutMs": 60000,
    "maxInputTokens": 7024,
    "maxOutputTokens": 0,
    "inputTokenFraming": 1024,
    "inputPrice": {
      "microUsdNumerator": 2,
      "tokenDenominator": 5
    },
    "outputPrice": {
      "microUsdNumerator": 8,
      "tokenDenominator": 5
    }
  },
  "cairnGeneration": {
    "endpoint": "https://api.openai.com/v1/responses",
    "model": "gpt-4.1-mini-2025-04-14",
    "reservedMicroUsd": 5000,
    "maxRequestBytes": 100000,
    "maxResponseBytes": 262144,
    "timeoutMs": 60000,
    "maxInputTokens": 7024,
    "maxOutputTokens": 1024,
    "inputTokenFraming": 1024,
    "inputPrice": {
      "microUsdNumerator": 2,
      "tokenDenominator": 5
    },
    "outputPrice": {
      "microUsdNumerator": 8,
      "tokenDenominator": 5
    }
  }
});

export const OFFICIAL_PROTOCOL = freeze({
  "judgeModel": "gpt-4o-2024-08-06",
  "upstreamCommit": "9e0b455f4ef0e2ab8f2e582289761153549043fc",
  "questionTypes": [
    "single-session-user",
    "single-session-assistant",
    "single-session-preference",
    "temporal-reasoning",
    "knowledge-update",
    "multi-session"
  ]
});

export const MODEL_ID = 'gpt-4.1-mini-2025-04-14';
