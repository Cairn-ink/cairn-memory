import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createCairnServer } from '../../server.mjs';
import { parseConfiguration } from '../../cli.mjs';
import { rationaleModel } from '../../../../core/testing/rationale-model.mjs';
globalThis.fetch = () => { throw new Error('offline_only'); };
const handle = serveStdio(() => createCairnServer({ ...parseConfiguration(process.argv.slice(2)), model: rationaleModel() }));
process.stdin.once('end', () => { void handle.close(); });
process.once('SIGTERM', () => { void handle.close(); });
