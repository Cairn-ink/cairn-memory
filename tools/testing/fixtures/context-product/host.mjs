// Synthetic trusted request/service adapter; only pre-registered local counters.
export async function createContextReadHost(c) {
  const binding=c.serviceBinding??c.requestBinding;
  const counter=c.counterModule ? await (await import(c.counterModule)).createCounter(c.counterConfiguration) :
    c.functionalOnly ? {id:'functional-characters',countTokens:text=>Array.from(text).length} : null;
  if(counter&&c.counterId&&counter.id!==c.counterId)throw Error('counter_identity');
  if(!counter)throw Error('exact_counter_required');
  return { authorize(request) {
    if(binding.kind==='service' && !['refreshContextIndex','getContextIndexStatus'].includes(request.method))return null;
    return binding;
  }, isCurrent:()=>true, counter };
}
