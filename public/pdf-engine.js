// pdf-engine.js
export const $ = id => document.getElementById(id);

export const state = {
  pdfDoc: null,
  pageNum: 1,
  pageCount: 1,
  scale: 1.10,
  ptPerPx: 1,
  pageHeightPts: 0,
  fileB64: null,
};

export function setStat(t, cls=""){ const el=$('stat'); el.textContent=t; el.className="status "+cls; }
export function setMeta(){ $('meta').textContent=`Page ${state.pageNum} | scale ${state.scale.toFixed(2)}`; }

export async function fileToBase64(file){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>{const s=String(fr.result||""); resolve(s.includes(",")?s.split(",")[1]:s);};
    fr.onerror=reject;
    fr.readAsDataURL(file);
  });
}

export async function loadPdfFromFile(file){
  state.fileB64 = await fileToBase64(file);
  const buf = await file.arrayBuffer();
  state.pdfDoc = await window["pdfjs-dist/build/pdf"].getDocument({data:buf}).promise;
  state.pageCount = state.pdfDoc.numPages;
  state.pageNum = 1;
}

export async function renderPage(){
  const page = await state.pdfDoc.getPage(state.pageNum);
  const viewport = page.getViewport({ scale: state.scale });
  const baseViewport = page.getViewport({ scale: 1 });

  const cv = $('cv'), ctx = cv.getContext('2d');
  cv.width = viewport.width; cv.height = viewport.height;

  state.ptPerPx = baseViewport.width / viewport.width;
  state.pageHeightPts = baseViewport.height;

  await page.render({ canvasContext: ctx, viewport }).promise;
  $('pageWrap').style.display = '';
  setMeta();

  cv.onpointermove = (e)=>{
    const r=cv.getBoundingClientRect();
    const x=Math.round((e.clientX-r.left)*state.ptPerPx);
    const y=Math.round((e.clientY-r.top)*state.ptPerPx);
    $('coords').textContent=`x: ${x}  y: ${y}`;
  };
}

// --- text extraction in TOP-LEFT coords
export async function getPageTextItems(){
  const page = await state.pdfDoc.getPage(state.pageNum);
  const tc = await page.getTextContent();

  // items are individual glyph-runs from pdf.js — keep geometry
  return tc.items.map(it=>{
    const a=it.transform[0], d=it.transform[3], ex=it.transform[4], ey=it.transform[5];
    const size=Math.max(Math.abs(a),Math.abs(d));
    const x=ex, yTop = state.pageHeightPts - ey - size;
    const w=it.width, h=size*1.2;
    return {
      str: it.str,
      x, y: yTop, w, h,
      size,
      fontName: it.fontName || '',
    };
  });
}

// ---- style helpers
export function guessFontFromName(name){
  const fname=(name||'').toString();
  const isHelv=/helv/i.test(fname),isCour=/cour/i.test(fname);
  const isTimes=/times|newroman|tnr|minion|garamond|serif/i.test(fname)||(!isHelv&&!isCour);
  const isBold=/bold|bd|semibold|demi|medium/i.test(fname);
  const isItal=/ital|oblique|it|obl/i.test(fname);
  if(isHelv) return isBold&&isItal?'Helvetica-BoldOblique':isBold?'Helvetica-Bold':isItal?'Helvetica-Oblique':'Helvetica';
  if(isCour) return isBold&&isItal?'Courier-BoldOblique':isBold?'Courier-Bold':isItal?'Courier-Oblique':'Courier';
  return isBold&&isItal?'Times-BoldItalic':isBold?'Times-Bold':isItal?'Times-Italic':'Times-Roman';
}

// ----- robust color sampling
// sample several probes across a rectangle, bias to darker pixels (to avoid highlights/AA)
export function sampleColorForRect(pxLeft, pxTop, pxWidth, pxHeight){
  const cv=$('cv');
  const ctx=cv.getContext('2d',{ willReadFrequently:true });
  const toHex=v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0');

  const probes=[];
  const cols=5, rows=3;
  const xStep = Math.max(1, Math.floor(pxWidth/(cols+1)));
  const yStep = Math.max(1, Math.floor(pxHeight/(rows+1)));
  for(let r=1;r<=rows;r++){
    for(let c=1;c<=cols;c++){
      const px = Math.floor(pxLeft + c*xStep);
      const py = Math.floor(pxTop  + r*yStep);
      const rad = 3;
      const x0=Math.max(0,px-rad), y0=Math.max(0,py-rad);
      const w=Math.min(rad*2+1,cv.width-x0), h=Math.min(rad*2+1,cv.height-y0);
      if(w<=0||h<=0) continue;
      const d=ctx.getImageData(x0,y0,w,h).data;
      // choose darkest pixel in the patch
      let best={lum:1e9,r:0,g:0,b:0};
      for(let i=0;i<d.length;i+=4){
        const r_=d[i],g_=d[i+1],b_=d[i+2];
        const lum=0.2126*r_+0.7152*g_+0.0722*b_;
        if(lum<best.lum){best={lum,r:r_,g:g_,b:b_};}
      }
      probes.push(best);
    }
  }
  if(!probes.length) return '#000000';
  // take median of the darkest half of probes
  probes.sort((a,b)=>a.lum-b.lum);
  const keep=probes.slice(0, Math.max(1, Math.floor(probes.length/2)));
  const Rs=keep.map(p=>p.r).sort((a,b)=>a-b);
  const Gs=keep.map(p=>p.g).sort((a,b)=>a-b);
  const Bs=keep.map(p=>p.b).sort((a,b)=>a-b);
  const m=i=>keep[Math.floor(keep.length/2)][i];
  const r=Rs[Math.floor(Rs.length/2)], g=Gs[Math.floor(Gs.length/2)], b=Bs[Math.floor(Bs.length/2)];
  return '#'+toHex(r)+toHex(g)+toHex(b);
}

// convenience: sample color roughly at a point (old behavior)
export function sampleColorMedianAtPx(pxX,pxY){
  return sampleColorForRect(pxX-4, pxY-4, 9, 9);
}
