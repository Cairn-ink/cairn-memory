import { boundedText } from '../../core/validation.mjs';

// Capture truncates the normalized source view; admission then canonicalizes that bounded
// excerpt again before storage, including trimming whitespace exposed at the boundary.
export const canonicalStoredReceiptExcerpt = (text) =>
  boundedText(boundedText(text, 800, true), 800, true);
