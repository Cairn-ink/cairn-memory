import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { readHostProfile,readHostConfiguration,fail } from './local-host-profile.mjs';
import { inspectPreparation } from './local-host-preparation.mjs';
import { checkHostPermission,checkRearmSession } from './local-host-permission.mjs';
import { loadIdentity } from './local-worker-state.mjs';
import { inspectExistingStorePin } from '../../../core/existing-store.mjs';

export async function withSessionIdentity(profile,config,selection,work) {
  const identity=await loadIdentity({stateRoot:profile.stateRoot,identityKeyPath:profile.identityKeyPath,authority:localAuthorityInput(config.authority)},selection,{check(){}});
  try { return await work(identity); } finally { identity.key.fill(0); }
}
export async function checkLocalSession(profile,config,selection) {
  await withSessionIdentity(profile,config,selection,identity=>checkRearmSession(config,identity));
}
// A fork fence needs no transcript or qualified host: it only removes authority.
// Session identity is the same stable HMAC used by every later worker/rearm.
export async function fenceLocalSession(profilePath,selection) {
  const profile=await readHostProfile(profilePath),config=await readHostConfiguration(profile);
  if (await inspectPreparation(profile,config) !== 'ready') fail('preparation_invalid');
  await checkHostPermission(config);
  await withSessionIdentity(profile,config,selection,async identity=>{
    const pin=await inspectExistingStorePin(config.databasePath,config.authority.storeId);
    const { openMemoryCore }=await import('../../../core/index.mjs');
    const core=openMemoryCore({path:config.databasePath,existingStore:pin,rawSearch:false,
      rawConversations:{mode:'off',configureCap:false,localAuthority:config.authority,readPolicy:()=>({generation:'local-fork-fence-v1',reason:'tool_off'})}});
    try {
      await checkHostPermission(config);
      const result=core.fenceSession({namespace:config.authority.namespace,client:config.authority.client,sessionId:identity.wireSessionId});
      if (!result.ok) fail('capture_refused');
    } finally { await core.close(); }
  });
}
