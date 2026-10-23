import { openContextReader as openContextReaderFacade } from './context-read-facade.mjs';

export function openContextReader(input) {
  return openContextReaderFacade(input);
}
