// All harness/integration scoring enters through this guard. Proof/target
// failures must stop an engineering run, never silently remove trivia credit.
import {score as scorerScore,validateGold} from '../scorer/scorer.mjs';
import {compileTrivia,compileUnlicensedTrivia,createUnlicensedTriviaAuthority,createUnlicensedTriviaCase,carriesTrivia} from '../scorer/support.mjs';
import {fail,hash,canonical} from './common.mjs';
import {UNLICENSED_AUTHORITY_A6,UNLICENSED_AUTHORITY_A6_SHA256} from './unlicensed-authority-a6.mjs';
export {carriesTrivia};
let scorerUnlicensedAuthority;
const unlicensedTargets=new WeakMap(),unlicensedGoldTargets=new WeakMap();
// Only a source world explicitly recorded by the fixed authority can register
// an empty-trivia target. The adapter supplies trusted world data and its exact
// projected gold. No target is inferred from a candidate, proof or token alone.
export function unlicensedScoringOptions(target,gold) {
  if(!target?.id||!target.question||!gold||carriesTrivia(target.gold)||carriesTrivia(gold))fail('explicit_unlicensed_target_required');
  const sourceSHA256=hash(target),caseId=target.id+'/source/'+sourceSHA256;
  const record=UNLICENSED_AUTHORITY_A6.cases.find(r=>r.trivia==='none'&&r.family===target.id&&r.caseId===caseId&&r.question===target.question&&r.sourceSHA256===sourceSHA256);
  if(!record)fail('frozen_unlicensed_target_required');
  if(gold.question!==record.question||hash(gold)!==record.goldSHA256)fail('unlicensed_gold_target_mismatch');
  const binding=hash({authority:UNLICENSED_AUTHORITY_A6,record});
  const prior=unlicensedGoldTargets.get(gold);if(prior&&prior.binding!==binding)fail('unlicensed_gold_already_bound');
  // The exact catalog bytes and independent fixed pin come from trusted code,
  // never candidate metadata. Both layers register the same scorer-issued token.
  scorerUnlicensedAuthority??=createUnlicensedTriviaAuthority(Buffer.from(canonical(UNLICENSED_AUTHORITY_A6)+'\n'),UNLICENSED_AUTHORITY_A6_SHA256);
  const token=createUnlicensedTriviaCase({authority:scorerUnlicensedAuthority,target,gold});
  unlicensedGoldTargets.set(gold,{binding,record});unlicensedTargets.set(token,{binding,record});
  return {unlicensedCase:token};
}
export function score(gold,submission,options={}) {
  const licensed=Object.hasOwn(options,'triviaCase'),unlicensed=Object.hasOwn(options,'unlicensedCase');
  if(licensed===unlicensed)fail('trivia_case_binding_required:'+(licensed?'conflicting_bindings':'missing_binding'));
  const target=unlicensedTargets.get(options.unlicensedCase),expected=unlicensedGoldTargets.get(gold);
  const explicitlyUnlicensed=!carriesTrivia(gold)&&target&&expected&&target.binding===expected.binding&&
    target.record===expected.record&&gold.question===expected.record.question&&hash(gold)===expected.record.goldSHA256;
  if(explicitlyUnlicensed) {
    const coverage=compileUnlicensedTrivia(gold,options.unlicensedCase);
    if(coverage.authentication.status!=='authenticated_unlicensed')fail('trivia_case_binding_required:'+coverage.authentication.reason);
  } else {
    const coverage=compileTrivia(gold.supportTrivia,validateGold(gold),options.triviaCase,gold.question);
    if(coverage.authentication.status!=='authenticated')fail('trivia_case_binding_required:'+coverage.authentication.reason);
  }
  return scorerScore(gold,submission,options);
}
