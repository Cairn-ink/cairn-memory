import { DatabaseSync } from 'node:sqlite';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { PRODUCT_SIDECAR_SUFFIX, PRODUCT_SIDECAR_FORMAT } from '../context-product-sidecar.mjs';
import { sidecarAttestationFile, writeSidecarAttestation } from '../context-product-sidecar-attestation.mjs';

// Binding and lifecycle tests need a trusted physical file containing foreign
// certificates. Rebind only its outer seal, leaving those certificates intact.
export function attestCopiedSidecar(path) {
  const facade=openContextProductFacade(path,{});
  let db;
  try {
    const sidePath=path+PRODUCT_SIDECAR_SUFFIX;
    db=new DatabaseSync(sidePath);db.exec('BEGIN IMMEDIATE');
    writeSidecarAttestation(db,facade.port.identity.cursorSecret,sidecarAttestationFile(sidePath),PRODUCT_SIDECAR_FORMAT);
    db.exec('COMMIT');
  } finally {
    try {if(db?.isTransaction)db.exec('ROLLBACK');}
    finally {try {db?.close();}finally {facade.close();}}
  }
}
