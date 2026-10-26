import { refuse } from './bounds.mjs';

// A SAX reader: only the current structural stack and bounded scalar metadata
// survive. Selected string chunks go directly to the adapter's scratch sink.
export async function parseRecord(read,range,state,visitor,onBytes = () => {}) {
  const decoder = new TextDecoder('utf-8',{ fatal:true });
  let position = range.start, text = '', offset = 0, ended = false, lastByte;
  const charge = value => state.metadata(Buffer.byteLength(value));
  async function peek() {
    while (offset===text.length && !ended) {
      if (position===range.end) {
        ended = true;
        try { text = decoder.decode(); } catch { refuse(); }
      } else {
        const bytes = await read(position,Math.min(state.limits.bufferBytes,range.end-position));
        position += bytes.length; lastByte = bytes.at(-1); onBytes(bytes);
        try { text = decoder.decode(bytes,{ stream:true }); } catch { refuse(); }
      }
      offset = 0;
    }
    return text[offset] ?? '';
  }
  const next = async () => { const value = await peek(); if (value) offset++; return value; };
  async function whitespace() { while (/^[\x20\t\r\n]$/.test(await peek())) await next(); }
  async function string(path,key=false) {
    if (await next()!=='"') refuse();
    const sink = !key && await visitor.string?.(path);
    const keep = key || sink===true;
    let value = '', chunk = '', high = '';
    async function append(unit) {
      if (high) {
        if (!/^[\uDC00-\uDFFF]$/.test(unit)) refuse();
        unit = high+unit; high = '';
      } else if (/^[\uD800-\uDBFF]$/.test(unit)) { high = unit; return; }
      else if (/^[\uDC00-\uDFFF]$/.test(unit)) refuse();
      if (keep) { charge(unit); value += unit; }
      else if (sink) { if (unit.includes('\0')) refuse(); chunk += unit; if (chunk.length>=8192) { await sink.write(chunk); chunk = ''; } }
    }
    while (true) {
      let unit = await next(); if (!unit) refuse('raw_source_incomplete');
      if (unit==='"') break;
      if (unit==='\\') {
        unit = await next();
        const escapes = { '"':'"','\\':'\\','/':'/','b':'\b','f':'\f','n':'\n','r':'\r','t':'\t' };
        if (unit==='u') {
          let hex = ''; for (let index=0;index<4;index++) hex += await next();
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) refuse(); unit = String.fromCharCode(parseInt(hex,16));
        } else if (Object.hasOwn(escapes,unit)) unit = escapes[unit]; else refuse();
      } else if (unit.charCodeAt(0)<32) refuse();
      await append(unit);
    }
    if (high) refuse();
    if (sink && sink!==true) { if (chunk) await sink.write(chunk); await sink.end(); }
    return keep ? value : undefined;
  }
  async function value(path,depth) {
    if (depth>state.limits.maxDepth) refuse('raw_source_resource_limit');
    await whitespace(); const first = await peek();
    if (first==='{' || first==='[') {
      await next(); const kind = first==='{' ? 'object':'array', end = first==='{' ? '}':']';
      await visitor.start?.(path,kind);
      const keys = new Set(); let index = 0;
      await whitespace();
      if (await peek()!==end) while (true) {
        let key = index++;
        if (kind==='object') {
          key = await string(path,true);
          if (keys.has(key)) refuse(); keys.add(key); await visitor.key?.(path,key);
          await whitespace(); if (await next()!==':') refuse();
        }
        await value([...path,key],depth+1); await whitespace();
        const delimiter = await next();
        if (delimiter===end) { await visitor.end?.(path,kind,index); return; }
        if (delimiter!==',') refuse(); await whitespace();
      }
      await next(); await visitor.end?.(path,kind,index); return;
    }
    if (first==='"') { await visitor.scalar?.(path,await string(path),'string'); return; }
    let token = '';
    while (true) {
      const unit = await peek();
      if (!unit || /^[\x20\t\r\n,\]}]$/.test(unit)) break;
      token += await next(); if (token.length>state.limits.metadataByteLimit) refuse('raw_source_resource_limit');
    }
    let result;
    state.metadata(Buffer.byteLength(token));
    if (token==='null') result = null;
    else if (token==='true') result = true;
    else if (token==='false') result = false;
    else if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) result = Number(token);
    else refuse();
    await visitor.scalar?.(path,result,token==='null' ? 'null':typeof result);
  }
  await value([],1); await whitespace();
  if (await peek()) refuse();
  if (lastByte!==10) refuse('raw_source_incomplete');
  state.check();
}
