// Historical import name only; prospective construction uses the A-6 wire.
import {requestA6,preflightA6} from './preflight-a6.mjs';
export {EXTRACTION_PROMPT_A6 as PREFLIGHT_PROMPT} from './prompts-a6.mjs';
export const preflight=preflightA6;
export const preflightRequest=(input,options={})=>requestA6('extraction',input,options);
