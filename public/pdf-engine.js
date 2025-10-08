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

  // Attempt to read color if present (pdf.js paints don't always expose it; we
  // sample canvas later as a fallback)
  const items = tc.items.map(it=>{
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
  return items;
}

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

// robust color sampler: darkest quartile median
export function sampleColorMedianAtPx(pxX,pxY){
  const cv=$('cv');
  const ctx=cv.getContext('2d',{ willReadFrequently:true });
  const toHex=v=>Math.round(v).toString(16).padStart(2,'0');

  const rad=5;
  const x0=Math.max(0,Math.round(pxX)-rad);
  const y0=Math.max(0,Math.round(pxY)-rad);
  const w=Math.min(rad*2+1,cv.width-x0);
  const h=Math.min(rad*2+1,cv.height-y0);
  if(w<=0||h<=0) return '#000000';

  const d=ctx.getImageData(x0,y0,w,h).data;
  const arr=[];
  for(let i=0;i<d.length;i+=4){
    const r=d[i],g=d[i+1],b=d[i+2];
    const lum=0.2126*r+0.7152*g+0.0722*b;
    arr.push({lum,r,g,b});
  }
  arr.sort((a,b)=>a.lum-b.lum);
  const keep=Math.max(1,Math.floor(arr.length*0.25));
  const Rs=[],Gs=[],Bs=[];
  for(let i=0;i<keep;i++){ Rs.push(arr[i].r); Gs.push(arr[i].g); Bs.push(arr[i].b); }
  Rs.sort((a,b)=>a-b); Gs.sort((a,b)=>a-b); Bs.sort((a,b)=>a-b);
  const m=Math.floor(keep/2);
  return '#'+toHex(Rs[m])+toHex(Gs[m])+toHex(Bs[m]);
}
