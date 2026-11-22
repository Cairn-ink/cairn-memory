export type VectorSpec = {
  id: string;
  revision: string;
  dimensions: number;
  normalization: 'l2';
};

export function decodeEmbeddingData(data: unknown, requestedCount: number, spec: VectorSpec): Float32Array[];
