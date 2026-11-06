import test from 'node:test';
import { measureRawSearch } from '../../tools/testing/measure-raw-search.mjs';

// Frozen before the first measurement. Shared-machine timing gates are opt-in.
export const RAW_SEARCH_TARGETS=Object.freeze({sizes:[1000,10000,20000],rawCapBytes:200000000,
  warmRetrievalP95Ms:250,fullReadP95Ms:1000,canonicalP95Ms:20,canonicalP99Ms:50,
  captureP95AllowanceMs:5,captureP95AllowanceFraction:.05,quotaBytes:512*1024*1024,
  vectorCount:20000,vectorBytes:128*1024*1024});
test('opt-in synthetic Raw storage, hierarchy and canonical measurement',{
  skip:process.env.CAIRN_MEASURE_RAW_SEARCH!=='1',timeout:1800000,
},async t=>{await measureRawSearch(t,RAW_SEARCH_TARGETS);});
