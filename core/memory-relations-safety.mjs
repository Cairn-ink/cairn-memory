import { contentReadSafety, createContentReadMemo } from './content-safety.mjs';

// Relation text and clocks inherit every retained receipt's canonical ancestry.
// In particular, Raw exclusions must be checked even without suppression DDL.
export function memoryRelationEligible(db, namespace, ref, memo = createContentReadMemo(db)) {
 if(!namespace || ref?.type!=='memory')return false;
 const receipts=db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(ref.memoryId);
 if(!receipts.length)return false;
 return contentReadSafety(db,{namespace,ref,intent:'history',receipts,memo}).allowed;
}
