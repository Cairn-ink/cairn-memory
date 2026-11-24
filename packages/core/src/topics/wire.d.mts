import type { ClassificationInput } from './packing.mjs';
import type { PlacementProposal } from './proposal.mjs';

export interface ClassificationSchema {
  type?: 'string' | 'array' | 'object';
  enum?: string[];
  items?: ClassificationSchema;
  minItems?: number;
  maxItems?: number;
  anyOf?: ClassificationSchema[];
  properties?: Record<string, ClassificationSchema>;
  required?: string[];
  additionalProperties?: false;
}

export interface ClassificationWire {
  readonly input: ClassificationInput;
  decode(output: PlacementProposal): PlacementProposal;
}

export function classifySchema(input: unknown): ClassificationSchema;
export function classificationWire(input: ClassificationInput): ClassificationWire;
export function schemaAccepts(schema: ClassificationSchema, value: unknown): boolean;
