import { units, SCRATCH_BUFFER_BYTES } from './scratch.mjs';

const word = char => /^[A-Za-z0-9_]$/.test(char);
const token = char => /^[A-Za-z0-9_-]$/.test(char);
const space = char => char!=='' && /\s/.test(char);
const identifier = char => /^[a-z0-9_]$/i.test(char);
const bearer = char => /^[A-Za-z0-9._~+\/-]$/.test(char);
const value = char => char!=='' && !/[\s"']/.test(char);
const replacement = '[REDACTED]';

async function literal(read,start,text,insensitive=false) {
  for (let index=0;index<text.length;index++) {
    const char = await read(start+index);
    if ((insensitive ? char.toLowerCase():char)!==text[index]) return false;
  }
  return true;
}
async function run(read,start,accept) { let end=start; while (accept(await read(end))) end++; return end; }
async function header(read,start,kind) {
  const prefix = '-----'+kind;
  if (!await literal(read,start,prefix)) return null;
  let at = start+prefix.length;
  if (await literal(read,at,' PRIVATE KEY-----')) return at+17;
  if (await read(at++)!==' ') return null;
  const tagEnd = await run(read,at,char => /^[A-Z]$/.test(char));
  if (tagEnd===at || !await literal(read,tagEnd,' PRIVATE KEY-----')) return null;
  return tagEnd+17;
}
async function pem(read,start,length) {
  const begin = await header(read,start,'BEGIN'); if (begin===null) return null;
  for (let at=begin;at<length;at++) if (await read(at)==='-') {
    const end = await header(read,at,'END'); if (end!==null) return { end };
  }
  return null;
}
async function prefixed(read,start,prefixes,accept,minimum,insensitive=false,exact=false) {
  let prefix;
  for (const candidate of prefixes) if (await literal(read,start,candidate,insensitive)) { prefix = candidate; break; }
  if (!prefix) return null;
  const from = start+prefix.length, end = await run(read,from,accept);
  if (exact) return end-from===minimum && word(await read(end-1))!==word(await read(end)) ? { end }:null;
  for (let at=end;at>=from+minimum;at--) if (word(await read(at-1))!==word(await read(at))) return { end:at };
  return null;
}
async function jwt(read,start) {
  if (!await literal(read,start,'eyJ')) return null;
  let from = start+3, end = await run(read,from,token);
  if (end-from<10 || await read(end)!=='.') return null;
  from = end+1; end = await run(read,from,token);
  if (end-from<10 || await read(end)!=='.') return null;
  from = end+1; end = await run(read,from,token);
  for (let at=end;at>=from+10;at--) if (word(await read(at-1))!==word(await read(at))) return { end:at };
  return null;
}
async function bearerToken(read,start) {
  if (!await literal(read,start,'bearer',true)) return null;
  let from = start+6;
  if (!space(await read(from))) return null;
  from = await run(read,from,space);
  const end = await run(read,from,bearer);
  if (end-from<12) return null;
  const equals = await run(read,end,char => char==='=');
  if (equals>end && word(await read(equals))) return { end:equals };
  for (let at=end;at>=from+12;at--) if (word(await read(at-1))!==word(await read(at))) return { end:at };
  return null;
}
const names = ['api_key','api-key','apikey','api_token','api-token','apitoken','access_token','access-token','accesstoken',
  'auth_token','auth-token','authtoken','client_secret','client-secret','clientsecret','password'];
async function assignmentAt(read,start) {
  for (const name of names) {
    if (!await literal(read,start,name,true)) continue;
    let at = await run(read,start+name.length,space);
    if (![':', '='].includes(await read(at))) continue;
    at = await run(read,at+1,space); const prefixEnd = at;
    if (['"',"'"].includes(await read(at))) at++;
    const end = await run(read,at,value);
    if (end-at<8) continue;
    return { prefixEnd,end:end+(['"',"'"].includes(await read(end)) ? 1:0) };
  }
  return null;
}
async function assignment(read,start) {
  if (!/^[a-z]$/i.test(await read(start))) return null;
  const end = await run(read,start,identifier);
  // The optional assignment-name prefix is greedy. Revisit underscore offsets
  // in reverse order; the prefix itself is never accumulated or truncated.
  for (let at=end-1;at>start;at--) if (await read(at)==='_') {
    const match = await assignmentAt(read,at+1); if (match) return match;
  }
  return assignmentAt(read,start);
}

const stages = [
  (read,start,length) => pem(read,start,length),
  (read,start) => prefixed(read,start,['sk-','rk-','pk-'],token,16),
  (read,start) => prefixed(read,start,['crn_pat_'],char => /^[a-f0-9]$/i.test(char),32,true),
  (read,start) => prefixed(read,start,['ghp_','gho_','ghu_','ghs_','github_pat_'],word,20),
  (read,start) => prefixed(read,start,['AKIA'],char => /^[A-Z0-9]$/.test(char),16,false,true),
  jwt,bearerToken,assignment,
];
const necessary = ['-','-','cC','g','A','.','Bb',':='];

async function possible(file,characters) {
  for (let start=0;start<file.units;) {
    const end = Math.min(file.units,start+SCRATCH_BUFFER_BYTES/2);
    const text = (await file.bytes(start*2,end*2)).toString('utf16le');
    if ([...characters].some(char => text.includes(char))) return true;
    start = end;
  }
  return false;
}

/** Dedicated native-pattern transducers. Only offsets and fixed counters are
 * retained; each stage sees the preceding stage's complete replacement output.
 * Failed candidates resume from the next original unit, preserving inner starts.
 */
export async function redact(file,owner,state) {
  for (const [index,match] of stages.entries()) {
    // A single necessary ASCII character cannot cross a buffer boundary.
    // This only proves an entire stage has no candidates; it never recognizes
    // or redacts a secret using a fixed overlap window.
    if (!await possible(file,necessary[index])) continue;
    const output = await owner.create(), read = units(file,state);
    let at = 0, copied = 0;
    while (at<file.units) {
      state.check();
      const char = await read(at), boundary = word(char)!==word(await read(at-1));
      const plausible = index===0 ? char==='-' : boundary && word(char);
      const found = plausible ? await match(read,at,file.units):null;
      if (!found) { at++; continue; }
      await file.copyTo(output,copied,at);
      if (found.prefixEnd!==undefined) await file.copyTo(output,at,found.prefixEnd);
      await output.text(replacement); at = found.end; copied = at;
    }
    await file.copyTo(output,copied,file.units);
    await file.remove(); file = output;
  }
  return file;
}
