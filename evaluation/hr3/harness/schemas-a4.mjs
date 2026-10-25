#!/usr/bin/env node
import {mkdirSync,writeFileSync} from 'node:fs';
import {answerSchema,extractionSchema,providerSchema} from './schema.mjs';
import {checkStrictSchema} from './strict-schema.mjs';
mkdirSync(new URL('./schemas/',import.meta.url),{recursive:true});
for(const [name,schema] of Object.entries({extraction:extractionSchema,reader:answerSchema})){
 const provider=providerSchema(schema);checkStrictSchema(provider);
 for(const [suffix,value] of [['schema',schema],['provider',provider]])writeFileSync(new URL(`./schemas/${name}-a6.${suffix}.json`,import.meta.url),JSON.stringify(value,null,2)+'\n');
}
