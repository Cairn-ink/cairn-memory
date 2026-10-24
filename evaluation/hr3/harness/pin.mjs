import { readFileSync } from 'node:fs';
import { hash,fail } from './common.mjs';
export function verifyProductPin() {
  const pin=JSON.parse(readFileSync(new URL('./product-pin.json',import.meta.url)));
  for(const [path,digest]of Object.entries(pin.files))if(hash(readFileSync(new URL('../../../'+path,import.meta.url)))!==digest)fail('product_pin_mismatch:'+path);
  return {commit:pin.commit,verifiedPaths:Object.keys(pin.files).length};
}
