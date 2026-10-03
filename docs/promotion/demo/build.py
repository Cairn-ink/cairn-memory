#!/usr/bin/env python3
"""Build a deterministic presentation of selected fields from a real MCP transcript."""
import html,json,re
from pathlib import Path
p=Path(__file__).resolve().parent
raw=p.joinpath('transcript.txt').read_text()
calls=[]
for m in re.finditer(r'^\$ (\w+) (\{[^\n]*\})\n(\{.*?\n\})',raw,re.M|re.S):
 calls.append({'tool':m[1],'args':json.loads(m[2]),'result':json.loads(m[3])})
assert [c['tool'] for c in calls]==['remember_memory','inspect_memory','inspect_memory','correct_memory','recall_memory','forget_memory','inspect_memory']
saved,a,b,correct,recall,forget,empty=calls
mid=saved['result']['value']['memory']['id']; v1=saved['result']['value']['memory']['revision'];v2=correct['result']['value']['memory']['revision']
assert a['result']['value']['memory']['id']==b['result']['value']['memory']['id']==mid
assert correct['args']['expectedRevision']==v1 and forget['args']['expectedRevision']==v2
assert recall['result']['error']['code']=='model_not_configured' and empty['result']['value']['memories']==[]
receipt=a['result']['value']['receipts'][0]
scenes=[
 {'id':'s01-save','start':0,'duration':5,'title':'AI memory you can inspect.','sub':'Cairn Memory · A real, model-free local run','label':'SESSION A / REMEMBER','lines':[('$ remember_memory','command'),('content: '+json.dumps(saved['args']['content']),'normal'),('kind: '+json.dumps(saved['args']['kind']),'muted'),('→ revision: '+str(v1)+'   ·   ok: true','success')],'note':'Explicit save. Local SQLite. No Cairn account required.'},
 {'id':'s02-source','start':5,'duration':5,'title':'Inspect the source text.','sub':'See the receipt attached to the saved memory','label':'SESSION A / INSPECT','lines':[('$ inspect_memory','command'),('receipt.role: '+json.dumps(receipt['role']),'muted'),('receipt.excerpt:','muted'),(json.dumps(receipt['excerpt']),'success')],'note':'A receipt records submitted text; it does not independently authenticate it.'},
 {'id':'s03-restart','start':10,'duration':5,'title':'New process. Same memory.','sub':'Session A closes. Session B opens the same local database.','label':'SESSION B / FRESH PROCESS','lines':[('$ inspect_memory','command'),('id: '+mid,'muted'),('revision: '+str(b['result']['value']['memory']['revision'])+'   ·   state: '+b['result']['value']['memory']['state'],'success'),('content: '+json.dumps(b['result']['value']['memory']['content']),'normal')],'note':'Persistence is shown by inspection after a real process restart.'},
 {'id':'s04-correct','start':15,'duration':6,'title':'Changed your mind? Correct it.','sub':'Update the memory at the revision you inspected','label':'SESSION B / CORRECT','lines':[('$ correct_memory','command'),('expectedRevision: '+str(correct['args']['expectedRevision']),'muted'),('content: '+json.dumps(correct['args']['content']),'normal'),('→ revision: '+str(v2)+'   ·   state: '+correct['result']['value']['memory']['state'],'success')],'note':'The correction is tied to this memory ID and its inspected revision.'},
 {'id':'s05-recall','start':21,'duration':5,'title':'Semantic recall needs a model key.','sub':'This run deliberately makes no model calls','label':'SESSION B / RECALL BOUNDARY','lines':[('$ recall_memory','command'),('query: '+json.dumps(recall['args']['query']),'normal'),('→ ok: false','muted'),('error.code: '+recall['result']['error']['code'],'accent')],'note':'With a provider key, selected context is sent to the cloud model.'},
 {'id':'s06-forget','start':26,'duration':6,'title':'Forget it from active recall.','sub':'Forget at revision 2, then inspect the active list','label':'SESSION B / FORGET + INSPECT','lines':[('$ forget_memory  { expectedRevision: '+str(forget['args']['expectedRevision'])+' }','command'),('→ forgotten: '+str(forget['result']['value']['forgotten']).lower(),'success'),('$ inspect_memory {}','command'),('→ memories: '+json.dumps(empty['result']['value']['memories']),'success')],'note':'Active-list removal is shown here. This is not a physical-erasure claim.'},
 {'id':'s07-try','start':32,'duration':4,'title':'Try the local developer preview.','sub':'Inspect. Correct. Forget.','label':'OPEN SOURCE / CAIRN MEMORY','lines':[('github.com/Cairn-ink/cairn-memory','url'),('Start with the model-free walkthrough.','normal'),('Star the repo to follow the preview.','normal')],'note':'Linux x64 verified · Source install · Semantic recall requires a key'}
]
p.joinpath('scenes.json').write_text(json.dumps(scenes,indent=2)+'\n')
p.joinpath('evidence.json').write_text(json.dumps({'memoryId':mid,'initialRevision':v1,'correctedRevision':v2,'sourceExcerpt':receipt['excerpt'],'receiptId':receipt['id'],'recordedAt':receipt['createdAt'],'calls':calls},indent=2)+'\n')
css='''
@font-face{font-family:Inter;src:url(assets/fonts/Inter-400.woff2);font-weight:400}
@font-face{font-family:Inter;src:url(assets/fonts/Inter-700.woff2);font-weight:700}
@font-face{font-family:EBGaramond;src:url(assets/fonts/EBGaramond-400.woff2);font-weight:400}
@font-face{font-family:JetBrainsMono;src:url(assets/fonts/JetBrainsMono-400.woff2);font-weight:400}
*{box-sizing:border-box;margin:0;padding:0}html,body{width:1280px;height:720px;overflow:hidden;background:#FAF9F5;color:#141413}#root{width:100%;height:100%;position:relative;container-type:size;font-family:Inter,sans-serif}.background{position:absolute;inset:0;background:#FAF9F5}.clip{position:absolute;inset:0}.brand{position:absolute;left:60px;top:36px;display:flex;gap:14px;align-items:center}.mark{font-size:28px;color:#CC785C}.name{font-size:18px;letter-spacing:.05em}.badge{position:absolute;right:60px;top:42px;font-family:JetBrainsMono,monospace;font-size:16px;letter-spacing:.03em}.title{position:absolute;left:60px;top:100px;width:1160px;font-family:EBGaramond,serif;font-size:57px;line-height:1.06;letter-spacing:-.02em;font-weight:400}.sub{position:absolute;left:62px;top:173px;font-size:22px;line-height:1.3}.panel{position:absolute;left:60px;top:231px;width:1160px;height:331px;background:#181715;color:#FAF9F5;border:1px solid #48443e;border-radius:8px;overflow:hidden}.panelbar{height:47px;padding:15px 27px;background:#252320;border-bottom:1px solid #48443e;font-family:JetBrainsMono,monospace;font-size:15px;letter-spacing:.1em;color:#FAF9F5}.lines{padding:26px 28px;display:flex;flex-direction:column;gap:12px}.line{white-space:pre;font-family:JetBrainsMono,monospace;font-size:25px;line-height:1.36;min-height:34px}.command{color:#FAF9F5}.muted{color:#c9c3b8}.success{color:#70cbbb}.accent{color:#E8A55A}.url{font-size:37px;line-height:1.2;margin:10px 0 13px}.note{position:absolute;left:62px;top:588px;width:1156px;font-size:20px;line-height:1.45}.footer{position:absolute;left:60px;right:60px;bottom:31px;display:flex;justify-content:space-between;border-top:1px solid #d4cfc4;padding-top:16px;font-size:14px;color:#57544e}.progress{position:absolute;left:0;bottom:0;width:100%;height:5px;background:#CC785C;transform-origin:left center}.scene-num{font-family:JetBrainsMono,monospace}
'''
parts=['<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Cairn Memory — local preview</title><script src="assets/gsap.min.js"></script><style>'+css+'</style></head><body><div id="root" data-composition-id="main" data-start="0" data-duration="36" data-width="1280" data-height="720" data-fps="30"><div id="paper" class="background clip" data-start="0" data-duration="36" data-track-index="0"></div><div class="brand"><span class="mark">✱</span><span class="name">cairn memory</span></div><div class="badge">DEVELOPER PREVIEW · MODEL-FREE RUN</div>']
p.joinpath('compositions/frames').mkdir(parents=True,exist_ok=True)
for idx,s in enumerate(scenes):
 q=lambda x:html.escape(x)
 lines=''.join('<div id="'+s['id']+'-line-'+str(i)+'" class="line '+c+'">'+q(t)+'</div>' for i,(t,c) in enumerate(s['lines']))
 content=f'<h1 class="title">{q(s["title"])}</h1><p class="sub">{q(s["sub"])}</p><div class="panel"><div class="panelbar">{q(s["label"])}</div><div class="lines">{lines}</div></div><p class="note">{q(s["note"])}</p><div class="footer"><span>Actual tool output · Selected fields · Display timing edited</span><span class="scene-num">{idx+1:02d} / 07</span></div>'
 script='const tl=gsap.timeline({paused:true});'
 for i in range(len(s['lines'])):
  at=(.4 if i==0 else 1.0+i*.55)
  script+=f'tl.fromTo("#{s["id"]}-line-{i}",{{opacity:0}},{{opacity:1,duration:.14,ease:"none"}},{at});'
 script+=f'window.__timelines["{s["id"]}"]=tl;'
 frame=f'<template><div id="{s["id"]}" data-composition-id="{s["id"]}" data-duration="{s["duration"]}" data-width="1280" data-height="720" style="width:100%;height:100%;position:relative">{content}<script>{script}</script></div></template>'
 p.joinpath('compositions/frames',s['id']+'.html').write_text(frame)
 parts.append(f'<div id="slot-{s["id"]}" class="clip" data-composition-id="{s["id"]}" data-composition-src="compositions/frames/{s["id"]}.html" data-start="{s["start"]}" data-duration="{s["duration"]}" data-track-index="1" data-width="1280" data-height="720"></div>')
