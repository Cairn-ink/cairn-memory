/** Paid opt-in smoke. Never imported by a test suite. No arguments = no key lookup. */
import { createOpenAIEmbedder, estimateEmbeddingUsd } from '../../adapters/openai/embedding.mjs';
import { contextOptions } from '../../core/context-read-input.mjs';
import { contextBudget } from '../../core/context-read-budget.mjs';
import { performance } from 'node:perf_hooks';

if(process.argv.length===2)console.log('Unrun by default. Paid smoke requires --run --max-requests N --max-usd X; verify the frozen accounting rate before use.');
else {
  const args=process.argv.slice(2);
  if(args.length!==5||args[0]!=='--run'||args[1]!=='--max-requests'||args[3]!=='--max-usd'||
    !/^[1-9][0-9]*$/.test(args[2])||!Number.isFinite(Number(args[4]))||Number(args[4])<=0)throw Error('invalid_live_smoke_arguments');
  const embedder=createOpenAIEmbedder({apiKey:process.env.OPENAI_API_KEY});
  const config=contextOptions({version:'context-read-v1',authority:{authorize(){},isCurrent(){}},embedder,
    policy:{family:'hosted',maxRequests:Number(args[2]),maxUsd:Number(args[4]),estimateUsd:estimateEmbeddingUsd}});
  const vectors=await contextBudget(config)(config.embedder,['Synthetic opt-in embedding smoke.'],{
    signal:new AbortController().signal,deadlineAt:performance.now()+5000,guard(){}});
  console.log(JSON.stringify({ok:true,model:'text-embedding-3-small',dimensions:vectors[0].length,requests:1}));
}
