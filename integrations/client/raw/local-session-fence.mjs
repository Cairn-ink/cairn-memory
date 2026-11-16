import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { readHostProfile,readHostConfiguration,hostSelection,fail } from './local-host-profile.mjs';
import { inspectPreparation } from './local-host-preparation.mjs';
import { checkHostPermission,checkRearmSession } from './local-host-permission.mjs';
import { loadIdentity, readSession, chooseResumeHint, dropResumeHint } from './local-worker-state.mjs';
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

// These checks precede even source()'s lstat/realpath proof. readSession also
// rejects a stale authority or incomplete rearm without reading the transcript.
export async function checkSweepSession(profile,config,selection) {
  await withSessionIdentity(profile,config,selection,async identity => {
    try {
      hostSelection(selection,false);
      if (!await readSession(identity,config.authority.client)) fail('state_invalid');
      await checkRearmSession(config,identity);
    } catch (error) { await dropResumeHint(identity); throw error; }
  });
}
export async function selectLocalResume(profilePath) {
  const profile = await readHostProfile(profilePath), config = await readHostConfiguration(profile);
  await checkHostPermission(config);
  return withSessionIdentity(profile,config,{sessionId:''},async identity => {
    const options = {stateRoot:profile.stateRoot,identityKeyPath:profile.identityKeyPath,authority:localAuthorityInput(config.authority)};
    const candidate = await chooseResumeHint(options,identity,{check(){}});
    if (!candidate) return null;
    try { await checkSweepSession(profile,config,candidate.selection); }
    catch { await dropResumeHint(identity,candidate.sessionKey+'.json'); return null; }
    return candidate.selection;
  });
}
