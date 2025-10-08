import { $, state, loadPdfFromFile, renderPage, setStat, setMeta, setQueued, getPageTextItems, sampleColorMedianAtPx } from './pdf-engine.js';
import { store, redraw, setSelected, getSelectedItem } from './overlay.js';
import { startMarquee, cloneFromAreaPx } from './clone.js';

const API_EDIT="/api/edit";
let eyedropMode=false, areaMode=false, lastClickPt=null;

function hexToRgb01(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(!m) return [0,0,0];
  return [parseInt(m[1],16)/255, parseInt(m[2],16)/255, parseInt(m[3],16)/255];
}

// UI wiring
$('load').onclick=async()=>{
  try{
    const f=$('file').files[0]; if(!f){setStat("Choose a PDF."); return;}
    await loadPdfFromFile(f);
    $('tools').style.display='';
    const sel=$('pageSelect'); sel.innerHTML="";
    for(let i=1;i<=state.pageCount;i++){const o=document.createElement('option');o.value=String(i);o.textContent=String(i);sel.appendChild(o);}
    sel.value="1";
    await renderPage();
    redraw();
    setStat(`Loaded ${state.pageCount} page(s).`,"ok");
  }catch(e){setStat("Error: "+e.message,"err")}
};

$('reset').onclick=()=>{
  state.pdfDoc=null; state.fileB64=null; store.items=[]; store.groups=[];
  setSelected(null);
  $('tools').style.display='none';
  $('cv').getContext('2d').clearRect(0,0,$('cv').width,$('cv').height);
  $('overlay').innerHTML=""; $('pageWrap').style.display='none';
  setQueued(); setStat("Cleared.");
};

$('prev').onclick=async()=>{ if(!state.pdfDoc)return; state.pageNum=Math.max(1,state.pageNum-1); $('pageSelect').value=String(state.pageNum); await renderPage(); redraw(); };
$('next').onclick=async()=>{ if(!state.pdfDoc)return; state.pageNum=Math.min(state.pageCount,state.pageNum+1); $('pageSelect').value=String(state.pageNum); await renderPage(); redraw(); };
$('zoom').oninput=async e=>{ if(!state.pdfDoc)return; state.scale=Number(e.target.value)/100; await renderPage(); redraw(); };
$('pageSelect').onchange=async e=>{ state.pageNum=Number(e.target.value)||1; await renderPage(); redraw(); };

$('toggleGuides').onchange=(e)=>{ if(e.target.checked)document.body.classList.remove('noguides'); else document.body.classList.add('noguides'); };

$('eyedrop').onclick=()=>{ eyedropMode=!eyedropMode; areaMode=false; $('eyedrop').textContent=eyedropMode?"Eyedrop (ON)":"Eyedrop"; $('areaClone').textContent="Select Area (Clone)"; setStat(eyedropMode?"Click near text to pick style.":"Eyedrop off.","ok"); };
$('areaClone').onclick=()=>{ areaMode=!areaMode; eyedropMode=false; $('areaClone').textContent=areaMode?"Select Area (ON)":"Select Area (Clone)"; $('eyedrop').textContent="Eyedrop"; setStat(areaMode?"Drag a rectangle to clone just that area.":"Area clone off.","ok"); };

$('ungroup').onclick=()=>{ 
  if(!getSelectedItem() && !(String(getSelectedId||'').startsWith('g:'))) { setStat("Select a section (group) first.","err"); return; }
  const id = (getSelectedId && getSelectedId()) || null;
  if(id && id.startsWith('g:')){
    const gid=id.slice(2); store.groups=store.groups.filter(g=>g.id!==gid); setSelected(null); redraw(); setQueued(); setStat("Ungrouped.","ok");
  } else {
    setStat("Select a section (group) first.","err");
  }
};

// Canvas interactions
$('cv').addEventListener('pointerdown', async (e)=>{
  if(!state.pdfDoc) return;
  const r=$('cv').getBoundingClientRect();
  const pxX=e.clientX-r.left, pxY=e.clientY-r.top;
  const xPt=Math.round(pxX*state.ptPerPx), yPt=Math.round(pxY*state.ptPerPx);

  if(eyedropMode){
    const items=await getPageTextItems();
    let best=null,bestD=1e15;
    for(const it of items){
      const size=it.size;
      const cx=it.x + (it.w/2);
      const cy=it.y + size*0.6;
      const dx=cx-xPt, dy=cy-yPt; const dd=dx*dx+dy*dy;
      if(dd<bestD){bestD=dd; best={size,font:it.fontName, px:[cx/state.ptPerPx, cy/state.ptPerPx]};}
    }
    if(best){
      $('size').value=Math.max(6,Math.round(best.size));
      // font inference happens on clone; use picker only for size + color
      $('color').value=sampleColorMedianAtPx(best.px[0],best.px[1]);
      $('picked').textContent=`picked: ${$('size').value}pt, ${$('color').value}`;
      setStat("Style picked.","ok");
    }
    eyedropMode=false; $('eyedrop').textContent="Eyedrop"; return;
  }

  if(areaMode){ startMarquee(pxX,pxY); return; }

  lastClickPt={x:xPt,y:yPt};
  setStat(`Placement set at (${xPt}, ${yPt}).`,"ok");
});

