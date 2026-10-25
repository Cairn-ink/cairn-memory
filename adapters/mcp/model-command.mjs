import { absolutePath, qualification } from '../local-embedder/common.mjs';
import { installPack } from '../local-embedder/install.mjs';
import { verifyPack } from '../local-embedder/pack.mjs';
import { LOCAL_OPERATIONAL_CODES } from '../../core/context-read-local-status.mjs';
export function parseModelCommand(args) {
  try {
    const [operation, model, ...rest] = args;
    if (!['install', 'verify'].includes(operation) || model !== 'bge-m3') throw 0;
    const values = new Map(); let check = false;
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i];
      if (flag === '--check-config') { if (check) throw 0; check = true; continue; }
      if (flag !== '--dir' || values.has(flag)) throw 0;
      const value = rest[++i]; if (!value || value.startsWith('--')) throw 0;
      values.set(flag, absolutePath(value));
    }
    if (!values.has('--dir')) throw 0;
    return Object.freeze({ operation, model, dir: values.get('--dir'), check });
  } catch { throw Object.assign(Error('invalid_model_configuration'), { code: 'invalid_model_configuration' }); }
}
export async function modelCommand(args, { install = installPack, verify = verifyPack, output = value => console.log(JSON.stringify(value)) } = {}) {
  try {
    const c = parseModelCommand(args);
    if (c.check) { output({ ok: true, mode: 'configuration-check', operation: c.operation, model: c.model, dir: c.dir,
      packStatus: 'not-inspected', revision: null, runtimeLoaded: false, childStarted: false, networkAccessed: false,
      modelKeyInspected: false, databaseOpened: false, providerContacted: false, qualification: qualification() }); return; }
    const p = await (c.operation === 'install' ? install : verify)(c.dir);
    output({ ok: true, operation: c.operation, model: c.model, dir: c.dir, manifestHash: p.manifestHash,
      revision: p.metadata.revision, runtimeStatus: 'not-loaded', qualification: p.qualification,
      nativeSelection: p.fence.target ? { os: p.fence.target.os, arch: p.fence.target.arch, libc: p.fence.target.libc, minOs: p.fence.target.minOs, nodeAbi: p.fence.target.nodeAbi } : null,
      notices: ['FP32 baseline: approximately 3 GB installed; observed RSS approximately 2.2 GB, not a cap.', 'MIT model provenance; Apache-2.0/MIT notices; LGPL libvips source obligations.'] });
  } catch (e) {
    const code = ['invalid_model_configuration', ...LOCAL_OPERATIONAL_CODES.filter(code => code.startsWith('model_'))].includes(e?.code) ? e.code : 'model_pack_unavailable';
    output({ ok: false, error: { code, retryable: false } }); process.exitCode = 1;
  }
}
