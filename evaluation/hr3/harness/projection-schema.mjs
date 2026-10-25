// Input contract only. No paid-pilot projection is computed in this task.
import { readFileSync,writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { hash } from './common.mjs';
const integer={type:'integer',minimum:0,maximum:Number.MAX_SAFE_INTEGER};
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const obj=properties=>({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
const stages=['pilot','development','test','alternative'];
const channels=['research','product'];
const units=obj(Object.fromEntries(channels.map(c=>[c,{...integer,maximum:64000000}])));
const stageMoney=obj(Object.fromEntries(stages.map(s=>[s,integer])));
const usage=obj({dispatches:{...integer,minimum:1},inputTokens:integer,outputTokens:integer,chargedNanodollars:integer});
export function projectionInputSchema() {
  return {$schema:'https://json-schema.org/draft/2020-12/schema',title:'HR-3 A-4.1 pre-development completion projection inputs v2',
    ...obj({version:{const:'hr3-continuation-projection-input-a4-v1'},source:{const:'paid_pilot_settled_ledger'},
      errataSHA256:{const:hash(readFileSync(new URL('../protocol/errata.md',import.meta.url)))},
      pilot:obj({complete:{const:true},families:{const:60},logicalExtractionCalls:{const:240},logicalReaderCalls:{const:480},primaryExtraction:usage,primaryReader:usage}),
      ledger:obj({journalSHA256:sha,configurationSHA256:sha,snapshotOrdinal:integer,settledNanodollarsByStage:stageMoney,embeddingReservedUnits:units,
        outstandingReservations:{type:'array',items:obj({id:{type:'string',minLength:1},stage:{enum:stages},operation:{enum:['extraction','reader','research-embedding','product-embedding']},model:{enum:['gpt-4.1-mini-2025-04-14','gpt-5.4-mini-2026-03-17','text-embedding-3-small']},inputBound:integer,outputBound:integer,reservedNanodollars:integer})}}),
      remainingStages:obj({development:obj({extractionCalls:{const:800},readerCalls:{const:1600}}),test:obj({extractionCalls:{const:6400},readerCalls:{const:12800}}),alternative:obj({extractionCalls:{const:800},readerCalls:{const:800}})}),
      remainingEmbeddingUnitAllocation:obj(Object.fromEntries(stages.map(s=>[s,units]))),
      stageLimitsNanodollars:stageMoney,
      policy:obj({projectionCeilingNanodollars:{const:400000000000},operationalStopNanodollars:{const:450000000000},authorizationNanodollars:{const:500000000000},unavailableHeadroomNanodollars:{const:50000000000},contingencyNumerator:{const:1},contingencyDenominator:{const:4}}),
    }),
    'x-calculation':{
      arithmetic:'Integer nanodollars and exact rational token/call means. Round each stage/operation projection upward before summing. No currency floats.',
      preconditions:[
        'Hash-verify the paid ledger and immutable configuration at snapshotOrdinal; fake/simulated transport usage is inadmissible. Reconcile every request/charge; deduplicate provider request IDs.',
        'Pilot has all 60 families and 240/480 attempted logical calls, including incomplete/failed answers. Usage includes every settled transport attempt, not just successful answers. Validate chargedNanodollars from full billed input/output usage and frozen rates.',
        'No development/test/alternative dispatch has occurred: their settled totals and outstanding lists are zero at this pre-development gate. All cumulative spending, including paid engineering activity, is included in settledNanodollarsByStage.',
        'Verify each outstanding reservation against the ledger body/model/input/output bounds. Retain its full unknown charge. Embedding reserved units include every attempt, settled or outstanding; retries never receive fresh allowances.',
      ],
      ratesNanodollarsPerToken:{primary:{input:400,output:1600},alternative:{input:750,output:4500},embedding:20},
      responseProjection:[
        'For extraction and reader, compute total pilot settled usage plus corresponding outstanding input/output bounds. Divide by 240 and 480 logical calls respectively. This includes observed transport-retry exposure and incomplete replies.',
        'Multiply each remaining stage call count by these exact input/output means and the frozen model rate. Alternative extraction uses the extraction token means repriced at 750/4500; all readers use 400/1600. Round upward per stage/operation.',
      ],
      embeddings:'For each channel, remaining units = 64000000 - ledger.embeddingReservedUnits[channel]; reject negative units. Stage allocations must sum exactly to these remaining units. Price at 20 nanodollars/unit. Alternative has no additional P allowance. Reject over-allocation and double counting outstanding units.',
      contingency:'For each stage, ceil((projected remaining response cost + projected remaining embedding cost) / 4). Apply once to prospective cost, not to already settled spending or already bounded outstanding reservations.',
      total:'Sum ALL settled spending + full outstanding reservations + remaining stage response/embedding projections + stage contingencies. Include alternative extraction and all 1600 test families; do not shorten the test to fit.',
      acceptance:'Total projected completion <= 400000000000 nanodollars AND each stage settled + outstanding + projected remainder + its contingency <= that stage limit. Any rederived stage-limit allocation must total <= 450000000000 and be disclosed/frozen before development; pilot <=50000000000, authorization stays500000000000 with50000000000 unavailable.',
      bindingProtection:'Dynamic ledger hard stops remain binding at every dispatch regardless of projection. Projection is not a guarantee; budget exhaustion makes the complete-test result Inconclusive.',
      provenance:'Freeze the exact input JSON bytes/hash, journal/configuration hashes, this schema/hash, errata hash, calculation implementation hash, and resulting per-stage arithmetic before development. The calculation is deferred until paid usage exists.',
    }};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  writeFileSync(new URL('./reports/pre-development-projection-a4.schema.json',import.meta.url),JSON.stringify(projectionInputSchema(),null,2)+'\n');
}
