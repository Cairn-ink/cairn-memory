const facade=new URL('./v4-native-sqlite.mjs',import.meta.url).href;
export async function resolve(specifier,context,next) {
  if(specifier==='node:sqlite'&&context.parentURL!==facade)return {url:facade,shortCircuit:true};
  return next(specifier,context);
}
