import assert from 'node:assert/strict';
import { ns,pdf,ok } from './asset-fixtures.mjs';
export const textEntry=(path='SKILL.md',text='Synthetic method\n',mediaType='text/markdown')=>({kind:'text',path,text,mediaType});
export const binaryEntry=(path='reference.pdf',bytes=pdf(33000),mediaType='application/pdf')=>({kind:'binary',path,bytes,mediaType});
export const mixedInput=(actionId='mixed-first',patch={})=>({namespace:ns,actionId,title:'Synthetic mixed method',submittedBy:'Synthetic author',manifestFormat:'mixed-v1',
  files:[textEntry(),binaryEntry()],...patch});
export function attachmentBytes(f,version,path='reference.pdf',options={}) {
  const parts=[];let cursor,index=0,total;
  do {
    const response=f.call('readMethodAttachmentBytes',{version,path,intent:'history',...options,...(cursor?{cursor}:{})});
    assert.ok(Buffer.byteLength(JSON.stringify(response))<=65536);const page=ok(response);assert.equal(page.status,'available');assert.equal(page.index,index++);
    const bytes=Buffer.from(page.bytes,'base64');assert.equal(bytes.length,page.byteCount);total??=page.totalByteCount;assert.equal(page.totalByteCount,total);
    assert.equal(page.complete,page.nextCursor===null);parts.push(bytes);cursor=page.nextCursor;
  }while(cursor);
  const result=Buffer.concat(parts);assert.equal(result.length,total);return result;
}
export const derivativeInput=(version,actionId='derive',patch={})=>({version,actionId,expectedVersionRevision:1,kind:'description',text:'Synthetic description',method:{kind:'user-provided'},...patch});
