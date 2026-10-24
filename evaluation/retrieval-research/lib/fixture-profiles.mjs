import { deepFreeze } from './immutable.mjs';

export const VERSION = 'hr1-fixture-v2';
export const HR2B_VERSION = 'hr2b-fixture-v1';
const common = { countTolerance: .1, distributionTolerance: .05, meanTolerance: .15,
  languages: { zh: .55, en: .30, mixed: .15 }, minSpans: 1, minimumTargetFamilies: 40, maxBodyUTF16: 4000, maxSpanUTF16: 800 };
export const FIXTURE_PROFILES = deepFreeze({
  [VERSION]: { ...common, version: VERSION, counts: { S300: 300, extras: 700, foreign: 100 }, maxSpans: 3,
    spanOnlyGroupBand: [.35, .45] },
  [HR2B_VERSION]: { ...common, version: HR2B_VERSION, counts: { S300: 160, extras: 320, foreign: 60 }, maxSpans: 6,
    bodyBands: [[120, 180, .30], [180, 260, .40], [260, 400, .30]],
    receiptBands: [[40, 70, .35], [70, 130, .40], [130, 200, .25]],
    receiptHistogram: [.20, .25, .25, .15, .10, .05],
    placementShares: { body: .45, 'first-receipt': .25, 'later-receipt': .30 },
    renderedFactsPerFamily: 7, absentFactsPerFamily: 1,
    memoryFactBand: [2, 4], bodySentenceBand: [3, 8], maxParagraphs: 2,
    quotas: { groups: 30, families: 12, guardTestFamilies: 10, guardDevFamilies: 4 } },
});
