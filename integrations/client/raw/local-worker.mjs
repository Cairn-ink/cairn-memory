import { readConfigurationSnapshot } from '../../../adapters/local/configuration.mjs';
import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { stateLock } from '../state-lock.mjs';
import { workerOptions, workerContext, workerOperation, summary, fault } from './local-worker-input.mjs';
import { loadIdentity, bindRoot, readSession, initializeSession } from './local-worker-state.mjs';
import { runProgress } from './local-worker-progress.mjs';
import { sourceBudget, openWorkerSource, qualifySource, sourceSize, completeBoundary, cursorSource, verifyCursorSource, sourceReason } from './local-worker-source.mjs';
import { checkHostPermission } from './local-host-permission.mjs';

export function createLocalRawWorker(value) {
  const options = workerOptions(value);
  async function execute(value, callOptions, initialize) {
    let operation, identity, opened, cursor, bytes;
    try {
      const context = workerContext(value,options.authority.client,initialize);
      operation = workerOperation(callOptions); operation.check();
      let config;
      try { config = (await readConfigurationSnapshot(options.transport.configPath)).config; }
      catch { fault('config_invalid'); }
      operation.check();
      if (JSON.stringify(localAuthorityInput(config.authority)) !== JSON.stringify(options.authority)) fault('authority_changed');
      identity = await loadIdentity(options,context,operation);
      await bindRoot(options,identity,initialize,operation);
      return await stateLock(identity.lockPath,async () => {
        try {
          config = (await readConfigurationSnapshot(options.transport.configPath)).config;
          if (JSON.stringify(localAuthorityInput(config.authority)) !== JSON.stringify(options.authority)) fault('authority_changed');
          await checkHostPermission(config);
        } catch (error) {
          if (['cancelled','work_limit','authority_changed'].includes(error.reason)) throw error;
          fault(error.reason === 'capture_disabled' ? 'authority_changed':error.reason === 'store_invalid' || error.code === 'invalid_local_capture_configuration' ? 'config_invalid':'state_invalid');
        }
        operation.check(); cursor = await readSession(identity,options.authority.client);
        if (!initialize && !cursor) fault('state_invalid');
        bytes = sourceBudget(operation);
        try {
          opened = await openWorkerSource(context,operation,bytes);
          await qualifySource(options,context,opened,operation);
          if (cursor) {
            await verifyCursorSource(identity,opened,cursor); operation.check();
            if (initialize) return cursor.blockedReason ? summary('blocked',cursor.blockedReason,cursor)
              : summary('ready',cursor.selection.awaitingUserBoundary ? 'awaiting_user_boundary' : null,cursor);
            return await runProgress({ options,identity,context,opened,cursor,operation,bytes });
          }
          const size = await sourceSize(opened);
          if (context.start === 'eof' && !(await completeBoundary(opened,size))) return summary('waiting','partial_record');
          const offset = context.start === 'beginning' ? 0 : size;
          cursor = { version:'local-raw-cursor-v1',sessionKey:identity.sessionKey,wireSessionId:identity.wireSessionId,
            authorityCommitment:identity.authorityCommitment,epoch:0,offset,issuedOrdinal:0,
            source:await cursorSource(identity,opened,offset),
            selection:options.authority.client === 'claude-code' ? { ownSkillTurn:context.start === 'eof',awaitingUserBoundary:context.start === 'eof' } : {},
            pending:null,blockedReason:null };
          operation.check(); await initializeSession(identity,cursor);
          return summary('ready','initialized',cursor);
        } catch (error) { fault(sourceReason(error,bytes)); }
        finally { const closing = opened; opened = undefined; await closing?.close(); }
      });
    } catch (error) {
      let reason = error.message === 'state_busy' ? 'state_busy' : error.reason ?? 'state_invalid';
      try { operation?.check(); } catch (stopped) { reason = stopped.reason; }
      return summary(reason === 'state_busy' ? 'busy' : 'blocked',reason,cursor);
    } finally {
      try { await opened?.close(); }
      finally { identity?.key.fill(0); operation?.close(); }
    }
  }
  return Object.freeze({ initialize:(context, options = {}) => execute(context,options,true),
    run:(context, options = {}) => execute(context,options,false) });
}
