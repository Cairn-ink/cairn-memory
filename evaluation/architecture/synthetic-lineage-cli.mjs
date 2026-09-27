import { runSyntheticLineage } from './synthetic-lineage.mjs';

const report = await runSyntheticLineage();
console.log(JSON.stringify({ synthetic: report.synthetic, semanticAccuracy: report.semanticAccuracy,
  scenarios: report.scenarios.map(item => ({ scenario: item.scenario, status: item.status,
    reason: item.reason, sourceCount: item.sourceCount, memoryCount: item.memoryCount,
    overflow: item.overflow, sources: item.sources.map(source => ({ source: source.source,
      extraction: source.extraction, admission: source.admission, filing: source.filing,
      visible: source.visible, selected: source.selected, rankInput: source.rankInput,
      rankOutput: source.rankOutput, returned: source.returned, packed: source.packed })) })) }));
