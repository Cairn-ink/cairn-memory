export const TOKENIZER_VERSION: "hr1-t1-v1";
export const REPRESENTATION_VERSION: "candidate-text-v1";
export const ENGLISH_STOPWORDS: ReadonlySet<string>;
export function tokenizeT1(text: string): string[];
export function termFrequencies(text: string): { length: number; frequencies: Map<string, number> };
