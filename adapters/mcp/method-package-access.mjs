import { isDeepStrictEqual } from 'node:util';
import { sameNamespace } from '../../core/method-package-input.mjs';

export const METHOD_TOOL_METHODS=Object.freeze(['resolveMethod','resolveMethodsForRole','getMethodVersion',
  'listMethodManifest','readMethodFile','listMethodPackages','listMethodVersions','compareMethodVersions','listMethodBindingEvents']);

/** Exact host scopes, exact call payloads, read only. No mutation token exists. */
export function createMethodReadAccess(namespace,personal=false) {
  const scope=Object.freeze(structuredClone(namespace));
  if(personal&&scope.scope!=='project')throw Error('invalid_mcp_configuration');
  const readSet=Object.freeze(personal?[Object.freeze({ownerId:scope.ownerId,scope:'personal',projectId:null}),scope]:[scope]);
  const tokens=new WeakMap(),grants=new WeakMap();let closed=false;
  const authority={
    authorize(request,token) {
      const expected=tokens.get(token);
      if(closed||!expected||!METHOD_TOOL_METHODS.includes(request.method)||request.actionClass!=='read'||request.actionId!==null||
        !readSet.some(ns=>sameNamespace(ns,request.namespace))||request.method!==expected.method||!isDeepStrictEqual(request.input,expected.input))return null;
      const grant=Object.freeze({}),{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;
    },
    isCurrent(grant){return closed?null:grants.get(grant)??null;},
  };
  return {readSet,namespace:scope,revoke(){closed=true;},
    configuration:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},
    call(core,method,input){
      const token=Object.freeze({});tokens.set(token,{method,input:structuredClone(input)});
      try{return core[method](input,token);}finally{tokens.delete(token);}
    }};
}
