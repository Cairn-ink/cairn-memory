import { fail } from './validation.mjs';

// SQLite session changesets describe every affected primary-key row, including
// trigger writes. Decode the documented binary format without replaying SQL or
// opening a second connection. Values omitted by UPDATE remain undefined.
export function contentWriteChanges(bytes) {
  const input = Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength), result=[];
  let at=0, table;
  const need=n=>{if(at+n>input.length)fail('evidence_unavailable');};
  const byte=()=>{need(1);return input[at++];};
  function variable() {
    let n=0n;
    for(let i=0;i<9;i++) { const b=byte(); n=(n<<BigInt(i===8?8:7))|BigInt(i===8?b:b&127); if(i===8||b<128){if(n>BigInt(Number.MAX_SAFE_INTEGER))fail('evidence_unavailable');return Number(n);} }
  }
  function record() {
    return table.columns.map(()=>{
      const type=byte();
      if(type===0)return undefined;
      if(type===5)return null;
      if(type===1){need(8);const value=input.readBigInt64BE(at);at+=8;return value>=BigInt(Number.MIN_SAFE_INTEGER)&&value<=BigInt(Number.MAX_SAFE_INTEGER)?Number(value):value;}
      if(type===2){need(8);const value=input.readDoubleBE(at);at+=8;return value;}
      if(type===3||type===4){const n=variable();need(n);const value=input.subarray(at,at+n);at+=n;return type===3?value.toString('utf8'):value;}
      fail('evidence_unavailable');
    });
  }
  while(at<input.length) {
    const tag=byte();
    if(tag===84) {
      const count=variable();if(!count||count>4096)fail('evidence_unavailable');
      const columns=Array.from({length:count},()=>byte());
      const end=input.indexOf(0,at);if(end<at)fail('evidence_unavailable');
      const name=input.toString('utf8',at,end);at=end+1;table={name,columns};continue;
    }
    if(!table||![9,18,23].includes(tag))fail('evidence_unavailable');
    byte(); // indirect/trigger marker; both kinds are subject to validation.
    const old=tag===18?null:record(), next=tag===9?null:record();
    result.push({table:table.name,primary:table.columns,old,next});
  }
  return result;
}
