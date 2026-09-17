# Render the real transcript into terminal-styled frames, then ffmpeg -> GIF.
import json, re, os, subprocess, textwrap
from PIL import Image, ImageDraw, ImageFont
S=os.path.dirname(os.path.abspath(__file__))
log=open(f"{S}/transcript.txt",encoding="utf-8").read()
# parse "$ tool {args}" followed by a JSON object
calls=[]
for m in re.finditer(r"^\$ (\w+) (\{[^\n]*\})\n(\{\n.*?\n\})", log, re.M|re.S):
    calls.append((m.group(1), json.loads(m.group(2)), json.loads(m.group(3))))
assert len(calls)==7, len(calls)
W,H=1000,560; PAD=28; FS=19
font=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", FS)
bold=ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", FS)
BG=(24,24,27); FG=(228,228,231); DIM=(140,140,150); GREEN=(134,239,172); AMBER=(253,224,71); CYAN=(103,232,249); RED=(252,165,165)
def frame(lines, title):
    im=Image.new("RGB",(W,H),BG); d=ImageDraw.Draw(im)
    d.rounded_rectangle([0,0,W,44],fill=(39,39,42)); 
    for i,c in enumerate([(255,95,87),(255,189,46),(39,201,63)]): d.ellipse([16+i*22,14,32+i*22,30],fill=c)
    d.text((90,12),title,font=bold,fill=DIM)
    y=44+PAD
    for text,color,f in lines:
        for wl in textwrap.wrap(text, 82) or [""]:
            d.text((PAD,y),wl,font=f,fill=color); y+=FS+7
    d.text((PAD,H-30),"real keyless run · output trimmed · no model calls",font=font,fill=DIM)
    return im
def short(v): return v[:8]+"..." if isinstance(v,str) and len(v)>20 else v
frames=[]
T="cairn-memory · local · with receipts"
frames.append((frame([("Cairn Memory",GREEN,bold),("",FG,font),("Every memory keeps a receipt: the exact source text it was learned from.",FG,font),("Inspect it. Correct it at that revision. Forget it, and it stays forgotten.",FG,font),("",FG,font),("Below: one real run of the five MCP tools, session A then a fresh session B.",DIM,font)],T),3.2))
def call_frame(sess, name, args, res, picks, note=None, color=GREEN, secs=3.0):
    lines=[(f"#### {sess}",CYAN,bold),("",FG,font),(f"$ {name} {json.dumps(args, ensure_ascii=False)}",AMBER,bold),("",FG,font)]
    for label,val in picks: lines.append((f"  {label}: {json.dumps(val, ensure_ascii=False) if isinstance(val,bool) else val}",color if label!='error.code' else RED,font))
    if note: lines+=[("",FG,font),(note,DIM,font)]
    frames.append((frame(lines,T),secs))
r=calls[0]; m=r[2]["value"]["memory"]
call_frame("session A",r[0],r[1],r[2],[("ok",r[2]["ok"]),("memory.id",short(m["id"])),("memory.revision",m["revision"])])
r=calls[1]; v=r[2]["value"]; rc=v["receipts"][0]
call_frame("session A",r[0],{"memoryId":short(r[1]["memoryId"])},r[2],[("memory.content",json.dumps(v["memory"]["content"])),("memory.state",v["memory"]["state"]),("receipts[0].role",rc["role"]),("receipts[0].excerpt",json.dumps(rc["excerpt"])),("receipts[0].client",rc["client"])],note="the receipt is the source line the memory came from",secs=3.6)
frames.append((frame([("",FG,font),("  process exits.",DIM,font),("",FG,font),("  new process starts, same SQLite file.",DIM,font)],T),2.0))
r=calls[2]; v=r[2]["value"]; rc=v["receipts"][0]
call_frame("session B (fresh process)",r[0],{"memoryId":short(r[1]["memoryId"])},r[2],[("memory.content",json.dumps(v["memory"]["content"])),("memory.revision",v["memory"]["revision"]),("receipts[0].excerpt",json.dumps(rc["excerpt"]))],note="persisted across the restart, receipt intact")
r=calls[3]; m=r[2]["value"]["memory"]
call_frame("session B",r[0],{"memoryId":short(r[1]["memoryId"]),"expectedRevision":r[1]["expectedRevision"],"content":r[1]["content"]},r[2],[("ok",r[2]["ok"]),("memory.revision",m["revision"])],note="correct at the revision you inspected; a stale revision is rejected")
r=calls[4]
call_frame("session B",r[0],r[1],r[2],[("ok",r[2]["ok"]),("error.code",r[2]["error"]["code"])],note="semantic recall needs an OpenAI key you supply explicitly; nothing left this machine",color=RED)
r=calls[5]
call_frame("session B",r[0],{"memoryId":short(r[1]["memoryId"]),"expectedRevision":r[1]["expectedRevision"]},r[2],[("ok",r[2]["ok"]),("forgotten",r[2]["value"]["forgotten"])])
r=calls[6]
call_frame("session B",r[0],r[1],r[2],[("memories",json.dumps(r[2]["value"]["memories"]))],note="gone from active memory; a later capture cannot silently bring it back",secs=3.2)
frames.append((frame([("Try it",GREEN,bold),("",FG,font),("  git clone https://github.com/Cairn-ink/cairn-memory.git",FG,font),("  npm run install:preview -- --directory /abs/new/cairn-local --owner you",FG,font),("",FG,font),("  Node >= 22.16. No account. Model-free tools need no key.",DIM,font),("  README → Known limitations before relying on recall.",DIM,font)],T),3.6))
os.makedirs(f"{S}/frames",exist_ok=True)
concat=[]
for i,(im,secs) in enumerate(frames):
    p=f"{S}/frames/f{i:02d}.png"; im.save(p); concat.append(f"file '{p}'\nduration {secs}")
concat.append(f"file '{S}/frames/f{len(frames)-1:02d}.png'")
open(f"{S}/frames/list.txt","w").write("\n".join(concat)+"\n")
print("frames:",len(frames),"total seconds:",round(sum(s for _,s in frames),1))
