import { $, state, setQueued } from './pdf-engine.js';

export const store = { items: [], groups: [] };
window.store = store; // for setQueued()

let selectedId = null;
const isGroup = id => typeof id==='string' && id.startsWith('g:');

export function getSelectedId(){ return selectedId; }
export function setSelected(id){
  selectedId=id;
  if(isGroup(id)) $('text').value="";
  redraw();
}

export function getSelectedItem(){
  if(isGroup(selectedId)) return null;
  return store.items.find(x=>x.id===selectedId) || null;
}

export function redraw(){
  const ov=$('overlay'); ov.innerHTML="";
  drawGroups(ov);
  drawItems(ov);
  setQueued();
}

function drawItems(ov){
  const pageItems=store.items.filter(it=>it.page===state.pageNum);
  pageItems.forEach(it=>{
    const div=document.createElement('div');
    div.className='block';
    div.dataset.id=it.id;
    if(!isGroup(selectedId) && it.id===selectedId) div.classList.add('selected');

    const close=document.createElement('div'); close.className='close' + ((selectedId===it.id)?'':' hidden'); close.textContent='×';
    close.title='Delete'; close.onclick=(ev)=>{ev.stopPropagation(); delItem(it.id);};
    div.appendChild(close);

    const handle=document.createElement('div'); handle.className='handle'; div.appendChild(handle);

    // layout
    div.style.left=(it.x/state.ptPerPx)+'px';
    if(it.type==='text'){
      div.style.top=(it.y/state.ptPerPx)+'px';
      div.style.width=(it.width/state.ptPerPx)+'px';
      div.style.fontFamily=it.font;
      div.style.fontSize=(it.size/state.ptPerPx)+'px';
      div.style.color=it.colorHex;
      div.style.lineHeight=( (it.lineHeight||Math.round(it.size*1.35))/state.ptPerPx );
      div.textContent=it.text;
    }else{
      const pxH=Math.max(1, it.thick/state.ptPerPx);
      div.style.top=((it.y/state.ptPerPx)-(pxH/2))+'px';
      div.style.width=(it.width/state.ptPerPx)+'px';
      div.style.height=pxH+'px';
      div.style.background=it.colorHex;
      div.textContent='';
    }

    // select
    div.addEventListener('pointerdown',ev=>{
      ev.preventDefault();
      if(ev.target!==handle && ev.target!==close) setSelected(it.id);
    }, {passive:false});

    // drag (pointer delta -> points)
    div.addEventListener('pointerdown',ev=>{
      if(ev.target===handle || ev.target===close) return;
      ev.preventDefault();
      setSelected(it.id);
      div.classList.add('dragging');
      const startX=ev.clientX,startY=ev.clientY;
      let dx=0,dy=0,anim=false;
      const move=e=>{dx=e.clientX-startX;dy=e.clientY-startY;if(!anim){anim=true;requestAnimationFrame(()=>{div.style.transform=`translate3d(${dx}px,${dy}px,0)`;anim=false;});}};
      const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
        div.classList.remove('dragging');div.style.transform='translate3d(0,0,0)';
        const dptX=Math.round(dx*state.ptPerPx), dptY=Math.round(dy*state.ptPerPx);
        if(it.type==='text'){it.x+=dptX;it.y+=dptY;}
        else{it.x+=dptX;it.y+=dptY;}
        redraw();
      };
      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',up,{once:true});
    }, {passive:false});

    // resize width
    handle.addEventListener('pointerdown',ev=>{
      ev.stopPropagation(); ev.preventDefault();
      setSelected(it.id);
      const startX=ev.clientX,startW=parseFloat(div.style.width);
      const move=e=>{const dw=e.clientX-startX;div.style.width=Math.max(20,startW+dw)+'px';};
      const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
        it.width=Math.round(parseFloat(div.style.width)*state.ptPerPx); redraw();
      };
      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',up,{once:true});
    });

    ov.appendChild(div);
  });
  ov.style.pointerEvents='none'; Array.from(ov.children).forEach(c=>c.style.pointerEvents='auto');
}

