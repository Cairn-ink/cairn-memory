export type InputMessage = Readonly<{ role: 'user' | 'assistant'; content: string }>;
export type Kind = 'fact' | 'preference' | 'decision' | 'instruction' | 'context';
export type ExtractSpec = {
  system: string;
  input: { messages: Array<InputMessage & { index: number }> };
  schema: object;
};
export type Candidate = { content: string; kind: Kind; confidence: number; sourceIndices: number[] };
export type CandidatePolicy = { sourceCount: number; itemLimit: number };
export type ExtractionValidationCode =
  | 'invalid_extraction_output_shape'
  | 'invalid_extraction_item_shape'
  | 'invalid_extraction_text'
  | 'invalid_extraction_value'
  | 'invalid_extraction_source_shape'
  | 'invalid_extraction_source_duplicate'
  | 'invalid_extraction_source_range';

export const EXTRACT_MEMORIES_PROMPT: string;
export function plainExtractionSpec(messages: readonly InputMessage[]): ExtractSpec;
/** Throws an error with an ExtractionValidationCode for an invalid batch. */
export function validatePlainCandidates(output: unknown, policy: CandidatePolicy): Candidate[];