parts.append('<div id="progress" class="progress"></div></div><script>const tl=gsap.timeline({paused:true});tl.fromTo("#progress",{scaleX:0},{scaleX:1,duration:36,ease:"none"},0);window.__timelines["main"]=tl;</script></body></html>')
p.joinpath('index.html').write_text('\n'.join(parts))
board='''---
format: 1280x720
duration: 36s
message: "Cross-session AI memory you can inspect, correct and forget."
arc: Demo Loop
audience: Developers evaluating local AI memory
mode: autonomous
music: none
---

## Video direction
Code-editorial cream, ink and coral with warm navy evidence panels. Fixed camera and framing keep transcript excerpts readable. Success and boundary lines reveal after the command, at edited reading pace. No narration, music, synthetic UI, camera drift or invented interaction. Persistent model-free label. Motion uses code-terminal-run's output-line reveal pattern and stat-bars-and-fills' progress fill. All seven beats compose one evidence surface; frame boundaries hard-cut inside the same layout. Seven deterministic frame compositions share the same evidence geometry and the actual transcript IDs.
'''
for i,s in enumerate(scenes):
 board+=f'\n## Frame {i+1} — {s["title"]}\n\n- status: animated\n- src: compositions/frames/{s["id"]}.html\n- duration: {s["duration"]}s\n- transition_in: cut\n- scene: {s["label"]}\n- asset_candidates: transcript.txt (focal, evidence)\n- blueprint: compose\n\n0.0–0.4s: title and transcript panel; 0.4–3.0s: command then selected response fields reveal in reading order. Remaining time: hold for reading. {s["note"]}\n'
p.joinpath('STORYBOARD.md').write_text(board)
print(f'Built 36s presentation from {len(calls)} real tool calls; memory {mid}; revisions {v1}->{v2}')
