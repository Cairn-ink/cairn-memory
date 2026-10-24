import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { restoreHistoricalStore } from '../../../../core/testing/method-package-fixtures.mjs';

// Run against either the pinned pre-v32 closure or the current installed tree.
// Empty success DTOs and refusals avoid random IDs/timestamps in the byte fixture.
export async function roleLegacyProbe(root, directory) {
  const { createCairnServer } = await import(pathToFileURL(join(root,'adapters/mcp/server.mjs')));
  const { start, parseConfiguration } = await import(pathToFileURL(join(root,'adapters/mcp/cli.mjs')));
  const { openMemoryCore } = await import(pathToFileURL(join(root,'core/contract.mjs')));
  const ns={ownerId:'synthetic-method-owner',scope:'personal',projectId:null};
  const counter={id:'synthetic-local',countTokens:text=>Math.ceil(Buffer.byteLength(text)/4)};
  const result={};
  for(const [mode,options] of Object.entries({plain:{},methods:{methodPackages:'local-v1'},context:{contextRead:'context-read-v1',contextCounter:counter},
    combined:{methodPackages:'local-v1',contextRead:'context-read-v1',contextCounter:counter},assets:{assets:'local-v1'}})) {
    const path=join(directory,mode+'.sqlite'),fixture=restoreHistoricalStore(path,'compatibility').expected;
    const server=createCairnServer({path,namespace:ns,...options});
    const client=new Client({name:'legacy-fixture',version:'1'}),[a,b]=InMemoryTransport.createLinkedPair();
    try {
      await server.connect(a);await client.connect(b);
      const tools=await client.listTools(),inspect=await client.callTool({name:'inspect_memory',arguments:{}});
      const missing=await client.callTool({name:'inspect_memory',arguments:{memoryId:'absent'}});
      const invalid=await client.callTool({name:'inspect_memory',arguments:{namespace:ns}});
      const extra=options.methodPackages?await client.callTool({name:'list_method_packages',arguments:{}}):null;
      const dtoCalls=[['inspect_memory',{memoryId:fixture.id}],['inspect_memory',{memoryId:fixture.id,includeQualification:true}],
        ['inspect_memory',{states:['active','historical'],limit:1}],['inspect_memory',{memoryId:fixture.id,receiptLimit:1}],
        ['recall_memory',{query:'synthetic'}],['correct_memory',{memoryId:fixture.id,expectedRevision:999,content:'Never applied',kind:'fact'}],
        ['forget_memory',{memoryId:fixture.id,expectedRevision:999}],['remember_memory',{content:'invalid',unknown:true}]];
      if(options.methodPackages)dtoCalls.push(['list_method_binding_events',{}],['resolve_method',{package:{type:'method-package',namespace:ns,packageId:'absent'},roleId:null}]);
      const populatedDTOs=[];for(const [name,arguments_]of dtoCalls)populatedDTOs.push(JSON.stringify(await client.callTool({name,arguments:arguments_})));
      result[mode]={tools:JSON.stringify(tools),inspect:JSON.stringify(inspect),missing:JSON.stringify(missing),invalid:JSON.stringify(invalid),extra:JSON.stringify(extra),populatedDTOs};
    } finally {await client.close();await server.close();}
    const core=openMemoryCore({path});
    try {result[mode].core=JSON.stringify({keys:Object.keys(core),list:core.list({namespace:ns}),historyList:core.list({namespace:ns,states:['active','historical']}),get:core.get({namespace:ns,memoryId:fixture.id}),qualified:core.get({namespace:ns,memoryId:fixture.id,includeQualification:true}),missing:core.get({namespace:ns,memoryId:'absent'})});}finally{core.close();}
    const db=new DatabaseSync(path);try{result[mode].version=db.prepare('PRAGMA user_version').get().user_version;
      result[mode].schema=JSON.stringify(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all());}finally{db.close();}
  }
  const logs=[],log=console.log;console.log=(...args)=>logs.push(args.join(' '));
  const args=['--db','/synthetic/legacy.sqlite','--owner','synthetic-legacy'];
  try {await start(['--help'],{});await start(['--check-config',...args],{});
    await start(['--check-config',...args,'--method-packages','local-v1'],{});
    await start(['--check-config',...args,'--context-read','context-read-v1'],{});
  } finally {console.log=log;}
  result.cli={stdout:logs,parse:JSON.stringify(parseConfiguration(args))};return result;
}
