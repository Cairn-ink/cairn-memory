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

if (process.env.TEST_REAL_CACHE_RACE !== "1") {
  const cacheRaceFrame = /\bat readContextCache \([^\n]*[/\\]scripts[/\\]hook\.mjs:\d+:\d+\)/;
  const stretch = 100;
  const rawSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = function (callback, milliseconds, ...args) {
    const cacheRace = milliseconds === 100 && cacheRaceFrame.test(new Error().stack);
    return rawSetTimeout(callback, cacheRace ? milliseconds * stretch : milliseconds, ...args);
  };
  // Keep the monotonic cutoff in the same time scale as its timer. Other hook
  // budgets continue to see the real clock.
  const now = performance.now.bind(performance);
  Object.defineProperty(performance, "now", { value() {
    const elapsed = now();
    return cacheRaceFrame.test(new Error().stack?.split("\n")[2]) ? elapsed / stretch : elapsed;
  } });
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
