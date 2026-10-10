import test from 'node:test';
import assert from 'node:assert/strict';
import { copyCode, clipboardCommands, formatCode, spinner } from '../lib/device-ui.mjs';
import { translator } from '../lib/messages.mjs';

const code = 'UGSU-LF4L';

test('code formatting honors TTY and NO_COLOR without depending on FORCE_COLOR', () => {
  assert.equal(formatCode(code, {tty:true,env:{}}), `\x1b[1;36m${code}\x1b[0m`);
  for (const env of [{NO_COLOR:''}, {NO_COLOR:'1',FORCE_COLOR:'1'}]) {
    assert.equal(formatCode(code, {tty:true,env}), `[ ${code} ]`);
  }
  assert.equal(formatCode(code, {tty:false,env:{FORCE_COLOR:'1'}}), `[ ${code} ]`);
});

test('clipboard candidates use only fixed local tools appropriate to the desktop', () => {
  const commands = options => clipboardCommands({env:{},wsl:false,...options});
  assert.deepEqual(commands({platform:'darwin'}), [['pbcopy',[]]]);
  assert.deepEqual(commands({platform:'win32'}), [['clip.exe',[]]]);
  assert.deepEqual(commands({platform:'linux',wsl:true}), [['clip.exe',[]]]);
  assert.deepEqual(commands({platform:'linux'}), []);
  assert.deepEqual(commands({platform:'linux',wsl:true,env:{DISPLAY:':0'}}), [['clip.exe',[]],['xclip',['-selection','clipboard']],['xsel',['--clipboard','--input']]]);
  assert.deepEqual(commands({platform:'linux',env:{WAYLAND_DISPLAY:'wayland-0',XDG_RUNTIME_DIR:'/run/user/fixture',DISPLAY:':0'}}), [
    ['wl-copy',['--type','text/plain']], ['xclip',['-selection','clipboard']], ['xsel',['--clipboard','--input']],
  ]);
  for (const key of ['SSH_CONNECTION','SSH_CLIENT','SSH_TTY']) {
    assert.deepEqual(commands({platform:'darwin',env:{[key]:'fixture'}}), []);
  }
});

test('clipboard transfers only a validated user code via stdin; Windows uses Unicode and buffers are wiped', async () => {
  for (const platform of ['darwin','win32']) {
    let owned;
    const copied = await copyCode(code, {platform,env:{},wsl:false,run:async (command,args,input)=>{
      assert.deepEqual(args, []); assert.ok(!command.includes(code)); owned=input;
      assert.equal(input.toString(platform==='win32'?'utf16le':'utf8'), (platform==='win32'?'\ufeff':'')+code);
      return true;
    }});
    assert.equal(copied, true); assert.ok(owned.every(value=>value===0));
  }
  let calls=0;
  for (const secret of ['synthetic-bearer-token', 'UGSU-LF4L\n', '', null]) {
    assert.equal(await copyCode(secret, {platform:'darwin',env:{},run:async()=>{calls++;return true;}}), false);
  }
  assert.equal(calls, 0);
});

test('missing/failing clipboard tools fall through, and cancellation stops remaining candidates', async () => {
  const calls=[];
  const env={DISPLAY:':0'};
  assert.equal(await copyCode(code,{platform:'linux',wsl:false,env,run:async(command)=>{
    calls.push(command); if(command==='xclip') throw new Error('missing'); return true;
  }}), true);
  assert.deepEqual(calls,['xclip','xsel']);
  const controller=new AbortController(); calls.length=0;
  assert.equal(await copyCode(code,{platform:'linux',wsl:false,env,signal:controller.signal,run:async(command)=>{
    calls.push(command);controller.abort();return false;
  }}),false);
  assert.deepEqual(calls,['xclip']);
});

test('TTY spinner renders remaining time without repeating the code; plain output has no terminal escapes', () => {
  for (const lang of ['zh','en']) {
    const t=translator(lang),plain=[],terminal=[];
    spinner(line=>plain.push(line),583,false,t,code,{tty:false})();
    const stop=spinner(()=>{},()=>583,false,t,code,{tty:true,render:value=>terminal.push(value)});
    stop();
    assert.doesNotMatch(plain[0], /UGSU-LF4L/); assert.match(plain[0], /9:43/); assert.doesNotMatch(plain[0], /\x1b/);
    assert.match(terminal[0], /⠋.*9:43/); assert.equal(terminal.at(-1),'\r\x1b[K');
  }
});
