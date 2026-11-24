import type { StorageAdapter } from '@cairn-ink/core/ports';
import { createMemoryAdapter } from '@cairn-ink/adapter-memory';

export const defaults: StorageAdapter = createMemoryAdapter();
export const implicitOff: StorageAdapter = createMemoryAdapter({ capabilities: { placement: true } });
export const explicitOff: StorageAdapter = createMemoryAdapter({ capabilities: { documentCards: false } });
