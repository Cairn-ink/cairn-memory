// Run directly in a child so an EventTarget uncaught exception cannot escape
// into the parent test runner. All reader/Worker scheduling uses this clock.
import { testClock } from '../../testing/context-product-test-clock.mjs';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as reader from '../../context-product-reader.mjs';
import { nativeTest, setup, guard, until, tracked, flush } from './context-read-registry-hold-fixture.mjs';

// Observe without intercepting the exception or changing its failing exit.
process.on('uncaughtExceptionMonitor',()=>process.stderr.write('held_cancel_cleanup_uncaught\n'));

nativeTest('cancelled held opening retains failed cleanup and quarantine after close rejection',async t=>{
  assert.equal(EventEmitter.captureRejections,false,'worker_emitters_keep_the_default_no_capture_policy');
  const s=await setup(t,{failed:true}),a=s.configuration(0,{mode:'block'}),b=s.configuration(1,{service:true,mode:'reject'}),ah=await s.open(a),abort=new AbortController();let closing;
  const open=s.runtime(true,message=>{if(message.result?.ok===true&&Object.hasOwn(message.result,'value')&&!closing)closing=tracked(ah.close());});
  const pending=tracked(open(b.options,{signal:abort.signal}));
  await until(()=>a.state[0]===1&&Boolean(closing),'held result before cancellation');await flush();
  const proof=s.proof(b),capture=s.captures[1];assert.equal(pending.settled,false);assert.equal(capture.resources[0],1);
  abort.abort();const error=await guard(pending.promise,'prompt cancellation');assert.equal(error.code,'read_cancelled');
  assert.equal(reader.readerRegistryHoldDiagnostic(error).outcome,4);
  assert.equal(await guard(capture.exited,'rejected close exit'),1);
  const cleanup=await b.options.supervisor.drain(proof.record.id).catch(error=>error);
  assert.equal(cleanup.code,'reader_failed');assert.equal(cleanup.cleanup.state,'failed');
  assert.deepEqual(['workerStopped','nativeDisposed','leasesReleased','providersSettled'].map(bit=>cleanup.cleanup[bit]),[false,false,false,true],'rejected_close_keeps_failed_disposal_proof');
  assert.equal(b.state[0],1,'host_close_was_attempted');assert.equal(capture.forced,0);
  const diagnostic=reader.maintenanceReaderFailureDiagnostic(error);
  assert.equal(diagnostic.lastFailure.engineCode,'read_cancelled');assert.equal(diagnostic.lastFailure.stage,'open');
  assert.equal(diagnostic.secondaryFailureCounts.exception,1);assert.equal(diagnostic.secondaryFailureCounts.worker_exit,1);assert.ok(diagnostic.secondaryFailureCounts.cleanup>=1);
  s.release(a);await guard(closing.promise,'other owner proof');
  await assert.rejects(s.open(s.configuration(2)),{code:'reader_failed'},'rejected_graceful_close_still_quarantines_third_owner');
  assert.equal(s.captures.length,2,'quarantined_third_owner_never_spawns');
  await testClock.advance(0,{waitForWorkers:false});await flush();
});
