import { pickColor, genId } from './utils.js';

export function initEditor(overlay, page, viewport) {
  const ptPerPx = page.getViewport({ scale:1 }).width / viewport.width;
  let boxes = [];

  overlay.style.pointerEvents = 'auto';
  overlay.addEventListener('dblclick', e => {
    const x = e.offsetX * ptPerPx;
    const y = e.offsetY * ptPerPx;
    const div = document.createElement('div');
    div.contentEditable = true;
    div.className = 'block';
    div.style.cssText = `
      position:absolute;left:${x/ptPerPx}px;top:${y/ptPerPx}px;
      font-size:11px;color:#000;border:1px dashed #7aa2ff;padding:2px;
    `;
    overlay.appendChild(div);
    boxes.push({id:genId(),x,y,page:1,text:'',color:'#000',font:'Times-Roman',size:11});
    div.onblur = ()=>boxes.find(b=>b.id===div.dataset.id).text=div.textContent;
  });
}
