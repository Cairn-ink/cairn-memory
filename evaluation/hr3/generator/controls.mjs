// Symbolic result refs are resolved by the public-operation runner, never by gold.
export function cardControl(family, branch) {
  const N = family.namespace, K = { readSet:[N], roleId:'finance' };
  let step = 0;
  const actions = [];
  function add(batch, call, payload, returns = [], authority = 'explicit-user', expected = {}) {
    const actionId = `${family.family_id}/card/${++step}`;
    actions.push({ batch, call, authority, payload:call === 'resolveMethod' ? payload : { ...payload, actionId }, returns, expected });
  }
  const title = `${family.family_id} independent invoice control`;
  const body = `Independent invoice control: invoice seal ${family.lineage_id} is required. This assertion concerns invoices only.`;
  const newer = body.replace('is required','must be blue');
  const deps = snapshot => ({ context:K, packages:[{package:'$M',snapshot}] });
  const review = (batch = 4) => {
    add(batch,'resolveMethod',{...K,package:'$M'},['fresh'],'read');
    add(batch,'revalidateCardCurrentDependencies',{namespace:N,cardId:'$cardId',expectedRevision:'$c',expectedDependencyRevision:'$d',currentDependencies:deps('$fresh')},['d'], 'explicit-user',{dependencyEligible:true});
  };
  add(1,'importMethodVersion',{namespace:N,title,files:[{path:'invoice.txt',text:'Independent invoice method, version one.',mediaType:'text/plain'}]},['M','V1','packageRevision']);
  add(1,'adoptMethodVersion',{bindingNamespace:N,package:'$M',version:'$V1',readSet:[N],roleId:'finance',expectedRevision:null},['b']);
  add(1,'resolveMethod',{...K,package:'$M'},['s'],'read');
  add(1,'createCardDraft',{namespace:N,drafting:'authored',input:{title,body,authoredInput:{text:body,occurredAt:null}}},['cardId','c']);
  add(1,'confirmCardDraft',{namespace:N,cardId:'$cardId',expectedRevision:'$c',applicability:'current',currentDependencies:deps('$s')},['c']);
  add(1,'declareCardCurrentDependencies',{namespace:N,cardId:'$cardId',expectedRevision:'$c',expectedDependencyRevision:null,currentDependencies:deps('$s')},['d']);
  const importV2 = () => add(2,'importMethodVersion',{namespace:N,package:'$M',expectedPackageRevision:'$packageRevision',basedOn:'$V1',title,files:[{path:'invoice.txt',text:'Independent invoice method, version two.',mediaType:'text/plain'}]},['V2','packageRevision']);
  const adopt = (version,batch) => add(batch,'adoptMethodVersion',{bindingNamespace:N,package:'$M',version,readSet:[N],roleId:'finance',expectedRevision:'$b'},['b']);
  const edit = () => add(2,'editKnowledgeCard',{namespace:N,cardId:'$cardId',expectedRevision:'$c',title,body:newer,bindings:[],applicability:'current'},['c']);
  const names = ['unadopted_v2','adopt_v2','readopt_v1','v1_v2_v1','edit_without_review','review_unchanged','edit_then_review','unauthorized_mcp'];
  let final = {currentEligible:true,historyEligible:true,body};
  if (branch <= 3 || branch === 5) importV2();
  if ([1,3,5].includes(branch)) adopt('$V2',2);
  if (branch === 2) adopt('$V1',2);
  if (branch === 3) adopt('$V1',3);
  if ([4,6].includes(branch)) edit();
  if ([1,2,3,4].includes(branch)) final.currentEligible = false;
  if ([4,6].includes(branch)) { final.body = newer; final.overwrittenBodyRecoverable = false; }
  if ([5,6].includes(branch)) review();
  if (branch === 7) for (const call of ['confirmCardDraft','declareCardCurrentDependencies','revalidateCardCurrentDependencies']) {
    const payload = call === 'confirmCardDraft' ? {namespace:N,cardId:'$cardId',expectedRevision:'$c',applicability:'current',currentDependencies:deps('$s')} : {namespace:N,cardId:'$cardId',expectedRevision:'$c',expectedDependencyRevision:call === 'declareCardCurrentDependencies'?null:'$d',currentDependencies:deps('$s')};
    add(4,call,payload,[],'unauthorized-mcp',{error:'approval_required',mutation:false});
  }
  return {kind:'card',branch:names[branch],separate_assertion:true,execution_status:'blocked_protocol_clarification',unresolved_protocol:['confirm_with_dependencies_then_null_declaration'],actions,checkpoints:[{batch:2,currentEligible:![1,2,3,4,5,6].includes(branch),historyEligible:true},{batch:4,...final}],scoring:['eligibility','delivery','reader_use'],historyIsCurrent:false};
}
export function safetyControl(family) {
  const content = `Synthetic independent seal record ${family.family_id}; never a focal decision.`;
  const foreignNamespace={ownerId:`foreign-${family.family_id}`,scope:'personal',projectId:null};
  return {kind:'named_forget_replay_foreign',namespace:family.namespace,foreignNamespace,targetRecord:'$forgotten',
    actions:[
      {batch:1,call:'admit',authority:'explicit-user',namespace:family.namespace,content,returns:['forgotten','revision']},
      {batch:1,call:'admit',authority:'explicit-user',namespace:family.namespace,content:`Independent copy: ${content}`,returns:['independentCopy']},
      {batch:1,call:'admit',authority:'explicit-user',namespace:foreignNamespace,content:`Foreign-only seal ${family.family_id}`,returns:['foreignRecord']},
      {batch:3,call:'forget',authority:'explicit-user',namespace:family.namespace,target:'$forgotten',expectedRevision:'$revision'},
      {batch:4,call:'admit',authority:'explicit-user',namespace:family.namespace,content,expected:{suppressed:true}},
    ].map((action,i)=>({...action,actionId:`${family.family_id}/safety/${i+1}`})),
    expected:{namedRecordExposed:false,receiptsExposed:false,replayResurrection:false,foreignExposed:false,independentCopyEligible:true},
    independentArtifactAudit:['$independentCopy'], readSet:[family.namespace] };
}
