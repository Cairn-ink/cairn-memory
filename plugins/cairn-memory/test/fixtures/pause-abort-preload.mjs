// Rendezvous on a real request instead of waiting for the production timeout.
const timeout = AbortSignal.timeout;
AbortSignal.timeout = function (milliseconds) {
  if (milliseconds !== 25000) return timeout.call(this, milliseconds);
  const controller = new AbortController();
  process.send?.({ kind: 'pause-timeout', milliseconds });
  process.once('message', event => {
    if (event.kind === 'abort-pause') controller.abort(new DOMException('Synthetic timeout', 'TimeoutError'));
    process.channel?.unref();
  });
  process.channel?.unref();
  return controller.signal;
};
