export const PRODUCT_SIDECAR_SUFFIX = '.context-read-product-v1.1.sqlite';
// Private pump protocol. Neither methods nor zero-work receipts are public DTOs.
// A receipt proves only that this dispatch did no work; it is never an observation.
const calls=new WeakMap(),receipts=new WeakMap();
export const admissionRequired=Object.freeze({});
export const bindMaintenanceAdmission=(handle,call)=>calls.set(handle,call);
export const isNativeMaintenanceMaintainer=handle=>calls.has(handle);
export const admitMaintenance=(handle,input,credential,control)=>calls.get(handle)('admitMaintenance',input,credential,control);
export const refreshMaintenance=(handle,input,credential,control)=>calls.get(handle)('refreshMaintenance',input,credential,control);
export const maintenanceAdmissionReceipt=result=>receipts.get(result);
export const attachMaintenanceAdmissionReceipt=(result,kind)=>receipts.set(result,kind);
