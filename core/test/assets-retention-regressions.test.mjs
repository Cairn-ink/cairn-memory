import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceFixture,savedSource,anchor,resolve,draft,ns,ok } from '../testing/raw-source-fixtures.mjs';
import { mixedInput,derivativeInput } from '../testing/asset-mixed-fixtures.mjs';
import { pdf } from '../testing/asset-fixtures.mjs';

test('K11 conversation deletion still invalidates dependent Raw Cards and leaves independent assets, derivatives and attachments untouched',async t=>{
  const token={},grants=new WeakMap(),authority={authorize(request,supplied){if(supplied!==token)return null;const grant={},{input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent(grant){return grants.get(grant)??null;}};
  const assets={version:'assets-local-v1',storage:'sqlite-blob-v1',authority},methodPackages={version:'method-packages-local-v1',storage:'local-plain-v1',authority};
  const f=sourceFixture(t,{coreOptions:{assets,methodPackages}}),source=await savedSource(f),refs=await resolve(f,[anchor(source)]),created=ok(draft(f,refs));
  const card=ok(f.call('confirmCardDraft',{namespace:ns,cardId:created.id,expectedRevision:created.revision,actionId:'confirm',applicability:'current'}));
  const asset=ok(f.core.importAssetVersion({namespace:ns,actionId:'independent-asset',title:'Independent asset',filename:'x.pdf',mediaType:'application/pdf',bytes:pdf()},token));
  const derivative=ok(f.core.createAssetDerivative(derivativeInput(asset.version),token)),method=ok(f.core.importMethodVersion(mixedInput('independent-method',{namespace:ns}),token));
  const snapshot=()=>['assets','asset_versions','asset_derivatives','binary_objects','binary_chunks','binary_owner_usage','method_mixed_entries','asset_operations','asset_effects']
    .map(table=>[table,f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all()]);
  const before=snapshot();ok(f.core.deleteConversation({namespace:ns,conversationId:source.conversationId,expectedRevision:source.expectedConversationRevision,actionId:'delete-conversation'}));
  assert.equal(ok(f.call('getCard',{namespace:ns,cardId:card.id})).card,null);assert.deepEqual(snapshot(),before);
  assert.equal(ok(f.core.readAssetDerivative({ref:derivative.derivative},token)).status,'available');
  assert.equal(ok(f.core.readMethodAttachmentBytes({version:method.version,path:'reference.pdf',intent:'history'},token)).status,'available');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
