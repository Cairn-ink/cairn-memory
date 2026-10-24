import { refuse } from './bounds.mjs';

const pathKey = path => path.join('.');

// One block at a time: text preceding its discriminator is private scratch,
// then either appended to the candidate message or removed. No block roster.
export function selection(owner,input,state,policy) {
  const fields = new Map(), kinds = new Map(), unknown = new Set(), present = new Set();
  let candidate, block, blocks = 0, toolResult = false, ownTool = false, rich = false;
  const root = input.client==='claude-code' ? ['message','content'] : ['payload','item','content'];
  const contentKey = root.join('.');
  const atContent = path => path.length===root.length && path.every((key,index) => key===root[index]);
  const atBlock = path => path.length===root.length+1 && root.every((key,index) => key===path[index]) && typeof path.at(-1)==='number';
  const atText = path => path.length===root.length+2 && atBlock(path.slice(0,-1)) && path.at(-1)==='text';
  let output;
  async function append() {
    if (!candidate) return;
    if (blocks++ && input.client==='claude-code') await output.text('\n');
    await candidate.copyTo(output); await candidate.remove(); candidate = undefined;
  }
  function save(path,value,kind) {
    const key = pathKey(path); kinds.set(key,kind); fields.set(key,value);
  }
  const visitor = {
    async start(path,kind) {
      const key = pathKey(path);
      if (!path.length || policy.paths.has(key) || atContent(path)) save(path,true,kind);
      if (atBlock(path)) block = { type:undefined,hasText:false,keys:new Set(),kind,skill:null,name:null,rich:false };
      if (block && pathKey(path)===contentKey+'.'+rootIndex(path)+'.text_elements') {
        if (kind==='array') block.rich = false; else block.invalidRich = true;
      }
      if (block && atText(path)) block.invalidText = true;
    },
    key(path,key) {
      if (path.length===0 && key==='toolUseResult') toolResult = true;
      const here = pathKey(path), allowed = policy.closed.get(here);
      if (allowed && !allowed.includes(key)) unknown.add(here);
      if (allowed && allowed.includes(key)) present.add(here ? here+'.'+key:key);
      if (atBlock(path) && block) block.keys.add(key);
    },
    async string(path) {
      if (atText(path) || input.client==='claude-code' && atContent(path)) {
        if (candidate) refuse('unsupported_format');
        candidate = await owner.create();
        if (block && atText(path)) block.hasText = true;
        return { write:chunk => candidate.text(chunk),end:async () => { if (atContent(path)) await append(); } };
      }
      return policy.paths.has(pathKey(path)) || block && (pathKey(path)===contentKey+'.'+rootIndex(path)+'.type' ||
        pathKey(path)===contentKey+'.'+rootIndex(path)+'.name' || pathKey(path)===contentKey+'.'+rootIndex(path)+'.input.skill');
    },
    scalar(path,value,kind) {
      const key = pathKey(path);
      if (atBlock(path) && input.client==='codex') policy.block({ keys:new Set(),kind,type:undefined });
      if (policy.paths.has(key) || atContent(path)) save(path,value,kind);
      if (block) {
        const base = contentKey+'.'+rootIndex(path)+'.';
        if (key===base+'type') block.type = value;
        if (key===base+'name') block.name = value;
        if (key===base+'input.skill') block.skill = value;
        if (key===base+'text' && kind!=='string') block.invalidText = true;
        if (key===base+'text_elements' && kind!=='array') block.invalidRich = true;
      }
    },
    async end(path,kind,count) {
      if (block && pathKey(path)===contentKey+'.'+rootIndex(path)+'.text_elements') { block.rich = count>0; return; }
      if (atBlock(path)) {
        if (input.client==='claude-code') {
          if (block.type==='tool_result') toolResult = true;
          if (block.type==='tool_use' && block.name==='Skill' && /^cairn-memory:[\w-]+$/.test(block.skill ?? '')) ownTool = true;
          if (block.type==='text' && block.hasText) await append();
        } else {
          policy.block(block);
          if (block.type==='text' && block.rich) rich = true;
          if (['text','Text'].includes(block.type) && block.hasText) await append();
        }
        if (candidate) { await candidate.remove(); candidate = undefined; }
        block = undefined;
      }
    },
  };
  function rootIndex(path) { return path[root.length]; }
  return { visitor,async init() { output = await owner.create(); },
    async finish() {
      if (candidate) { await candidate.remove(); candidate = undefined; }
      return { file:output,fields,kinds,unknown,present,toolResult,ownTool,rich,blocks };
    } };
}
