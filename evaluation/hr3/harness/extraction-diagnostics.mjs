// Counts shared extractions once, before fan-out to the four arms. Reasons can
// overlap: each reason counts an event once, not every defective quote/edge.
export function extractionDiagnostics(rows) {
  const available=rows.every(r=>r.diagnostics);
  if(!available)return {stage:'extraction',armIndependent:true,available:false,table:[],totals:null};
  const table=rows.map(({family,batch,key,error,diagnostics:d})=>({family,batch,key,
    totalEvents:d.totalEvents,validEvents:d.validEvents,rejectedEvents:d.rejectedEvents,...Object.fromEntries(['rawAssignments','admittedAssignments','excludedAssignments','rawQuotations','admittedQuotations','excludedQuotations'].map(k=>[k,d[k]??null])),reasons:d.reasons,batchFailure:error??d.batchFailure??null}));
  const sum=field=>table.reduce((n,r)=>n+(r[field]??0),0);
  const reasons={};for(const row of table)for(const [reason,count] of Object.entries(row.reasons))reasons[reason]=(reasons[reason]??0)+count;
  return {stage:'extraction',armIndependent:true,available:true,
    counting:'One row per shared extraction; reason counts overlap when an event violates multiple rules. Batch failures have unknown event counts.',
    totals:{batches:table.length,batchFailures:table.filter(r=>r.batchFailure).length,emptyExtractions:table.filter(r=>!r.batchFailure&&r.validEvents===0).length,
      ...Object.fromEntries(['rawAssignments','admittedAssignments','excludedAssignments','rawQuotations','admittedQuotations','excludedQuotations'].map(k=>[k,sum(k)])),totalEvents:sum('totalEvents'),validEvents:sum('validEvents'),rejectedEvents:sum('rejectedEvents'),reasons},table};
}
