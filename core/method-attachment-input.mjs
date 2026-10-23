import { ASSET_LIMITS,ASSET_MEDIA,validateAssetMedia } from './asset-input.mjs';
import { binaryView } from './asset-identity.mjs';
import { methodFiles,methodPath,METHOD_LIMITS } from './method-package-input.mjs';
import { denseArray,object,fail } from './validation.mjs';

export const METHOD_BINARY_LIMITS=Object.freeze({entryBytes:ASSET_LIMITS.versionBytes,versionBytes:67108864});
export function mixedMethodFiles(values) {
  const paths=new Set();let binaryBytes=0,units=0,retained=0,binaries=0;
  const entries=denseArray(values,1,METHOD_LIMITS.files).map(file=>{
    object(file,['kind','path','text','bytes','mediaType']);
    if(file.kind==='text')object(file,['kind','path','text','mediaType']);
    else if(file.kind==='binary')object(file,['kind','path','bytes','mediaType']);
    else fail('invalid_input');
    const path=methodPath(file.path),folded=path.toLowerCase();
    if(paths.has(folded))fail('invalid_path');paths.add(folded);
    if(file.kind==='text') {
      const clean=methodFiles([{path,text:file.text,mediaType:file.mediaType}])[0];
      units+=file.text.length;retained+=clean.text.length;return {kind:'text',...clean};
    }
    if(!ASSET_MEDIA.includes(file.mediaType))fail('unsupported_media');
    const bytes=binaryView(file.bytes);
    if(!bytes.length||bytes.length>METHOD_BINARY_LIMITS.entryBytes)fail('invalid_input');
    binaryBytes+=bytes.length;binaries++;validateAssetMedia(path,file.mediaType,bytes);
    return {kind:'binary',path,mediaType:file.mediaType,bytes:file.bytes};
  });
  if(!binaries||binaryBytes>METHOD_BINARY_LIMITS.versionBytes||units>METHOD_LIMITS.versionUnits||retained>METHOD_LIMITS.versionUnits)fail('invalid_input');
  return entries;
}
