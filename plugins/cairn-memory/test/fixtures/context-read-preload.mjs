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
if (process.env.TEST_SLOW_ACCOUNT_FINGERPRINT === "1") {
  const crypto = process.getBuiltinModule("node:crypto");
  const scrypt = crypto.scrypt;
  crypto.scrypt = function (password, salt, length, options, callback) {
    if (salt !== "cairn-context-read-account-v1") return scrypt(...arguments);
    send("fingerprint-native-start");
    // Increase the native work and give OpenSSL enough memory for that cost.
    return scrypt(password, salt, length, { ...options, N: 131072, maxmem: 256 * 1024 * 1024 }, (...result) => {
      send("fingerprint-native-complete");
      callback(...result);
    });
  };
  process.getBuiltinModule("node:module").syncBuiltinESMExports();
}

const routeTickFrame = /\bat contextCacheRouteTick \([^\n]*[/\\]scripts[/\\]hook\.mjs:\d+:\d+\)/;
const cacheLookupFrame = /\bat readContextCache \([^\n]*[/\\]scripts[/\\]hook\.mjs:\d+:\d+\)/;
const realRouteTick = process.env.TEST_REAL_CACHE_ROUTE_TICK === "1";
const rawSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = function (callback, milliseconds, ...args) {
  const stack = new Error().stack;
  const routeTick = routeTickFrame.test(stack);
  if (routeTick || cacheLookupFrame.test(stack)) send("cache-timer", { milliseconds });
  return rawSetTimeout(callback, routeTick && milliseconds === 0 && !realRouteTick ? 100 : milliseconds, ...args);
};

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
