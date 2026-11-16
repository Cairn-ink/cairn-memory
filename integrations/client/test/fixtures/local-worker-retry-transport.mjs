// Only the isolated retry test's loader substitutes this synthetic transport.
let capture;
export function useCapture(handler) { capture = handler; }
export function createLocalCaptureTransport() {
  return { capture: (...args) => capture(...args) };
}
