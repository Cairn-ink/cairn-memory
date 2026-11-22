import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join } from 'node:path';
import { lazyFixture } from './fixtures/local-setup-workspace.mjs';
import { sessionId } from './fixtures/raw-fixtures.mjs';
import { readHostConfiguration, readHostProfile } from '../raw/local-host-profile.mjs';
import { withSessionIdentity } from '../raw/local-session-fence.mjs';
import { sessionStartSource, writeSessionStartAttempt } from '../raw/local-session-start.mjs';
import { stateLock } from '../state-lock.mjs';

async function fixture(t) {
  const f = await lazyFixture(t,'claude-code');
  const profile = await readHostProfile(join(f.request.installationDirectory,'host-profile.json'));
  const config = await readHostConfiguration(profile);
  const selection = { sessionId,sourcePath:f.sourcePath };
  const selected = work => withSessionIdentity(profile,config,selection,work);
  return selected(identity => {
    const starts = join(identity.stateRoot,'starts');
    const marker = join(starts,identity.sessionKey+'.json');
    const attempt = join(starts,identity.sessionKey+'.attempt.json');
    const binding = { authority:identity.authorityCommitment,source:sessionStartSource(identity,selection) };
    const attemptBytes = kind => JSON.stringify({ version:'local-raw-start-attempt-v1',...binding,kind });
    const publishAttempt = kind => selected(current => writeSessionStartAttempt(current,binding.source,kind));
    return { ...f,starts,marker,attempt,binding,attemptBytes,publishAttempt,lock:identity.lockPath,
      markerBytes:JSON.stringify({ version:'local-raw-start-v1',...binding }) };
  });
}

function seed(f,path,bytes) {
  mkdirSync(f.starts,{ recursive:true,mode:0o700 });
  writeFileSync(path,bytes,{ mode:0o600 });
}

function assertBoundary(f) {
  assert.equal(f.cursor().offset,statSync(f.sourcePath).size);
  assert.equal(f.cursor().issuedOrdinal,0);
  assert.deepEqual(f.cursor().selection,{ ownSkillTurn:true,awaitingUserBoundary:true });
}

const contents = path => readFileSync(path,'utf8');

test('legacy-only fresh attempt promotes to the ordinary marker',async t => {
  const f = await fixture(t);
  seed(f,f.marker,f.attemptBytes('fresh'));
  await f.publishAttempt('present');
  assert.equal(contents(f.marker),f.attemptBytes('fresh'));
  assert.equal(existsSync(f.attempt),false);
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(f.cursor().issuedOrdinal,1);
  assert.equal(contents(f.marker),f.markerBytes);
});

test('legacy-only present attempt survives EOF initialization and awaits a user boundary',async t => {
  const f = await fixture(t);
  const legacy = f.attemptBytes('present');
  seed(f,f.marker,legacy);
  assert.equal((await f.hook('Stop')).status,'ready');
  assertBoundary(f);
  assert.equal(contents(f.marker),legacy);
  f.append('Synthetic new user boundary');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(contents(f.marker),legacy);
});

test('new present attempt takes precedence over a legacy fresh attempt',async t => {
  const f = await fixture(t);
  const legacy = f.attemptBytes('fresh'), attempt = f.attemptBytes('present');
  seed(f,f.marker,legacy);
  seed(f,f.attempt,attempt);
  assert.equal((await f.hook('Stop')).status,'ready');
  assertBoundary(f);
  assert.equal(contents(f.marker),legacy);
  assert.equal(contents(f.attempt),attempt);
});

for (const [name,change] of [
  ['malformed JSON',() => '{'],
  ['stale authority',f => JSON.stringify({ ...JSON.parse(f.attemptBytes('present')),authority:'0'.repeat(64) })],
  ['foreign source',f => JSON.stringify({ ...JSON.parse(f.attemptBytes('present')),source:'0'.repeat(64) })],
  ['unsafe permissions',f => f.attemptBytes('present')],
]) test(`a new attempt with ${name} blocks fallback to a valid legacy attempt`,async t => {
  const f = await fixture(t);
  const legacy = f.attemptBytes('fresh'), attempt = change(f);
  seed(f,f.marker,legacy);
  seed(f,f.attempt,attempt);
  if (name === 'unsafe permissions') chmodSync(f.attempt,0o644);
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  assert.deepEqual(readdirSync(f.directory),[]);
  assert.equal(contents(f.marker),legacy);
  assert.equal(contents(f.attempt),attempt);
});

