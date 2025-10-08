// clone.js - area selection, building lines, creating items
import { $, state, getPageTextItems, sampleColorMedianAtPx, guessFontFromName, setStat } from './pdf-engine.js';
import { store, redraw, setSelected, setQueued } from './overlay.js';

// marquee handlers
let marqueeEl=null,mStart=null;

export function startMarquee(pxX,pxY){
  const ov=$('overlay');
  if(marqueeEl && marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
  marqueeEl=document.createElement('div'); marqueeEl.className='marquee';
  marqueeEl.style.left=pxX+'px'; marqueeEl.style.top=pxY+'px'; marqueeEl.style.width='0px'; marqueeEl.style.height='0px'; ov.appendChild(marqueeEl);
  mStart={x:pxX,y:pxY};
  const move=(e)=>{const r=$('cv').getBoundingClientRect(); const cx=e.clientX-r.left, cy=e.clientY-r.top; const x=Math.min(mStart.x,cx), y=Math.min(mStart.y,cy); marqueeEl.style.left=x+'px'; marqueeEl.style.top=y+'px'; marqueeEl.style.width=Math.abs(cx-mStart.x)+'px'; marqueeEl.style.height=Math.abs(cy-mStart.y)+'px';};
  const up=async ()=>{
    document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
    const rect=marqueeEl.getBoundingClientRect(), cvRect=$('cv').getBoundingClientRect();
    const selPx={x:rect.left-cvRect.left,y:rect.top-cvRect.top,w:rect.width,h:rect.height};
    if(selPx.w<5 || selPx.h<5){setStat("Selection too small.","err"); marqueeEl.remove(); marqueeEl=null; return;}
    const selPt={x:Math.round(selPx.x*state.ptPerPx),y:Math.round(selPx.y*state.ptPerPx),w:Math.round(selPx.w*state.ptPerPx),h:Math.round(selPx.h*state.ptPerPx)};
    await cloneFromAreaPx(selPt, selPx);
    marqueeEl.remove(); marqueeEl=null;
  };
  document.addEventListener('pointermove',move,{passive:false});
  document.addEventListener('pointerup',up,{once:true});
}

function med(arr){ const a=arr.slice().sort((x,y)=>x-y); return a.length?a[Math.floor(a.length/2)]:0; }
function mode(arr){ const m=new Map(); let best=null,bestC=0; for(const v of arr){const c=(m.get(v)||0)+1; m.set(v,c); if(c>bestC){bestC=c; best=v;}} return best; }

function linesFromItems(items){
  const its = items.slice().sort((A,B)=> (A.y - B.y) || (A.x - B.x));
  const medSize = med(its.map(s=>s.size));
  const vTol = Math.max(0.6*medSize, 3);

  const lines=[];
  for(const s of its){
    const lineH = s.h || s.size*1.2;
    const baseline = s.y + lineH*0.85;
    let ln=null,bestD=1e9;
    for(const L of lines){ const d=Math.abs(L.baseline-baseline); if(d<=vTol && d<bestD){ln=L;bestD=d;} }
    if(!ln){ ln={baseline,segs:[],xMin:+Infinity,xMax:-Infinity,top:+Infinity,bottom:-Infinity}; lines.push(ln); }
    ln.segs.push(s);
    ln.xMin=Math.min(ln.xMin,s.x); ln.xMax=Math.max(ln.xMax,s.x+s.w);
    ln.top=Math.min(ln.top,s.y); ln.bottom=Math.max(ln.bottom,s.y+(s.h||s.size*1.2));
  }

  for(const L of lines){
    L.segs.sort((a,b)=>a.x-b.x);
    let text='', prev=null;
    for(const s of L.segs){
      if(prev){
        const gap=s.x-(prev.x+prev.w);
        const avg=(s.size+prev.size)*0.5;
        if(gap>Math.max(0.55*avg,4)) text+=' ';
      }
      text += s.str;
      prev=s;
    }
    L.text = text.trimEnd();
    L.y = Math.round(L.top);
    L.h = Math.round(L.bottom - L.top);
    L.size = Math.round(med(L.segs.map(s=>s.size)));
    L.fontName = mode(L.segs.map(s=>s.fontName)) || 'Times-Roman';
    L.xMin = Math.round(L.xMin);
    L.xMax = Math.round(L.xMax);
  }
  lines.sort((a,b)=> (a.y-b.y) || (a.xMin-b.xMin));
  return lines;
}

// tolerant hit-test + create items + group
export async function cloneFromAreaPx(selPt){
  const items = await getPageTextItems();
  const sx1=selPt.x, sy1=selPt.y, sx2=sx1+selPt.w, sy2=sy1+selPt.h;
  const overlapFrac=(ix1,iy1,ix2,iy2)=>{
    const w=Math.max(0,Math.min(ix2,sx2)-Math.max(ix1,sx1));
    const h=Math.max(0,Math.min(iy2,sy2)-Math.max(iy1,sy1));
    const inter=w*h; const a=Math.max(1,(ix2-ix1)*(iy2-iy1));
    return inter/a;
  };
  const hits = items.filter(s=>{
    const ix1=s.x, iy1=s.y, ix2=s.x+s.w, iy2=s.y+s.h;
    const cx=(ix1+ix2)/2, cy=(iy1+iy2)/2;
    if (cx>=sx1 && cx<=sx2 && cy>=sy1 && cy<=sy2) return true;
    return overlapFrac(ix1,iy1,ix2,iy2) >= 0.65;
  });
  if(!hits.length){ setStat("No text found in selection.","err"); return; }

  const lines = linesFromItems(hits);
  const newIds=[];
  for(const L of lines){
    const pxX = ((L.xMin + L.xMax)/2) / state.ptPerPx;
    const pxY = (L.y + L.h*0.6) / state.ptPerPx;
    const colorHex = sampleColorMedianAtPx(pxX, pxY);

    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now()+Math.random());
    const w  = Math.max(20, Math.round(L.xMax - L.xMin));
    const lineGap = Math.max(Math.round(L.size*1.25), Math.round(L.h*1.05));

    store.items.push({
      id, type:'text', page:state.pageNum,
      x:Math.round(L.xMin), y:Math.round(L.y), width:w,
      text:L.text, font:guessFontFromName(L.fontName), size:Math.round(L.size),
      colorHex, lineHeight:lineGap,
      fauxBold:/bold|semi|demi|medium/i.test(L.fontName)?1:0,
      skewDeg:/ital|obl/i.test(L.fontName)?12:0,
      tracking:0
    });
    newIds.push(id);
  }

  // Group tight
  const rects=newIds.map(id=>{
    const it=store.items.find(i=>i.id===id);
    const linesCount=(it.text.match(/\n/g)||[]).length+1;
    const h=(it.lineHeight||Math.round(it.size*1.35))*linesCount;
    return {x:it.x,y:it.y,w:it.width,h};
  });
  const gx=Math.min(...rects.map(r=>r.x));
  const gy=Math.min(...rects.map(r=>r.y));
  const gxe=Math.max(...rects.map(r=>r.x+r.w));
  const gye=Math.max(...rects.map(r=>r.y+r.h));
  const gid=crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
  store.groups.push({id:gid,page:state.pageNum,x:gx,y:gy,w:gxe-gx,h:gye-gy,children:newIds.map(id=>({refId:id}))});
  setSelected("g:"+gid);
  redraw(); setQueued();
  setStat(`Cloned ${newIds.length} line(s).`,"ok");
}
