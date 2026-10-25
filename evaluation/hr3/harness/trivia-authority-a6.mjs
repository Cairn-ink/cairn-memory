// Trusted configuration independent of candidate answers, proofs and metadata.
import {readFileSync} from 'node:fs';
import {createTriviaAuthority,createTriviaCase,adaptGeneratorTrivia} from '../scorer/support.mjs';
import {hash,fail} from './common.mjs';
export const GENERATOR_TRIVIA_FREEZE_PIN='548fd3913d76a3e8943a9224dfb1a050f569421de93244ec4b5859a12b25fa8a';
let authority;
function targetBinding(family,checkpoint) {
  const bytes=readFileSync(new URL('../generator/freeze.json',import.meta.url));
  if(hash(bytes)!==GENERATOR_TRIVIA_FREEZE_PIN)fail('trivia_generator_freeze_pin_mismatch');
  authority??=createTriviaAuthority(bytes,GENERATOR_TRIVIA_FREEZE_PIN);
  if(!Number.isSafeInteger(checkpoint?.batch)||typeof checkpoint.question!=='string'||!checkpoint.question)fail('trivia_trusted_checkpoint_required');
  const caseId=family.family_id+'/batch/'+checkpoint.batch+'/query/'+hash([checkpoint.question,checkpoint.query??null,checkpoint.query_id??null]);
  return {family,authority,caseId,question:checkpoint.question};
}
export function trustedScoringOptions(family,checkpoint) {
  return {triviaCase:createTriviaCase(targetBinding(family,checkpoint))};
}
export function authenticatedGeneratorTrivia(family,registry,checkpoint) {
  const binding=targetBinding(family,checkpoint),triviaCase=createTriviaCase(binding);
  const turns=family.batches.flatMap(b=>b.turns).map(({turn_id,text})=>({turn_id,text}));
  const supportTrivia=adaptGeneratorTrivia(registry,readFileSync(new URL('../generator/trivia-rules.json',import.meta.url)),turns,binding);
  if(!supportTrivia.producer)fail('trivia_authentication_required');
  return {supportTrivia,scoringOptions:{triviaCase}};
}
