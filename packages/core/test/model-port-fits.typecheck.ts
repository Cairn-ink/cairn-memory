// Compile-only: an adapter may implement ModelPort with or without the optional fits hook.
import type { ModelPort, ModelRequest, ModelStage, CallOptions } from "../src/ports/index.d.ts";

const base = {
  model: "m",
  contextWindow: 8192,
  async call(_stage: ModelStage, _request: ModelRequest, _options: CallOptions): Promise<unknown> { return {}; },
  countTokens(text: string): number { return text.length; },
};

export const withoutFits: ModelPort = base;
export const withFits: ModelPort = { ...base, fits: (_stage: ModelStage, _request: ModelRequest): boolean => true };

export function planWith(port: ModelPort, stage: ModelStage, request: ModelRequest): boolean {
  if (typeof port.fits !== "function") return true;
  try { return port.fits(stage, request) === true; } catch { return false; }
}
