import type { DecisionContext, DecisionContextOptions, RelatePlacedOptions, RelatePlacedReport } from './types.d.ts';

export declare const RATIONALE_LIMITS: Readonly<{
  refs: 6;
  placed: 5;
  proposalEdges: 10;
  degree: 10;
  inspectEdges: 10;
  inspectSources: 6;
  snapshotUnits: 24000;
  receipts: 100;
  excerptUnits: 800;
  queryUnits: 4000;
}>;
export declare function cutRationaleText(text: string, limit: number): string;
export declare function decisionContext(options: DecisionContextOptions): Promise<DecisionContext>;
export declare function relatePlaced(options: RelatePlacedOptions): Promise<RelatePlacedReport>;
export type { DecisionContext, DecisionContextOptions, RationaleDiscovery, RelatePlacedOptions,
  RelatePlacedReport } from './types.d.ts';
