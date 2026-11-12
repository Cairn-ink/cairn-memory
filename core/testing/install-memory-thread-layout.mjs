import { openDatabase, transaction } from '../database.mjs';
import { installMemoryRelations } from '../memory-relations-schema.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';

// Explicit synthetic edge setup for traversal/safety tests, never an opener
// default. Publish the committed layout to already-open local read peers.
export function installMemoryThreadLayout(path) {
 const db=openDatabase(path);
 try{transaction(db,()=>{installMemoryRelations(db);attestContentSafety(db);});}
 finally{db.close();}
}