// Add Text/Line
$('addText').onclick=()=>{
  if(!state.fileB64){setStat("Load a PDF first.","err");return;}
  if(!lastClickPt){setStat("Click preview to position first.","err");return;}
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
  store.items.push({
    id,type:'text',page:state.pageNum,
    x:lastClickPt.x,y:lastClickPt.y,width:parseFloat($('width').value)||460,
    text:$('text').value||"",font:$('font').value||"Times-Roman",
    size:parseFloat($('size').value)||11,colorHex:$('color').value||"#000000",
    lineHeight:parseFloat($('lineHeight').value)||Math.round((parseFloat($('size').value)||11)*1.35),
    fauxBold:parseInt($('fauxBold').value)||0,skewDeg:parseFloat($('skewDeg').value)||0,tracking:parseFloat($('tracking').value)||0
  });
  setSelected(id); redraw(); setQueued(); setStat("Text added.","ok");
};

$('addLine').onclick=()=>{
  if(!state.fileB64){setStat("Load a PDF first.","err");return;}
  if(!lastClickPt){setStat("Click preview to position first.","err");return;}
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
  store.items.push({id,type:'line',page:state.pageNum,x:lastClickPt.x,y:lastClickPt.y,width:parseFloat($('lineWidth').value)||460,thick:parseFloat($('lineThick').value)||2,colorHex:$('color').value||"#000000"});
  setSelected(id); redraw(); setQueued(); setStat("Line added.","ok");
};

// sidebar live update
['text','font','size','color','width','lineHeight','fauxBold','skewDeg','tracking','lineWidth','lineThick'].forEach(id=>{
  $(id).addEventListener(id==='text'?'input':'change', ()=>{
    const it=getSelectedItem(); if(!it) return;
    if(it.type==='text'){
      it.text=$('text').value||""; it.font=$('font').value||"Times-Roman";
      it.size=parseFloat($('size').value)||11; it.colorHex=$('color').value||"#000000";
      it.width=parseFloat($('width').value)||460; it.lineHeight=parseFloat($('lineHeight').value)||Math.round(it.size*1.35);
      it.fauxBold=parseInt($('fauxBold').value)||0; it.skewDeg=parseFloat($('skewDeg').value)||0; it.tracking=parseFloat($('tracking').value)||0;
    }else{
      it.colorHex=$('color').value||it.colorHex||"#000000";
      it.width=parseFloat($('lineWidth').value)||it.width||460;
      it.thick=parseFloat($('lineThick').value)||it.thick||2;
    }
    redraw();
  });
});

// Apply / generate
$('apply').onclick=async()=>{
  try{
    if(!state.fileB64){setStat("Load a PDF first.","err");return;}
    if(store.items.length===0){setStat("No items queued.","err");return;}
    setStat("Generating…");
    const edits=store.items.map(it=>{
      const [r,g,b]=hexToRgb01(it.colorHex||'#000000');
      if(it.type==='text'){return{type:'text',page:it.page,x:it.x,y:it.y,width:it.width,text:it.text,font:it.font,size:it.size,color:[r,g,b],lineHeight:it.lineHeight||Math.round(it.size*1.35),fauxBold:it.fauxBold||0,skewDeg:it.skewDeg||0,tracking:it.tracking||0};}
      return{type:'line',page:it.page,x:it.x,y:it.y,width:it.width,thick:it.thick,color:[r,g,b]};
    });
    const r=await fetch(API_EDIT,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:state.fileB64,edits})});
    if(!r.ok){const t=await r.text();throw new Error(t||r.statusText);}
    const {pdf}=await r.json();
    const blob=new Blob([Uint8Array.from(atob(pdf),c=>c.charCodeAt(0))],{type:'application/pdf'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='PDF_Forge_Output.pdf'; a.click();
    setStat("Done ✓ File downloaded.","ok");
  }catch(e){setStat("Error: "+e.message,"err");}
};

$('clearBlocks').onclick=()=>{ store.items=[]; store.groups=[]; setSelected(null); redraw(); setQueued(); };

// quick colors
$('quickRed').onclick=()=>{$('color').value='#c62828'; const it=getSelectedItem(); if(it){it.colorHex='#c62828'; redraw();} };
$('quickBlue').onclick=()=>{$('color').value='#1565c0'; const it=getSelectedItem(); if(it){it.colorHex='#1565c0'; redraw();} };
$('quickBody').onclick=()=>{$('color').value='#000000'; const it=getSelectedItem(); if(it){it.colorHex='#000000'; redraw();} };
