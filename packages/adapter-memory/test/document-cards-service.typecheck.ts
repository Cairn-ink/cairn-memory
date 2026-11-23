import { createMemoryAdapter } from '@cairn-ink/adapter-memory';
import { createMemoryService, type MemoryServiceDeps } from '@cairn-ink/core/service';
import type { readMethod } from '../../core/src/service/find.mjs';

declare const deps: Omit<MemoryServiceDeps, 'storage'>;

// The installed adapter and core sources have distinct brands on the unrelated Raw port.
export const service = createMemoryService({
  ...deps,
  storage: createMemoryAdapter({
    capabilities: { documentCards: true, placement: true },
  }) satisfies Omit<Parameters<typeof readMethod>[0], 'raw'>,
});
