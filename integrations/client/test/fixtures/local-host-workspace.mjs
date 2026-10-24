import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fixture, ok } from '../../../../adapters/local/test/fixtures/workspace.mjs';
import { createLocalRawHost, withLocalHostDependencies } from '../../raw/local-host.mjs';
import { binaryIdentity, canonical, KNOWN_FORMATS, detectRunningHost } from '../../../codex/qualification.mjs';
import { claude, codex, sessionId } from './raw-fixtures.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export async function hostFixture(t,{ client = 'claude-code' } = {}) {
  const f = fixture(t,{ client });
  f.config.provider.apiKeyEnv='CAIRN_SYNTHETIC_API_KEY'; f.save();
  const profilePath=join(f.workspace.path,'profile.json'),stateRoot=join(f.workspace.path,'worker-state'),identityKeyPath=join(f.workspace.path,'identity.key');
  const pluginRoot=join(f.workspace.path,'plugin'); mkdirSync(pluginRoot,{mode:0o700});
  const qroot=join(f.workspace.path,'codex-install'),qdir=join(qroot,'qualification');
  mkdirSync(qroot,{mode:0o700});mkdirSync(qdir,{mode:0o700});
  const qualificationConfigPath=join(qroot,'installation.json');writeFileSync(qualificationConfigPath,'{}',{mode:0o600});
  const binary=join(f.workspace.path,'codex');writeFileSync(binary,'synthetic native binary',{mode:0o700});
  const identity=await binaryIdentity(binary),verdictPath=join(qdir,identity+'.json');
  const verdict={policy:sha(canonical(KNOWN_FORMATS)),identity,version:'0.162.0',status:'qualified',fingerprint:KNOWN_FORMATS[1]};
  writeFileSync(verdictPath,JSON.stringify(verdict),{mode:0o600});
  const profile={version:'local-raw-host-profile-v1',configPath:f.configPath,configDigest:sha(readFileSync(f.configPath)),
    stateRoot,identityKeyPath,home:join(f.workspace.path,'home'),installation:client==='claude-code'?{client,pluginRoot}:{client,qualificationConfigPath}};
  const saveProfile=()=>writeFileSync(profilePath,JSON.stringify(profile),{mode:0o600});saveProfile();
  const sourcePath=join(f.workspace.path,'source.jsonl');
  const header={type:'session_meta',payload:{id:sessionId,cli_version:'0.162.0',history_mode:'paginated',source:'cli',originator:'codex-tui'}};
  const saveSource=(meta=header)=>writeFileSync(sourcePath,(client==='codex'?JSON.stringify(meta)+'\n':'')+JSON.stringify(client==='codex'?codex('synthetic_source_secret'):claude('synthetic_source_secret'))+'\n',{mode:0o600});saveSource();
  const selection={sessionId,sourcePath};
  let exec=false,hostPresent=true;
  const detectHost=async()=>{
    if(!hostPresent)return undefined;
    const detected=await detectRunningHost({pid:42,proc:'/synthetic/proc',identity:async()=>identity,link:async()=>binary,
      read:async path=>Buffer.from(path.endsWith('cmdline')?'codex\0'+(exec?'exec\0':''):'42 (codex) S 1 0 0')});
    const {processPath,...host}=detected;return host;
  };
  const host=createLocalRawHost({profilePath});
  const call=(action,value,dependencies={})=>withLocalHostDependencies({detectHost,...dependencies},()=>
    ['status','prepare'].includes(action)?host[action](value??{}):host[action](value??selection));
  const disable=()=>{
    const current=ok(f.core.getLocalCaptureControl({namespace:f.namespace,client}));
    return ok(f.core.setLocalCaptureControl({namespace:f.namespace,client,targetId:current.targetId,expectedStoreId:current.storeId,
      expectedRevision:current.revision,automaticCaptureEnabled:false,rawNoticeVersion:current.rawNoticeVersion}));
  };
  const snapshot=()=>{
    const result={};
    function visit(dir){for(const entry of readdirSync(dir)){const path=join(dir,entry),stat=lstatSync(path),key=relative(f.workspace.path,path);
      result[key]={mode:stat.mode&0o777,ino:stat.ino,...(stat.isFile()?{sha:sha(readFileSync(path))}:{})};if(stat.isDirectory())visit(path);}}
    visit(f.workspace.path);return result;
  };
  return {...f,profilePath,stateRoot,identityKeyPath,pluginRoot,profile,saveProfile,sourcePath,header,saveSource,selection,host,call,disable,snapshot,
    verdict,verdictPath,binary,setExec:value=>{exec=value},setHost:value=>{hostPresent=value}};
}
