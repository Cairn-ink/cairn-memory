// Compatibility of module import names only; there is no A-4 wire fallback.
export {PROJECTION_A6_VERSION as PROJECTION_VERSION,CONTRACT_A6 as PUBLIC_CONTRACT,projectContractA6 as projectContract,isContractProjectionA6 as isContractProjection} from './contract-projection-a6.mjs';
export function familyContractContext(family,question=''){return {public_header:family.header,turns:family.batches.flatMap(b=>b.turns),question};}
