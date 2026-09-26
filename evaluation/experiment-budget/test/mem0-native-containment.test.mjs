// Explicit LOCAL containment gate; the synthetic -c command substitutes only
// the final child command after production bubblewrap mount assembly.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readlinkSync, rmSync, statSync,
  writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { checkedMem0NativeArtifact, inspectMem0NativeArtifact } from '../mem0-native-artifact.mjs';
import { bubblewrapArguments } from '../mem0-native-runtime.mjs';

test('Y8/Y14 exact production mounts deny host canary/env/network and keep UDS socket read-only',
  async t => {
    const venvRoot = process.env.CAIRN_MEM0_NATIVE_VENV_ROOT;
    const pythonRoot = process.env.CAIRN_MEM0_NATIVE_PYTHON_ROOT;
    assert.ok(venvRoot && pythonRoot, 'explicit pinned local roots required');
    const artifact = inspectMem0NativeArtifact({ venvRoot, pythonRoot });
    const roots = checkedMem0NativeArtifact(artifact);
    const caseRoot = mkdtempSync(join(tmpdir(), 'cairn-y-containment-'));
    t.after(() => rmSync(caseRoot, { recursive: true, force: true }));
    const canary = join(caseRoot, 'host-canary');
    const socket = join(caseRoot, 'gateway.sock');
    const store = join(caseRoot, 'store');
    mkdirSync(store, { mode: 0o700 });
    mkdirSync(join(store, 'tmp'), { mode: 0o700 });
    mkdirSync(join(store, 'cache'), { mode: 0o700 });
    writeFileSync(canary, 'synthetic canary only');
    const listener = net.createServer(connection => connection.destroy());
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(socket, resolve);
    });
    t.after(() => listener.close());
    const socketMode = statSync(socket).mode & 0o777;
    const hostNetworkNamespace = readlinkSync('/proc/self/ns/net');
    const childFile = new URL('../testing/mem0-native-child.py', import.meta.url).pathname;
    const args = bubblewrapArguments({ roots, childFile, socket, store });
    const separator = args.lastIndexOf('--');
    assert.ok(separator > 0);
    const interpreter = args[separator + 1];
    const probe = `import errno,json,os,socket\n` +
      `canary=${JSON.stringify(canary)}\n` +
      `readonly=False\n` +
      `try: os.chmod('/case/gateway.sock',0o777)\n` +
      `except OSError as exc: readonly=exc.errno in (errno.EROFS,errno.EPERM)\n` +
      `rootreadonly=True\n` +
      `for place in ('/tmp','/app'):\n` +
      `  try: open(place+'/synthetic-write','w').close(); rootreadonly=False\n` +
      `  except OSError as exc: rootreadonly=rootreadonly and exc.errno in (errno.EROFS,errno.EACCES,errno.EPERM)\n` +
      `with open('/case/store/synthetic-write','w') as out: out.write('synthetic')\n` +
      `storewritable=os.path.exists('/case/store/synthetic-write')\n` +
      `os.unlink('/case/store/synthetic-write')\n` +
      `probe=socket.socket(socket.AF_INET,socket.SOCK_STREAM)\n` +
      `probe.settimeout(0.2)\n` +
      `network=probe.connect_ex(('192.0.2.1',9))\n` +
      `probe.close()\n` +
      `print(json.dumps({'canaryHidden':not os.path.exists(canary),` +
      `'envHidden':'CAIRN_Y_TEST_SECRET' not in os.environ and 'OPENAI_BASE_URL' not in os.environ,` +
      `'socketReadonly':readonly,` +
      `'rootReadonly':rootreadonly,'storeWritable':storewritable,` +
      `'netNamespaceDifferent':os.readlink('/proc/self/ns/net')!=${JSON.stringify(hostNetworkNamespace)},` +
      `'networkDenied':network in (errno.ENETUNREACH,errno.EHOSTUNREACH,errno.ENETDOWN,errno.EPERM)}))`;
    args.splice(separator + 1, args.length, interpreter, '-I', '-B', '-c', probe);
    const child = spawn('bwrap', args, { env: { CAIRN_Y_TEST_SECRET: 'synthetic-private' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderrBytes = 0;
    child.stdout.on('data', chunk => {
      stdout += chunk.toString('utf8');
      assert.ok(Buffer.byteLength(stdout) <= 4096);
    });
    child.stderr.on('data', chunk => { stderrBytes += chunk.length; assert.ok(stderrBytes <= 4096); });
    const closed = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('containment_timeout')); },
        10_000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolve(code); });
    });
    assert.equal(closed, 0, 'contained synthetic probe must exit normally');
    assert.deepEqual(JSON.parse(stdout), { canaryHidden: true, envHidden: true,
      socketReadonly: true, rootReadonly: true, storeWritable: true,
      netNamespaceDifferent: true, networkDenied: true });
    assert.equal(statSync(socket).mode & 0o777, socketMode);
  });
