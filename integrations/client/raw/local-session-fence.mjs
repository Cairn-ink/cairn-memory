import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { readHostProfile,readHostConfiguration,hostSelection,fail } from './local-host-profile.mjs';
import { inspectPreparation } from './local-host-preparation.mjs';
import { checkHostPermission,checkRearmSession } from './local-host-permission.mjs';
import { loadIdentity, readSession, chooseResumeHint, dropResumeHint } from './local-worker-state.mjs';
import { inspectExistingStorePin } from '../../../core/existing-store.mjs';

export async function withSessionIdentity(profile,config,selection,work,operation = {check(){}}) {
  const identity=await loadIdentity({stateRoot:profile.stateRoot,identityKeyPath:profile.identityKeyPath,authority:localAuthorityInput(config.authority)},selection,operation);
  if (identity.status === 'deadline') return identity;
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
export async function checkSweepSession(profile,config,selection,operation = {check(){}}) {
  return withSessionIdentity(profile,config,selection,async identity => {
    try {
      if (operation.check() === false) return {status:'deadline'};
      hostSelection(selection,false);
      const cursor = await readSession(identity,config.authority.client,false,operation);
      if (cursor?.status === 'deadline') return cursor;
      if (!cursor) fail('state_invalid');
      if (operation.check() === false) return {status:'deadline'};
      await checkRearmSession(config,identity);
      if (operation.check() === false) return {status:'deadline'};
    } catch (error) {
      if (operation.check() === false) return {status:'deadline'};
      await dropResumeHint(identity); throw error;
    }
  },operation);
}
export async function selectLocalResume(profilePath,operation = {check(){}}) {
  try {
    if (operation.check() === false) return {status:'deadline'};
    const profile = await readHostProfile(profilePath);
    if (operation.check() === false) return {status:'deadline'};
    const config = await readHostConfiguration(profile);
    if (operation.check() === false) return {status:'deadline'};
    await checkHostPermission(config);
    if (operation.check() === false) return {status:'deadline'};
    return await withSessionIdentity(profile,config,{sessionId:''},async identity => {
      const options = {stateRoot:profile.stateRoot,identityKeyPath:profile.identityKeyPath,authority:localAuthorityInput(config.authority)};
      const candidate = await chooseResumeHint(options,identity,operation);
      if (operation.check() === false) return {status:'deadline'};
      if (!candidate || candidate.status === 'deadline') return candidate;
      try {
        const outcome = await checkSweepSession(profile,config,candidate.selection,operation);
        if (operation.check() === false || outcome?.status === 'deadline') return {status:'deadline'};
      } catch {
        if (operation.check() === false) return {status:'deadline'};
        await dropResumeHint(identity,candidate.sessionKey+'.json'); return null;
      }
      return candidate.selection;
    },operation);
  } catch (error) {
    if (operation.check() === false) return {status:'deadline'};
    throw error;
  }
}
