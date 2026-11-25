import type { ExtractedQuantity, PeriodTaggedRecord, QuantityValidation, QuantityValidationOptions } from '../ledger/index.mjs';

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
/** Set quantities only for a host with the quantityLedger capability. */
export type ExtractionOptions = { quantities?: boolean };
export function plainExtractionSpec(messages: readonly InputMessage[], options?: ExtractionOptions): ExtractSpec;
/** Throws an error with an ExtractionValidationCode for an invalid batch. */
export function validatePlainCandidates(output: unknown, policy: CandidatePolicy): Candidate[];
/** Default quantity validation drops period-tagged records. Capture may retain them for the occasion check. */
export function validatePlainExtraction(output: unknown, policy: CandidatePolicy,
  options?: ExtractionOptions & { datedRecords?: false }):
  { items: Candidate[] } & QuantityValidation;
export function validatePlainExtraction(output: unknown, policy: CandidatePolicy,
  options: ExtractionOptions & QuantityValidationOptions):
  { items: Candidate[] } & QuantityValidation<ExtractedQuantity | PeriodTaggedRecord>;
