const startup = Number(process.env.TEST_STARTUP_MS ?? 0);
if (startup) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, startup);

const time = Number(process.env.TEST_WALL_TIME);
if (Number.isFinite(time)) {
  const RealDate = Date;
  globalThis.Date = class extends RealDate {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  };
}

const send = (kind, details = {}) => process.send?.({ kind, ms: performance.now(), ...details });
const fetchOriginal = globalThis.fetch;
globalThis.fetch = function (url, options) {
  const route = new URL(url).pathname;
  send("fetch", { route });
  return fetchOriginal(url, options);
};
const write = process.stdout.write.bind(process.stdout);
process.stdout.write = function (...args) {
  send("stdout");
  return write(...args);
};
process.channel?.unref();
