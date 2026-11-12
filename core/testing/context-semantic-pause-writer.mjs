// A separate process owns the only SQLite library used by this writer.
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
const [path,encoded,mode]=process.argv.slice(2),namespace=JSON.parse(encoded);
const core=openMemoryCore({path,sessionEpisodes:{mode:'episode-v1'},captureEvidence:'staged-v1',captureQualification:'source-bound-v2'});
try {
  const result=core[mode==='disable'?'setProjectCapture':'setCapturePaused']({namespace,expectedGeneration:'initial',...(mode==='disable'?{enabled:false}:{paused:true})});
  assert.equal(result.ok,true,JSON.stringify(result));
} finally { core.close(); }
process.stdout.write(JSON.stringify({pid:process.pid,committed:true}));