for (const [name,occupant] of [
  ['conflicting marker',f => JSON.stringify({ ...JSON.parse(f.markerBytes),source:'0'.repeat(64) })],
  ['invalid legacy occupant',f => JSON.stringify({ ...JSON.parse(f.attemptBytes('fresh')),extra:true })],
]) test(`fresh recovery preserves the ${name} in the marker slot`,async t => {
  const f = await fixture(t);
  const before = occupant(f), attempt = f.attemptBytes('fresh');
  seed(f,f.marker,before);
  seed(f,f.attempt,attempt);
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  assert.deepEqual(readdirSync(f.directory),[]);
  assert.equal(contents(f.marker),before);
  assert.equal(contents(f.attempt),attempt);
});

test('fresh hook attempt gets its own file and both records survive a failed cursor write',async t => {
  const f = await fixture(t);
  unlinkSync(f.sourcePath);
  assert.equal((await f.hook()).status,'ready');
  const ordinary = contents(f.marker);
  unlinkSync(f.marker);
  assert.equal((await stateLock(f.lock,() => f.hook())).reason,'state_busy');
  assert.deepEqual(readdirSync(f.starts),[basename(f.attempt)]);
  const attempt = contents(f.attempt);
  assert.equal(attempt,f.attemptBytes('fresh'));
  writeFileSync(f.sourcePath,'{"partial":',{ mode:0o600 });
  assert.equal((await f.hook('Stop')).reason,'partial_record');
  assert.equal(contents(f.marker),ordinary);
  assert.equal(contents(f.attempt),attempt);

  writeFileSync(f.sourcePath,'');
  f.append('Synthetic first turn after a partial record');
  const rename = fs.rename;
  let failed = false;
  fs.rename = async (from,to) => {
    if (to === join(f.directory,basename(f.marker))) {
      failed = true;
      throw Error('synthetic cursor publication failure');
    }
    return rename(from,to);
  };
  syncBuiltinESMExports();
  try { assert.equal((await f.hook('Stop')).status,'blocked'); }
  finally { fs.rename = rename; syncBuiltinESMExports(); }
  assert.equal(failed,true);
  assert.equal(contents(f.marker),ordinary);
  assert.equal(contents(f.attempt),attempt);
  assert.equal((await f.hook('Stop')).reason,'state_invalid');
  assert.equal(contents(f.marker),ordinary);
  assert.equal(contents(f.attempt),attempt);
});

for (const markerFirst of [true,false]) test(`interleaved publication with ${markerFirst ? 'marker then attempt' : 'attempt then marker'} preserves both and the marker wins`,async t => {
  const f = await fixture(t);
  unlinkSync(f.sourcePath);
  const method = markerFirst ? 'link' : 'rename';
  const publish = fs[method];
  let interleaved = false;
  fs[method] = async (from,to) => {
    if (!interleaved && to === (markerFirst ? f.attempt : f.marker)) {
      interleaved = true;
      if (markerFirst) {
        assert.equal((await f.hook()).status,'ready');
        assert.equal(contents(f.marker),f.markerBytes);
      } else {
        await f.publishAttempt('present');
        assert.equal(contents(f.attempt),f.attemptBytes('present'));
      }
    }
    return publish(from,to);
  };
  syncBuiltinESMExports();
  try {
    if (markerFirst) await f.publishAttempt('present');
    else assert.equal((await f.hook()).status,'ready');
  } finally { fs[method] = publish; syncBuiltinESMExports(); }
  assert.equal(interleaved,true);
  f.append('Synthetic turn authorized by the marker');
  assert.equal((await f.hook('Stop')).status,'progress');
  assert.equal(f.cursor().issuedOrdinal,1);
  assert.equal(contents(f.marker),f.markerBytes);
  assert.equal(contents(f.attempt),f.attemptBytes('present'));
});

test('explicit disable clears marker, attempt and both forms of regular temp file',async t => {
  const f = await fixture(t);
  const temp = '.tmp-123-00000000-0000-0000-0000-000000000000';
  seed(f,f.marker,f.markerBytes);
  seed(f,f.attempt,f.attemptBytes('fresh'));
  seed(f,f.marker+temp,'synthetic marker temp');
  seed(f,f.attempt+temp,'synthetic attempt temp');
  assert.equal((await f.invoke('disable')).status,'disabled');
  assert.deepEqual(readdirSync(f.starts),[]);
});
