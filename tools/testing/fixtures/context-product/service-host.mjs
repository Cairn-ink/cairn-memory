// Maintenance has its own trusted host authority domain, for independent service and request credentials.
// Its service binding cannot issue ordinary request reads.
import { createContextReadHost as createHost } from './host.mjs';
export async function createContextReadHost(configuration) {
  if(!configuration.serviceBinding||configuration.requestBinding)throw Error('authority_required');
  return createHost(configuration);
}
