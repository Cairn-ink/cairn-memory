import { isDeepStrictEqual } from 'node:util';
import { assetSnapshot } from '../../core/asset-input.mjs';
import { cardNamespace } from '../../core/private-card-input.mjs';
export const ASSET_TOOL_METHODS=Object.freeze(['listAssets','listAssetVersions','getAssetVersion','listAssetDerivatives','readAssetDerivative']);
/** Metadata/derivative reads in exactly the startup namespace. No byte grants. */
export function createAssetReadAccess(namespace) {
  const scope=Object.freeze(cardNamespace(namespace)),tokens=new WeakMap(),grants=new WeakMap();let closed=false;
  const authority={authorize(request,token){
    const expected=tokens.get(token);
    if(closed||!expected||!ASSET_TOOL_METHODS.includes(request.method)||request.actionClass!=='read'||request.actionId!==null||
      !isDeepStrictEqual(scope,request.namespace)||request.method!==expected.method||!isDeepStrictEqual(request.input,expected.input))return null;
    const grant=Object.freeze({}),{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
  },isCurrent(grant){return closed?null:grants.get(grant)??null;}};
  return {namespace:scope,revoke(){closed=true;},configuration:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},
    // U5c-1: a separately revocable U4 metadata grant for an exact role file
    // request. The role port verifies its token/commitment; U4 owns this grant.
    authorizeRoleFile(request,token,roleAuthority){
      if(closed||request.method!=='readRoleTaskContext'||request.input.mode!=='file'||
        request.actionClass!=='read'||!isDeepStrictEqual(scope,request.namespace)||!roleAuthority.authorize(request,token))return null;
      const grant=Object.freeze({}),{input,...binding}=request;
      grants.set(grant,{...binding,accessGeneration:1});return grant;
    },
    call(core,method,input){const token=Object.freeze({});tokens.set(token,{method,input:Object.fromEntries(Object.entries(assetSnapshot(input)))});
      try{return core[method](input,token);}finally{tokens.delete(token);}}};
}
