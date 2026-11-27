// Explicit imports for the native-only hook graph. The MCP startup graph cannot reach these modules.
export const captureImports = {
  "core/local-authority-input.mjs": {
    "builtins": {
      "util": "types"
    }
  },
  "core/raw-input.mjs": {
    "globals": [
      "Buffer"
    ]
  },
  "core/validation.mjs": {
    "builtins": {
      "crypto": "createHash"
    }
  },
  "integrations/client/common-profile.mjs": {
    "builtins": {
      "crypto": "createHash"
    },
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/file-lock.mjs": {
    "builtins": {
      "crypto": "randomUUID",
      "fs/promises": "link mkdir readFile unlink writeFile",
      "path": "dirname"
    },
    "process": [
      "kill",
      "pid"
    ],
    "globals": [
      "setTimeout",
      "clearTimeout",
      "performance"
    ]
  },
  "integrations/client/hosted-contract.mjs": {
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/hosted-schemas.mjs": {},
  "integrations/client/private-state.mjs": {
    "builtins": {
      "fs": "closeSync constants fstatSync lstatSync openSync readFileSync readdirSync realpathSync",
      "async_hooks": "AsyncLocalStorage",
      "fs/promises": "link lstat mkdir open readdir realpath rename unlink",
      "path": "basename dirname isAbsolute join resolve",
      "crypto": "randomUUID"
    },
    "process": [
      "getuid",
      "pid",
      "platform"
    ]
  },
  "integrations/client/raw/bounds.mjs": {
    "builtins": {
      "perf_hooks": "performance",
      "async_hooks": "AsyncLocalStorage"
    },
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/raw/claude.mjs": {
    "globals": [
      "Buffer",
      "Boolean"
    ]
  },
  "integrations/client/raw/codex.mjs": {
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/raw/json-stream.mjs": {
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/raw/local-rearm-state.mjs": {
    "builtins": {
      "crypto": "createHash createHmac",
      "path": "join"
    },
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/raw/local-source-open.mjs": {
    "builtins": {
      "fs": "constants",
      "fs/promises": "lstat open",
      "path": "isAbsolute normalize",
      "async_hooks": "AsyncLocalStorage"
    },
    "process": [
      "getuid",
      "platform"
    ],
    "globals": [
      "Boolean"
    ]
  },
  "integrations/client/raw/message.mjs": {
    "builtins": {
      "crypto": "createHmac"
    },
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/raw/planner.mjs": {
    "builtins": {
      "util": "isDeepStrictEqual"
    }
  },
  "integrations/client/raw/protocol.mjs": {
    "globals": [
      "Boolean",
      "Buffer"
    ]
  },
  "integrations/client/raw/redact.mjs": {},
  "integrations/client/raw/scratch.mjs": {
    "builtins": {
      "fs/promises": "lstat mkdtemp open rmdir unlink",
      "os": "tmpdir",
      "path": "join",
      "fs": "constants"
    },
    "globals": [
      "Buffer"
    ]
  },
  "integrations/client/raw/selection.mjs": {},
  "integrations/client/redact.mjs": {},
  "integrations/client/source-time.mjs": {},
  "integrations/codex/parser.mjs": {},
  "integrations/codex/session-source.mjs": {
    "globals": [
      "Buffer"
    ]
  },
  "integrations/codex/source.mjs": {
    "builtins": {
      "fs": "constants",
      "fs/promises": "open",
      "path": "isAbsolute normalize",
      "async_hooks": "AsyncLocalStorage"
    },
    "process": [
      "getuid",
      "platform"
    ],
    "globals": [
      "Buffer"
    ]
  },
  "packaging/core-local/capture-binding.mjs": {
    "builtins": {
      "crypto": "createHash",
      "path": "basename dirname join",
      "fs/promises": "lstat realpath"
    }
  },
  "packaging/core-local/capture-cli.mjs": {
    "builtins": {
      "url": "fileURLToPath pathToFileURL",
      "timers": "clearTimeout setTimeout",
      "buffer": "Buffer"
    },
    "moduleURL": true,
    "process": [
      "argv",
      "env",
      "exitCode",
      "once",
      "removeListener",
      "stdin",
      "stdout"
    ],
    "globals": [
      "AbortController"
    ]
  },
  "packaging/core-local/capture-codex-qualification.mjs": {
    "builtins": {
      "fs/promises": "lstat readFile readdir readlink stat",
      "crypto": "createHash",
      "path": "basename dirname join"
    },
    "process": [
      "getuid",
      "platform",
      "ppid"
    ]
  },
  "packaging/core-local/capture-dispatch.mjs": {},
  "packaging/core-local/capture-hook.mjs": {
    "builtins": {
      "fs/promises": "lstat realpath stat",
      "path": "join relative",
      "timers": "clearTimeout setTimeout",
      "perf_hooks": "performance"
    },
    "process": [
      "getuid"
    ],
    "globals": [
      "AbortController"
    ]
  },
  "packaging/core-local/capture-input.mjs": {
    "builtins": {
      "util": "types",
      "path": "resolve"
    }
  },
  "packaging/core-local/capture-lock.mjs": {
    "builtins": {
      "fs/promises": "readFile readlink",
      "path": "dirname"
    },
    "process": [
      "kill",
      "platform"
    ]
  },
  "packaging/core-local/capture-progress.mjs": {},
  "packaging/core-local/capture-slot.mjs": {
    "builtins": {
      "sqlite": "DatabaseSync"
    }
  },
  "packaging/core-local/capture-source.mjs": {
    "builtins": {
      "buffer": "Buffer"
    },
    "process": [
      "platform"
    ]
  },
  "packaging/core-local/capture-start.mjs": {
    "builtins": {
      "path": "join"
    }
  },
  "packaging/core-local/capture-state.mjs": {
    "builtins": {
      "buffer": "Buffer",
      "crypto": "createHmac",
      "path": "join",
      "fs/promises": "opendir"
    }
  },
  "plugins/cairn-memory/lib/redact.mjs": {},
  "plugins/cairn-memory/lib/source-time.mjs": {},
  "plugins/cairn-memory/lib/transcript.mjs": {
    "builtins": {
      "crypto": "createHash",
      "url": "fileURLToPath"
    },
    "moduleURL": true,
    "globals": [
      "URL",
      "Buffer",
      "Boolean"
    ]
  }
};

export const captureAdapterImports = {
  'migrate/capture-controls.mjs': 'readMigratedControls migratedCaptureControls',
  'migrate/raw-privacy.mjs': 'createMigratedRawPolicy',
  'raw-lineage.mjs': 'allowsRawSession',
  'suppressions.mjs': 'sessionHasher',
  'pause.mjs': 'readPause',
};
