import { contentSafetyConnection } from './content-safety-schema.mjs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { fail } from './validation.mjs';

// This is an operation classification, not an authorization grant. The frozen
// facade inventory independently checks every write name and its terminal field.
export const CONTENT_WRITE_METHODS = Object.freeze(`abandonAdmission admit adoptMethodVersion applyCardPlacement applyPlacement applyInitialPlacement
 beginInitialClassification classifyPlacement bindQualifiedClaim cancelCardDraft capture captureRaw claimAdmission claimCaptureEvidence
 claimCapturedAdmission claimEpisodeDraft claimEpisodeWriter claimOrdered closeEpisodeNextStep commitEpisodeDraft commitRationale
 confirm confirmCardDraft correct correctEpisode createAssetDerivative createCardDraft declareCardCurrentDependencies
 deleteAsset deleteAssetDerivative deleteAssetVersion deleteConversation deleteKnowledgeCard deleteMethodPackage deleteMethodVersion
 deleteRoleProfileRelease deleteSourceNote disableMethodBinding disableRoleProfile discardCaptureEvidence discoverOrdered
 editCardDraft editKnowledgeCard endEpisodeSession failEpisodeDraft failEpisodeKeep failInitialClassification fenceSession
 finishAdmission finishCapturedAdmission finishOrdered forget forgetEpisode importAssetVersion importMethodVersion keepEpisode
 linkMocs planCaptureBatches prepareEpisodeKeep proposeEvidenceMapping publishRoleProfileRelease rebuildIndex reject
 refreshCardTopic releaseEpisodeCorrection releaseEpisodeWriter remember reserveEpisodeBatch resolveReview revalidateCardCurrentDependencies
 reviewEvidenceMapping reviewRationale setCapturePaused setEpisodePolicy setLocalCaptureControl
 setProceduralMemory setProjectCapture setRawCaptureControl settleEpisodeAttempt startEpisodeAttempt submitSourceNote supersede
 transitionQualified transitionQualifiedSet`.split(/\s+/));
const writes = new Set(CONTENT_WRITE_METHODS);
export const CONTENT_TERMINAL_FIELDS = Object.freeze({
  forget: 'memories.id', reject: 'memories.id', resolveReview: 'memories.id',
  cancelCardDraft: 'private_cards.id', deleteKnowledgeCard: 'private_cards.id',
  deleteSourceNote: 'card_notes.id', deleteConversation: 'raw_conversations.id', forgetEpisode: 'session_episodes.id',
});
export const CONTENT_TERMINAL_ACK_FIELDS = Object.freeze({
  cancelCardDraft:'id', deleteKnowledgeCard:'id', deleteSourceNote:'id', deleteConversation:'conversationId',
});
// run is the internal product dispatcher; canonical writes use their own
// runtime method context, while index maintenance remains trusted.
const nonwrites = new Set(`CARD_CURRENT_METHODS CARD_CURRENT_VERSION CONTEXT_SOURCES MemoryStoreError SOURCE_LIMITS ackCleanup
assertCaptureEvidence assertCaptureSources assertContentOutput assertContentScope assertEpisodeKeep
assertEpoch checkMethodReasonRefs classificationSnapshot close compareMethodVersions completion
contentPortGuard contextRead createContextReadSupervisor drain episodeCaptureState
episodeDraftOutcome episodeDraftSnapshot episodeRange episodeSessionKey epoch fetch
fetchCandidateEvidence fetchEvidence fetchPage filterCaptureSources findCandidates get
getAssetCapabilities getAssetUsage getAssetVersion getCaptureControl getCard getCleanupStatus
getContextIndexStatus getContextReadCapabilities getConversation getEpisode getLocalCaptureControl
getMethodPackageCapabilities getMethodPackageUsage getMethodVersion getOwnerSemanticStatus getPage
getPrivateCardCapabilities getPrivateCardUsage getRationale getRawCaptureControl getRawUsage
getSource getStatus inspectAdmission inspectCaptureEvidence inspectCardOperation isAwaiting
isSuppressed legacyGet legacyList legacySearch list listAssetDerivatives listAssetEffects
listAssetVersions listAssets listCardEffects listCards listEpisodes listEvidenceMappings
listMemoriesByTime listMethodBindingEvents listMethodEffects listMethodManifest listMethodPackages
listMethodVersions listPage listRawConversations listRawEffects listReviewConflicts
listReviewTransitions listSuppressionsSince map mapEvidence mapRows openContentSuppressionReader
openContextIndexMaintainer openContextProductReader openContextReader openContextSemanticCoordinator
openMemoryCore openMemoryReader openMemoryStore pendingEpisodeSession previewDeleteConversation
purgeOwnerVectors queryCandidateRows rationaleSnapshot readAssetBytes readAssetDerivative
readMethodAttachmentBytes readMethodFile readRoleTaskContext readTopicMembers readTopicOverview
ready recall recallSnapshot recentReceipts refreshContextIndex renewContextMaintenancePump
resolveMethod resolveMethodsForRole resolveSourceReferences revalidateEvidence reviewDecisionBasis
roleProfileRef roleProfileReleaseRef roleTaskMeteredText roleTaskToolResponse run scope search
selectContextProductNamespaces selectEvidence sessionContextSnapshot sessionStartContext
setOwnerSemantic sourceSnapshot suppressionFence validateEpisodeBatch validateOwnerSemanticCoverage
verifyAssetBytes`.split(/\s+/));
const operations = new AsyncLocalStorage();
const boundaryConnections = new WeakMap();
export function registerContentWriteBoundary(boundary, db) { if(boundary)boundaryConnections.set(boundary,contentSafetyConnection(db)); }
export const contentWriteBoundaryConnection = boundary => boundaryConnections.get(boundary);
export function withContentWriteOperation(method, scopes, work, boundary) {
  const parent=operations.getStore(),connection=boundaryConnections.get(boundary);
  return operations.run({method, scopes, parent, connection}, work);
}
export function contentWriteOperation(db) {
  const operation = operations.getStore();
  if(operation?.connection&&operation.connection!==contentSafetyConnection(db))return null;
  if(operation&&!writes.has(operation.method)&&!nonwrites.has(operation.method))fail('evidence_unavailable');
  return operation && writes.has(operation.method) ? operation : null;
}
// The transaction guard is installed by the native database module. Keeping the
// registry here SQLite-free preserves lazy adapter/CLI import boundaries.
let guard;
const nativeWrites = new WeakMap();
export function registerContentWriteGuard(value) { guard = value; }
export function beginContentWrite(db) {
  const operation = contentWriteOperation(db);
  if (!operation) return null;
  if (!guard) fail('evidence_unavailable');
  const state=guard(db, operation);
  if(!state)return null;
  const native=contentSafetyConnection(db);
  nativeWrites.set(native,state);
  const close=state.close;
  state.close=()=>{nativeWrites.delete(native);close();};
  return state;
}

// A verified terminal replay may have neither a new fact nor a changed target
// row. The writer supplies its canonical lookup only after its ledger binding
// has matched. It is never evaluated for a legacy/unscoped maintenance write.
export function declareContentTerminalInside(db, kind, canonical) {
  const state=nativeWrites.get(contentSafetyConnection(db));
  if(state)state.terminal(kind,canonical());
}

export function contentWriteMethodClass(method) {
  return writes.has(method)?'write':nonwrites.has(method)?'read':null;
}
