// Installer-only conflict handling. Shared pairing/runtime semantics stay unchanged.
import { join } from 'node:path';
import { homedir } from 'node:os';
import { realpath, lstat, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { detectClients, probeClaudeFacts, resolveClaudeBinding } from '../runtime/integrations/client/pairing.mjs';
import { privateRead, privateWrite, privateDirectory, syncDirectory } from '../runtime/integrations/client/private-state.mjs';
import { stateLock } from '../runtime/integrations/client/state-lock.mjs';
import { SetupError } from './errors.mjs';
const yes = value => /^(?:y|yes)$/iu.test(value.trim());
const fingerprint = text => createHash('sha256').update(text).digest('hex');
const display = (path, home) => path.startsWith(home + '/') ? '~/' + path.slice(home.length + 1) : path;
export async function identitySnapshot(options) {
  const detected = await detectClients(options);
  const keys = [];
  for (const root of detected.keys.slice().sort()) {
    const path = join(root, 'project-key');
    const info = await lstat(path);
    keys.push({root, fingerprint:fingerprint(await privateRead(path)),
      dev:info.dev, ino:info.ino, mtimeMs:info.mtimeMs, ctimeMs:info.ctimeMs,
      created:info.birthtimeMs || info.ctimeMs});
  }
  return {detected,keys};
}
export async function assertIdentityUnchanged(plan, {allowInstallChanges=false}={}) {
  let current;
  try {current = await identitySnapshot(plan.options);}
  catch {throw new SetupError('identity_changed',2);}
  if (JSON.stringify(current.keys) !== JSON.stringify(plan.snapshot.keys) ||
      JSON.stringify(current.detected.record) !== JSON.stringify(plan.snapshot.detected.record) ||
      (!allowInstallChanges && JSON.stringify(current.detected.install)!==JSON.stringify(plan.snapshot.detected.install)))
    throw new SetupError('identity_changed', 2);
  return current;
}
export async function chooseIdentity({prompt,write,t,interactive}) {
  const home = await realpath(homedir());
  const options = {home, setup:true, standardClaudeOrigin:true};
  const snapshot = await identitySnapshot(options), {detected} = snapshot;
  if (detected.keys.length <= 1 || detected.record) return undefined;
  if (!interactive) throw new SetupError('identity_conflict', 2);
  if (detected.keys.length !== 2) throw new SetupError('identity_conflict', 2);
  const profileRoot = detected.install.clients.claude?.profileRoot ??
    process.env.CLAUDE_PLUGIN_DATA ?? detected.locations.knownClaudeRoot;
  const facts = await probeClaudeFacts({client:'claude',home,env:{HOME:home,CLAUDE_PLUGIN_DATA:profileRoot}});
  const binding = resolveClaudeBinding(facts);
  const claudeRoot = binding.enabled && detected.keys.includes(binding.root) ? binding.root : undefined;
  const ordered = snapshot.keys.slice().sort((a,b) => a.root === claudeRoot ? -1 : b.root === claudeRoot ? 1 : 0);
  write('');
  write(t('identity_choices',{choices:ordered.map((key,index)=>
    `  ${index+1}. ${key.root===claudeRoot?t('identity_claude'):display(key.root,home)}  `+
    t('identity_created',{date:new Date(key.created).toLocaleDateString(t.locale)})).join('\n')}));
  let root;
  if (claudeRoot) {
    const answer = await prompt(t('ask_identity_claude'));
    if (!answer.trim() || yes(answer)) root = claudeRoot;
    else {
      const other = detected.keys.find(value=>value!==claudeRoot);
      if (yes(await prompt(t('ask_identity_other',{root:display(other,home)})))) root = other;
      else return {declined:true};
    }
  } else {
    const answer = (await prompt(t('ask_identity_number'))).trim();
    if (!['1','2'].includes(answer)) throw new SetupError('identity_conflict', 2);
    root = ordered[Number(answer)-1].root;
  }
  const others = detected.keys.filter(value=>value!==root);
  if (Object.values(detected.install.clients).some(value=>others.includes(value.root)) ||
      others.includes(detected.record?.root)) throw new SetupError('identity_bound',2);
  return {options,snapshot,root,others,home,backups:[]};
}
// Called by initializePairing's checkpoint while its setup.lock is held.
export async function backupIdentity(plan) {
  await assertIdentityUnchanged(plan,{allowInstallChanges:true});
  const stamp = new Date().toISOString().replace(/[-:]/gu,'').replace('T','-').slice(0,15);
  plan.receipt = join(plan.snapshot.detected.locations.coordination,`key-backup-${stamp}-${randomUUID()}.json`);
  const entries = plan.others.map(root => ({original:join(root,'project-key'),
    backup:join(root,`project-key.backup-${stamp}-${randomUUID()}`)}));
  // Publish recovery intent before moving keys, so an interrupted process leaves evidence.
  await privateWrite(plan.receipt,JSON.stringify({version:1,selectedRoot:plan.root,entries,state:'pending'}));
  for (const entry of entries) {
    await link(entry.original,entry.backup); // exclusive: never clobber an existing backup
    plan.backups.push(entry);
    await unlink(entry.original);
    await syncDirectory(plan.others[plan.backups.length-1]);
  }
  await privateWrite(plan.receipt,JSON.stringify({version:1,selectedRoot:plan.root,entries,state:'backed-up'}));
}
export async function restoreIdentity(plan) {
  if (!plan?.backups.length) return;
  await privateDirectory(plan.snapshot.detected.locations.coordination);
  await stateLock(join(plan.snapshot.detected.locations.coordination,'setup.lock'),async()=>{
    for (const entry of plan.backups.slice().reverse()) {
      try { await link(entry.backup,entry.original); }
      catch(error) {
        if (error.code!=='EEXIST') throw error;
        const [a,b] = await Promise.all([lstat(entry.backup),lstat(entry.original)]);
        if (a.ino!==b.ino || a.dev!==b.dev) throw new Error('backup_restore_conflict');
      }
      await unlink(entry.backup);
      await syncDirectory(plan.others.find(root=>entry.original===join(root,'project-key')));
    }
    plan.backups=[];
    await privateWrite(plan.receipt,JSON.stringify({version:1,selectedRoot:plan.root,state:'restored'}));
  },{timeoutMs:2000});
}
export function reportBackups(plan,write,t) {
  for(const entry of plan?.backups??[])write(t('identity_backup',{path:display(entry.backup,plan.home)}));
}
