// Child process, run with HOME set to the disposable home. Mirrors the
// standalone branch of setupInstalledCodex without browser auth or MCP: the
// installer's own copyRuntime/mergeHooks, a standalone identity, credential,
// local policy and an enabled installation. Prime the actual native binary
// verdict before the first prompt; never patch or bypass a qualification gate.
import { writeFile, realpath } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { copyRuntime, mergeHooks } from '../../packages/setup/lib/codex-runtime.mjs';
import { writeCredential, validateInstallation } from '../../integrations/codex/installed-state.mjs';
import { resolveClient } from '../../integrations/client/pairing.mjs';
import { policyPath } from '../../integrations/client/automatic-policy.mjs';
import { privateWrite } from '../../integrations/client/private-state.mjs';

const { codexHome, endpoint, token, codex, hostVersion } = JSON.parse(process.argv[2]);
const home = await realpath(homedir());
if (!codexHome.startsWith(home + '/') || home !== process.env.HOME) throw new Error('not_disposable_home');
const directory = join(codexHome, 'cairn');
const path = join(directory, 'installation.json');
const runtime = await copyRuntime(directory);

const { resolveCLI, qualifyBinary } = await import(pathToFileURL(join(runtime,'integrations/codex/qualification.mjs')).href);
const host = await resolveCLI({ PATH: dirname(codex) });
const qualification = await qualifyBinary(path,host);
if (qualification.status !== 'qualified' || qualification.version !== hostVersion)
  throw new Error('a7_host_not_qualified');

const resolved = await resolveClient({ client: 'codex', home, usesClaude: false, initialize: true,
  env: { HOME: home }, root: join(codexHome, 'cairn-standalone'), isolatedCodex: true });
if (!resolved.enabled) throw new Error('identity_unavailable');
// A7 uses exec; this opt-in is confined to the disposable installation.
const config = validateInstallation({ version: 1, enabled: true, hostVersion, codex, node: process.execPath,
  home, root: resolved.root, usesClaude: false, pairingRecord: null, endpoint, runtime, dailyCap: 100, captureExec: true });
await writeCredential(path, endpoint, token);
await privateWrite(policyPath(config.root, endpoint), JSON.stringify({ version: 1, dailyCap: 100, concurrency: 2 }));
await privateWrite(path, JSON.stringify(config));
await writeFile(join(codexHome, 'hooks.json'), mergeHooks('', path, config, undefined, true), { mode: 0o600 });
process.stdout.write(JSON.stringify({ installation: path, runtime, root: config.root, forced: false,
  qualification: { status: qualification.status, version: qualification.version, fingerprint: qualification.fingerprint } }) + '\n');
