// app.js - wire UI to engine/overlay/clone
import { $, state, setStat, setMeta, loadPdfFromFile, renderPage, sampleColorMedianAtPx } from './pdf-engine.js';
import { store, redraw, setSelected, updateSelectedFromSidebar, clearAll, setQueued, isGroup } from './overlay.js';
import { startMarquee, cloneFromAreaPx } from './clone.js';

const API_EDIT="/api/edit";

function hexToRgb01(hex){
  const m=/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if(!m) return [0,0,0];
  return [parseInt(m[1],16)/255,parseInt(m[2],16)/255,parseInt(m[3],16)/255];
}

// UI helpers
function buildPageSelect(){
  const sel=$('pageSelect'); sel.innerHTML="";
  for(let i=1;i<=state.pageCount;i++){const o=document.createElement('option');o.value=String(i);o.textContent=String(i);sel.appendChild(o);}
  sel.value=String(state.pageNum);
}

// LOAD / CLEAR
$('load').onclick=async()=>{
  try{
    const f=$('file').files[0];
    if(!f){ setStat("Choose a PDF."); return; }
    await loadPdfFromFile(f);
    $('tools').style.display='';
    buildPageSelect();
    await renderPage();
    redraw();
    setStat(`Loaded ${state.pageCount} page(s).`,"ok");
  }catch(e){ setStat("Error: "+(e?.message||e),"err"); }
};
$('reset').onclick=()=>{ clearAll(); $('tools').style.display='none'; const ctx=$('cv').getContext('2d'); ctx.clearRect(0,0,$('cv').width,$('cv').height); $('overlay').innerHTML=""; $('pageWrap').style.display='none'; };

// NAV / ZOOM
$('prev').onclick=async()=>{ if(!state.pdfDoc)return; state.pageNum=Math.max(1,state.pageNum-1); $('pageSelect').value=String(state.pageNum); await renderPage(); redraw(); };
$('next').onclick=async()=>{ if(!state.pdfDoc)return; state.pageNum=Math.min(state.pageCount,state.pageNum+1); $('pageSelect').value=String(state.pageNum); await renderPage(); redraw(); };
$('zoom').oninput=async e=>{ if(!state.pdfDoc)return; state.scale=Number(e.target.value)/100; await renderPage(); redraw(); };
$('pageSelect').onchange=async e=>{ state.pageNum=Number(e.target.value)||1; await renderPage(); redraw(); };

$('toggleGuides').onchange=(e)=>{ if(e.target.checked)document.body.classList.remove('noguides'); else document.body.classList.add('noguides'); };

// Eyedrop / Area Clone / Ungroup
$('eyedrop').onclick=()=>{ store.eyedropMode=!store.eyedropMode; store.areaMode=false; $('eyedrop').textContent=store.eyedropMode?"Eyedrop (ON)":"Eyedrop"; $('areaClone').textContent="Select Area (Clone)"; setStat(store.eyedropMode?"Click near text to pick style.":"Eyedrop off.","ok"); };
$('areaClone').onclick=()=>{ store.areaMode=!store.areaMode; store.eyedropMode=false; $('areaClone').textContent=store.areaMode?"Select Area (ON)":"Select Area (Clone)"; $('eyedrop').textContent="Eyedrop"; setStat(store.areaMode?"Drag a rectangle to clone just that area.":"Area clone off.","ok"); };
$('ungroup').onclick=()=>{ if(!isGroup(store.selectedId)){setStat("Select a section (group) first.","err");return;} const gid=store.selectedId.slice(2); store.groups=store.groups.filter(g=>g.id!==gid); store.selectedId=null; redraw(); setQueued(); setStat("Ungrouped.","ok"); };

// Sidebar change binding
;['text','font','size','color','width','lineHeight','fauxBold','skewDeg','tracking','lineWidth','lineThick'].forEach(id=>{
  $(id).addEventListener(id==='text'?'input':'change', updateSelectedFromSidebar);
});

// Keyboard delete
window.addEventListener('keydown',(e)=>{
  if(!store.selectedId) return;
  if(e.key==='Delete'||e.key==='Backspace'){
    if(isGroup(store.selectedId)){const gid=store.selectedId.slice(2); store.groups=store.groups.filter(g=>g.id!==gid);}
    else{store.items=store.items.filter(x=>x.id!==store.selectedId); store.groups.forEach(g=>g.children=g.children.filter(ch=>ch.refId!==store.selectedId));}
    store.selectedId=null; redraw(); setQueued(); setStat("Deleted.","ok"); e.preventDefault();
  }
});

// Add Text/Line
$('addText').onclick=()=>{
  if(!state.fileB64){setStat("Load a PDF first.","err");return;}
  if(!store.lastClickPt){setStat("Click preview to position first.","err");return;}
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
  store.items.push({
    id,type:'text',page:state.pageNum,x:store.lastClickPt.x,y:store.lastClickPt.y,
    width:parseFloat($('width').value)||460,text:$('text').value||"",
    font:$('font').value||"Times-Roman",
    size:parseFloat($('size').value)||11,
    colorHex:$('color').value||"#000000",
    lineHeight:parseFloat($('lineHeight').value)||Math.round((parseFloat($('size').value)||11)*1.35),
    fauxBold:parseInt($('fauxBold').value)||0,skewDeg:parseFloat($('skewDeg').value)||0,tracking:parseFloat($('tracking').value)||0
  });
  setSelected(id); redraw(); setQueued(); setStat("Text added.","ok");
};
$('addLine').onclick=()=>{
  if(!state.fileB64){setStat("Load a PDF first.","err");return;}
  if(!store.lastClickPt){setStat("Click preview to position first.","err");return;}
  const id=crypto.randomUUID?crypto.randomUUID():String(Date.now()+Math.random());
  store.items.push({id,type:'line',page:state.pageNum,x:store.lastClickPt.x,y:store.lastClickPt.y,width:parseFloat($('lineWidth').value)||460,thick:parseFloat($('lineThick').value)||2,colorHex:$('color').value||"#000000"});
  setSelected(id); redraw(); setQueued(); setStat("Line added.","ok");
};

// Canvas interactions (pointerdown)
$('cv').addEventListener('pointerdown', async (e)=>{
  const r=$('cv').getBoundingClientRect();
  const pxX=e.clientX-r.left, pxY=e.clientY-r.top;
  const xPt=Math.round(pxX*state.ptPerPx), yPt=Math.round(pxY*state.ptPerPx);

  if(store.eyedropMode){
    // naive pick: just use clicked area; this works very well with our median-dark sampler
    $('color').value = sampleColorMedianAtPx(pxX, pxY);
    $('picked').textContent = `picked: —, —pt, ${$('color').value}`;
    setStat("Color picked.","ok");
    store.eyedropMode=false; $('eyedrop').textContent="Eyedrop"; return;
  }

  if(store.areaMode){ startMarquee(pxX,pxY); return; }

  store.lastClickPt={x:xPt,y:yPt};
  setStat(`Placement set at (${xPt}, ${yPt}).`,"ok");
});

// Apply → server
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
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='Edited.pdf'; a.click();
    setStat("Done ✓ File downloaded.","ok");
  }catch(e){ setStat("Error: "+(e?.message||e),"err"); }
};

// quick colors
$('quickRed').onclick=()=>{$('color').value='#c62828';updateSelectedFromSidebar();};
$('quickBlue').onclick=()=>{$('color').value='#1565c0';updateSelectedFromSidebar();};
$('quickBody').onclick=()=>{$('color').value='#000000';updateSelectedFromSidebar();};
