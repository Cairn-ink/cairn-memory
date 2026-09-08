export const DEFAULT_MODEL = 'gpt-4.1-mini-2025-04-14';
export const EXPERIMENTAL_EXTRACTION_MODEL = 'gpt-5.4-mini-2026-03-17';

const baseline = Object.freeze({ model: DEFAULT_MODEL, contextWindow: 1047576,
  reservationUnits: 4448, inputRate: 0.4, outputRate: 1.6 });
const experimental = Object.freeze({ model: EXPERIMENTAL_EXTRACTION_MODEL, contextWindow: 400000,
  reasoning: Object.freeze({ effort: 'none' }), reservationUnits: 9876,
  inputRate: 0.75, outputRate: 4.5 });

export function modelProfile(extractionModel = DEFAULT_MODEL) {
  if (extractionModel !== DEFAULT_MODEL && extractionModel !== EXPERIMENTAL_EXTRACTION_MODEL) {
    throw new Error('invalid_openai_configuration');
  }
  return Object.freeze({ extract: extractionModel === DEFAULT_MODEL ? baseline : experimental,
    classify: baseline, select: baseline, rank: baseline });
}
