// Transport capabilities are reachable only after the managed serving dispatch.
export const daemonImports = {
  'packaging/core-local/daemon-authority.mjs': {
    builtins: { crypto: 'createHash', 'fs/promises': 'realpath', path: 'basename dirname join', url: 'fileURLToPath' },
    moduleURL: true,
  },
  'packaging/core-local/daemon-entry.mjs': {
    builtins: { net: 'createConnection', child_process: 'spawn', crypto: 'randomInt', url: 'fileURLToPath',
      events: 'once', perf_hooks: 'performance', 'timers/promises': 'setTimeout', stream: 'PassThrough' },
    globals: ['URL', 'fetch'], moduleURL: true,
    process: ['execPath', 'execArgv', 'stdin', 'stdout', 'stderr', 'exitCode', 'platform', 'once', 'off', 'env'],
  },
  'packaging/core-local/daemon-worker.mjs': {
    builtins: { net: 'createServer', 'fs/promises': 'chmod', crypto: 'randomBytes', perf_hooks: 'performance',
      timers: 'clearInterval clearTimeout setInterval setTimeout' },
    process: ['argv', 'exit', 'exitCode', 'off', 'once', 'stderr', 'umask'],
  },
  'packaging/core-local/raw-cli.mjs': {
    builtins: { crypto: 'randomUUID', path: 'isAbsolute', perf_hooks: 'performance',
      'timers/promises': 'setTimeout' },
    process: ['stdout', 'stderr', 'exitCode'],
  },
  'packaging/core-local/wal-checkpoint.mjs': {
    builtins: { 'node:sqlite': 'DatabaseSync', url: 'pathToFileURL' },
  },
  'adapters/mcp/local-daemon-identity.mjs': {
    builtins: { crypto: 'createHash createHmac', 'fs/promises': 'lstat stat realpath readFile statfs',
      fs: 'statSync realpathSync', path: 'resolve join dirname basename', url: 'fileURLToPath' },
    globals: ['Buffer', 'Boolean', 'URL'], moduleURL: true,
    process: ['env', 'cwd', 'getuid', 'execPath', 'version', 'execArgv'],
  },
  'adapters/mcp/local-daemon-liveness.mjs': {
    builtins: { fs: 'readFileSync readlinkSync statSync', 'fs/promises': 'readdir', path: 'join', crypto: 'createHash' },
    globals: ['performance', 'setTimeout'],
    process: ['pid', 'platform', 'hrtime', 'getuid', 'kill', 'stdout'],
  },
  'adapters/mcp/local-daemon-state.mjs': {
    builtins: { fs: 'constants', 'fs/promises': 'lstat mkdir realpath statfs open link rename unlink',
      path: 'join resolve', crypto: 'randomBytes' },
    globals: ['Buffer', 'performance', 'setTimeout'], process: ['getuid', 'platform', 'pid'],
  },
  'adapters/mcp/local-daemon-wire.mjs': {
    builtins: { crypto: 'randomBytes createHmac timingSafeEqual', stream: 'Transform' },
    globals: ['Buffer', 'performance', 'setTimeout', 'clearTimeout'],
  },
  'adapters/mcp/local-forwarder.mjs': {
    builtins: { net: 'createConnection', child_process: 'spawn', crypto: 'randomInt', url: 'fileURLToPath',
      path: 'resolve', events: 'once' },
    globals: ['Buffer', 'URL', 'performance', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'], moduleURL: true,
    process: ['execPath', 'execArgv', 'argv', 'stdin', 'stdout', 'stderr', 'once', 'off', 'exitCode', 'hrtime'],
  },
};