function drawGroups(ov){
  const pageGroups=store.groups.filter(g=>g.page===state.pageNum);
  pageGroups.forEach(g=>{
    const div=document.createElement('div'); div.className='group'; div.dataset.id="g:"+g.id;
    if(isGroup(selectedId) && selectedId==="g:"+g.id) div.classList.add('selected');
    div.style.left=(g.x/state.ptPerPx)+'px'; div.style.top=(g.y/state.ptPerPx)+'px';
    div.style.width=(g.w/state.ptPerPx)+'px'; div.style.height=(g.h/state.ptPerPx)+'px';

    const close=document.createElement('div'); close.className='g-close'; close.textContent='×';
    close.title='Remove group frame (keeps contents)'; close.onclick=(ev)=>{ev.stopPropagation(); store.groups=store.groups.filter(x=>x.id!==g.id); if(selectedId==="g:"+g.id)selectedId=null; redraw(); setQueued();};
    div.appendChild(close);
    ['tl','tr','bl','br'].forEach(pos=>{const h=document.createElement('div'); h.className='g-handle '+pos; div.appendChild(h);});

    // drag (pointer delta -> points)
    div.addEventListener('pointerdown',ev=>{
      if(ev.target.classList.contains('g-handle')||ev.target===close) return;
      ev.preventDefault(); setSelected("g:"+g.id);
      const startX=ev.clientX,startY=ev.clientY;
      let dx=0,dy=0,anim=false;
      const move=e=>{dx=e.clientX-startX;dy=e.clientY-startY;if(!anim){anim=true;requestAnimationFrame(()=>{div.style.transform=`translate3d(${dx}px,${dy}px,0)`;anim=false;});}};
      const up=()=>{document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);
        div.style.transform='translate3d(0,0,0)';
        const dptX=Math.round(dx*state.ptPerPx), dptY=Math.round(dy*state.ptPerPx);
        g.x+=dptX; g.y+=dptY;
        g.children.forEach(ch=>{const it=store.items.find(i=>i.id===ch.refId); if(it){it.x+=dptX; it.y+=dptY;}});
        redraw();
      };
      document.addEventListener('pointermove',move,{passive:false});
      document.addEventListener('pointerup',up,{once:true});
    }, {passive:false});

    // resize/scale
    div.querySelectorAll('.g-handle').forEach(h=>{
      h.addEventListener('pointerdown',ev=>{
        ev.stopPropagation(); ev.preventDefault(); setSelected("g:"+g.id);
        const rect=div.getBoundingClientRect();
        const startX=ev.clientX,startY=ev.clientY;
        const startW=rect.width,startH=rect.height;
        const startGX=g.x,startGY=g.y,startGW=g.w,startGH=g.h;
        const corner=h.classList.contains('tl')?'tl':h.classList.contains('tr')?'tr':h.classList.contains('bl')?'bl':'br';
        const move=e=>{
          const dx=e.clientX-startX,dy=e.clientY-startY;
          let newW=startW,newH=startH,newX=rect.left,newY=rect.top;
          if(corner==='br'){newW=Math.max(20,startW+dx);newH=Math.max(20,startH+dy);}
          if(corner==='tr'){newW=Math.max(20,startW+dx);newH=Math.max(20,startH-dy);newY=rect.top+dy;}
          if(corner==='bl'){newW=Math.max(20,startW-dx);newH=Math.max(20,startH+dy);newX=rect.left+dx;}
          if(corner==='tl'){newW=Math.max(20,startW-dx);newH=Math.max(20,startH-dy);newX=rect.left+dx;newY=rect.top+dy;}
          div.style.left=newX+'px'; div.style.top=newY+'px'; div.style.width=newW+'px'; div.style.height=newH+'px';
        };
        const up=()=>{
          document.removeEventListener('pointermove',move); document.removeEventListener('pointerup',up);
          const rect2=div.getBoundingClientRect();
          const sX=Math.max(0.1, rect2.width/startW), sY=Math.max(0.1, rect2.height/startH);
          const newGX=Math.round(rect2.left*state.ptPerPx), newGY=Math.round(rect2.top*state.ptPerPx);
          const dGX=newGX-startGX, dGY=newGY-startGY;
          const cx=startGX+startGW/2, cy=startGY+startGH/2;

          g.x=newGX; g.y=newGY; g.w=Math.round(startGW*sX); g.h=Math.round(startGH*sY);
          g.children.forEach(ch=>{
            const it=store.items.find(i=>i.id===ch.refId); if(!it) return;
            const relX=it.x-cx, relY=it.y-cy;
            it.x=Math.round(cx+relX*sX+dGX);
            it.y=Math.round(cy+relY*sY+dGY);
            if(it.type==='text'){
              it.width=Math.round(it.width*sX);
              it.size=Math.max(5,Math.round(it.size*((sX+sY)/2)));
              it.lineHeight=Math.max(6,Math.round((it.lineHeight||Math.round(it.size*1.35))*((sX+sY)/2)));
              it.tracking=(it.tracking||0)*((sX+sY)/2);
            }else{
              it.width=Math.round(it.width*sX);
              it.thick=Math.max(0.5,(it.thick||1)*((sX+sY)/2));
            }
          });
          redraw();
        };
        document.addEventListener('pointermove',move,{passive:false});
        document.addEventListener('pointerup',up,{once:true});
      }, {passive:false});
    });

    ov.appendChild(div);
  });
  ov.style.pointerEvents='none'; Array.from(ov.children).forEach(c=>c.style.pointerEvents='auto');
}

function delItem(id){
  store.items = store.items.filter(x=>x.id!==id);
  store.groups.forEach(g=>g.children=g.children.filter(ch=>ch.refId!==id));
  if(selectedId===id) selectedId=null;
  redraw(); setQueued();
}

// keyboard delete
window.addEventListener('keydown',(e)=>{
  if(!selectedId) return;
  if(e.key==='Delete'||e.key==='Backspace'){
    if(isGroup(selectedId)){const gid=selectedId.slice(2); store.groups=store.groups.filter(g=>g.id!==gid);}
    else{delItem(selectedId);}
    selectedId=null; redraw(); setQueued(); e.preventDefault();
  }
});
