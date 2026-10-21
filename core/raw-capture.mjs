import { createMemoryCore } from './contract.mjs';
import { composeRawCore } from './raw-composition.mjs';
import { fail } from './validation.mjs';

/** Internal compatibility construction only; intentionally absent from installed files. */
export function openRawCaptureCore(input, rawOptions) {
  const sourcesDescriptor = Object.getOwnPropertyDescriptor(rawOptions, 'sources');
  if (sourcesDescriptor && (!Object.hasOwn(sourcesDescriptor, 'value') || typeof sourcesDescriptor.value !== 'boolean')) fail('invalid_input');
  const sources = sourcesDescriptor?.value === true;
  if (sources && !input.privateCards) fail('authority_required');
  const deletionDescriptor = Object.getOwnPropertyDescriptor(rawOptions, 'deletion');
  if (deletionDescriptor && (!Object.hasOwn(deletionDescriptor, 'value') || typeof deletionDescriptor.value !== 'boolean')) fail('invalid_input');
  const deletion = sources || deletionDescriptor?.value === true;
  const descriptor = Object.getOwnPropertyDescriptor(rawOptions, 'lineage');
  if (descriptor && (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value !== 'boolean')) fail('invalid_input');
  const lineage = deletion || descriptor?.value === true;
  return composeRawCore(createMemoryCore, input, rawOptions, { sources, lineage, deletion });
}
