import { fail } from './validation.mjs';
import { types } from 'node:util';
import { localAuthorityInput } from './local-authority-input.mjs';

// Inspect only the three port slots, never enumerate or clone opaque host state.
function portOption(port) {
  try {
    if (!port || !['object', 'function'].includes(typeof port)) fail('raw_crypto_unavailable');
    const slot = name => {
      const seen = new Set();
      for (let owner = port; owner !== null; owner = Object.getPrototypeOf(owner)) {
        if (seen.has(owner)) fail('raw_crypto_unavailable');
        seen.add(owner);
        const descriptor = Object.getOwnPropertyDescriptor(owner, name);
        if (descriptor) {
          if (!Object.hasOwn(descriptor, 'value')) fail('raw_crypto_unavailable');
          return descriptor.value;
        }
      }
    };
    const version = slot('version'), seal = slot('sealRaw'), open = slot('openRaw');
    if (version !== 'raw-seal-v1' || typeof seal !== 'function' || typeof open !== 'function') fail('raw_crypto_unavailable');
    return Object.freeze({ version,
      sealRaw: (...args) => Reflect.apply(seal, port, args),
      openRaw: (...args) => Reflect.apply(open, port, args),
    });
  } catch { fail('raw_crypto_unavailable'); }
}

/** Public constructor preflight only; no store or host callback is opened here. */
export function rawOptions(value) {
  let fields;
  try {
    if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
    fields = Object.getOwnPropertyDescriptors(value);
    if (Reflect.ownKeys(fields).some(key => typeof key !== 'string' ||
        !['mode', 'port', 'capBytes', 'readPolicy', 'localAuthority'].includes(key) || !Object.hasOwn(fields[key], 'value'))) fail('invalid_input');
  } catch { fail('invalid_input'); }
  if (!Object.hasOwn(fields, 'mode') || !Object.hasOwn(fields, 'readPolicy')) fail('invalid_input');
  const mode = fields.mode.value, readPolicy = fields.readPolicy.value;
  const localAuthority = Object.hasOwn(fields,'localAuthority') ? localAuthorityInput(fields.localAuthority.value) : undefined;
  if (!['off', 'raw-v1'].includes(mode) || typeof readPolicy !== 'function') fail('invalid_input');
  const hasCap = Object.hasOwn(fields, 'capBytes'), capBytes = fields.capBytes?.value;
  if ((hasCap || mode === 'raw-v1') && (!Number.isSafeInteger(capBytes) || capBytes < 1)) fail('invalid_input');
  const hasPort = Object.hasOwn(fields, 'port');
  const port = hasPort || mode === 'raw-v1' ? portOption(fields.port?.value) : undefined;
  return Object.freeze({ mode, readPolicy, ...(hasCap ? { capBytes } : {}), ...(hasPort ? { port } : {}), ...(localAuthority ? { localAuthority } : {}) });
}
