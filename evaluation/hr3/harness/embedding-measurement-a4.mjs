import {embeddingRequest,validateRequest} from './requests.mjs';
import {bytes,hash} from './common.mjs';
// Shared instrumentation for reference and independent context requests. The
// vectors are local fixtures; the exact provider body is validated before use.
export function measureEmbedding(texts,{family,mode='constant',channel='research',...metadata}) {
  const body=embeddingRequest(texts),bound=validateRequest({operation:channel+'-embedding',body});
  const inputUnits=texts.map(t=>bytes(t)+16);
  return {...metadata,family,mode,channel,inputs:texts.length,inputUnits,units:bound.input,maxInputUnits:Math.max(...inputUnits),requestBytes:bytes(body),bodySHA256:hash(body)};
}
export function summarizeEmbeddings(measurements,priorEmbedding) {
  const familyUnits=new Map();for(const m of measurements){const key=[m.family,m.mode,m.channel].join('/');familyUnits.set(key,(familyUnits.get(key)??0)+m.units);}
  const cumulativeProjection=Object.fromEntries(['research','product'].map(channel=>{
    const samples=measurements.filter(m=>m.channel===channel),maxFamilyUnits=Math.max(...[...familyUnits].filter(([k])=>k.endsWith('/'+channel)).map(([,n])=>n));
    const families=channel==='research'?2060:1860,priorUnits=priorEmbedding[channel],retryUnits=2*Math.max(...samples.map(m=>m.units)),bound=priorUnits+maxFamilyUnits*families+retryUnits;
    return [channel,{maxMeasuredFamilyUnits:maxFamilyUnits,conservativeFamilies:families,availableCarryUnits:priorUnits,twoTransportFailureReservations:retryUnits,projectedCompleteRunUnits:bound,limit:64000000,withinAllowance:bound<=64000000,scope:'Fixture-grammar bound over all reference and independent context requests, using the largest complete measured family. Replacement banks require recertification. At most two transport failures precede the cumulative third-failure stop.'}];
  }));
  return {cumulativeProjection,requests:measurements.length,maxInputUnits:Math.max(...measurements.map(m=>m.maxInputUnits)),maxRequestUnits:Math.max(...measurements.map(m=>m.units)),maxRequestBytes:Math.max(...measurements.map(m=>m.requestBytes)),unitsByChannel:Object.fromEntries(['research','product'].map(channel=>[channel,measurements.filter(m=>m.channel===channel).reduce((n,m)=>n+m.units,0)]))};
}
