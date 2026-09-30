// Independent model: operation-history byte positions and human texts only.
// No imports from production. JSONL lengths here come from the fixture history.
export class HistoryOracle {
  constructor(initial) {
    this.bytes=Buffer.byteLength(initial);this.offset=0;this.paused=false;this.barrier=false;
    this.expected=[];this.epoch=0;this.history=[];this.sourceChanged=false;
  }
  apply(op,{bytes=0,text=null,size=null,previousOffset=this.offset}={}) {
    this.history.push({op,bytes,text,size});
    if(op==='pause') {this.paused=true;this.barrier=true;return;}
    if(op==='resume') {this.paused=false;return;}
    if(op==='replace') {this.bytes=size;this.sourceChanged=true;return;}
    if(op==='truncate') {
      this.bytes=size;if(previousOffset>size)this.sourceChanged=true;return;
    }
    this.bytes+=bytes;
    if(!this.paused && !this.barrier && !this.sourceChanged && text!==null) this.expected.push(text);
  }
  hook() {
    if(this.paused) return;
    if(this.sourceChanged) {this.epoch++;this.sourceChanged=false;}
    if(this.barrier) this.barrier=false;
    this.offset=this.bytes;
  }
  assert(assert,state,bodies) {
    const actual=bodies.flatMap(x=>x.messages.map(m=>m.content));
    assert.deepEqual(actual.slice().sort(),this.expected.slice().sort(),JSON.stringify(this.history));
    assert.equal(new Set(actual).size,actual.length,'no text admitted twice');
    if(state) {
      assert.equal(state.offset,this.offset,'history-derived cursor');
      assert.equal(state.epoch,this.epoch,'history-derived epoch');
      assert.equal(state.accepted+Object.values(state.skipped).reduce((n,x)=>n+x,0),state.offset,'no unaccounted bytes');
      assert.ok(state.observedEnd>=state.offset);
    }
  }
}
export function seeded(seed) {
  let state=seed>>>0;
  return ()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state;};
}
