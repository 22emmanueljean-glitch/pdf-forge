/* public/clone.js
 * Precise area clone with style preservation.
 * Relies on globals provided by editor: pdfDoc, pageNum, ptPerPx, pageHeightPts, items, groups, redraw, setQueued, setStat, $
 */

// ---------- small utils ----------
const med = a => { const s=a.slice().sort((x,y)=>x-y); return s.length?s[Math.floor(s.length/2)]:0; };
const clamp = (v,min,max)=> Math.max(min, Math.min(max, v));
const uuid = () => (crypto?.randomUUID?.() || (Date.now().toString(36)+'-'+Math.random().toString(36).slice(2)));

function mapFontName(name=""){
  const n=String(name);
  const helv=/helv/i.test(n), cour=/cour/i.test(n);
  const bold=/bold|semi|demi|medium/i.test(n);
  const ital=/ital|obli|obl/i.test(n);
  const base = helv ? "Helvetica" : cour ? "Courier" : "Times";
  let mapped = base==="Times" ? "Times-Roman" : base;
  if(bold && ital) mapped = base + (base==="Times" ? "-BoldItalic" : "-BoldOblique");
  else if(bold)     mapped = base + (base==="Times" ? "-Bold"       : "-Bold");
  else if(ital)     mapped = base + (base==="Times" ? "-Italic"     : "-Oblique");
  return { mapped, fauxBold: bold ? 1 : 0, skewDeg: ital ? 12 : 0 };
}

// pixel-sample median (ignores very bright pixels to avoid paper bleed)
function sampleColorMedianAtPx(pxX, pxY){
  const cv = $('cv'); if(!cv) return '#000000';
  const ctx = cv.getContext('2d');
  const toHex=v=>Math.round(v).toString(16).padStart(2,'0');
  let radius=3;
  while(radius<=10){
    const x0=clamp(Math.round(pxX)-radius, 0, cv.width-1);
    const y0=clamp(Math.round(pxY)-radius, 0, cv.height-1);
    const w=clamp(radius*2+1, 1, cv.width-x0);
    const h=clamp(radius*2+1, 1, cv.height-y0);
    const d=ctx.getImageData(x0,y0,w,h).data;
    const Rs=[],Gs=[],Bs=[];
    for(let i=0;i<d.length;i+=4){
      const r=d[i],g=d[i+1],b=d[i+2];
      const lum=0.2126*r+0.7152*g+0.0722*b;
      if(lum>235) continue;
      Rs.push(r); Gs.push(g); Bs.push(b);
    }
    if(Rs.length){
      return '#'+toHex(med(Rs))+toHex(med(Gs))+toHex(med(Bs));
    }
    radius+=2;
  }
  return '#000000';
}

// ---------- pdf.js helpers ----------
async function getPageTextSpans(){
  const page = await pdfDoc.getPage(pageNum);
  const tc = await page.getTextContent();
  // Convert to TOP-LEFT coordinates
  return tc.items.map(it=>{
    const a=it.transform[0], d=it.transform[3], ex=it.transform[4], ey=it.transform[5];
    const size = Math.max(Math.abs(a), Math.abs(d));
    const x = ex;
    const yTop = pageHeightPts - ey - size; // top-left
    const w = it.width;
    const h = size*1.2; // approx box height for the span line box
    return { str: it.str, x, y: yTop, w, h, size, fontName: it.fontName };
  });
}

// group spans into lines by baseline; keep span segmentation intact
function buildLinesKeepSegments(spans){
  const ss = spans.slice().sort((A,B)=> (A.y - B.y) || (A.x - B.x));
  const medSize = med(ss.map(s=>s.size));
  const vTol = Math.max(0.5*medSize, 2.5);

  const lines=[];
  for(const s of ss){
    const lineH = s.h || s.size*1.2;
    const baseline = s.y + lineH*0.85;
    let ln=null, best=1e9;
    for(const L of lines){
      const d=Math.abs(L.baseline-baseline);
      if(d<=vTol && d<best){best=d; ln=L;}
    }
    if(!ln){
      ln={ baseline, segs:[], xMin:Infinity, xMax:-Infinity, top:Infinity, bottom:-Infinity, size:s.size };
      lines.push(ln);
    }
    ln.segs.push({ ...s });
    ln.xMin = Math.min(ln.xMin, s.x);
    ln.xMax = Math.max(ln.xMax, s.x + s.w);
    ln.top = Math.min(ln.top, s.y);
    ln.bottom = Math.max(ln.bottom, s.y + (s.h||s.size*1.2));
    ln.size = Math.max(ln.size, s.size);
  }
  lines.forEach(L=> L.segs.sort((a,b)=>a.x-b.x));
  return lines;
}

// clip spans to selection (keep only spans that materially intersect vertically & horizontally)
function clipLineToSelection(line, sel){
  const kept = [];
  const sx1 = sel.x, sy1 = sel.y, sx2 = sel.x + sel.w, sy2 = sel.y + sel.h;

  for(const s of line.segs){
    const ix1=s.x, iy1=s.y, ix2=s.x+s.w, iy2=s.y+s.h;
    const ovW = Math.min(ix2,sx2) - Math.max(ix1,sx1);
    const ovH = Math.min(iy2,sy2) - Math.max(iy1,sy1);
    if(ovW>0 && ovH>0){
      // keep the whole span (accurate per-glyph clipping is not exposed by pdf.js)
      kept.push(s);
    }
  }
  if(!kept.length) return null;

  // line frame reduced to kept spans
  const xMin = Math.min(...kept.map(s=>s.x));
  const xMax = Math.max(...kept.map(s=>s.x+s.w));
  const top   = Math.min(...kept.map(s=>s.y));
  const bottom= Math.max(...kept.map(s=>s.y+s.h));
  return { baseline: line.baseline, segs: kept, xMin, xMax, top, bottom, size: line.size };
}

// build blocks by coalescing adjacent lines that share font family/weight/slant & similar size
function buildBlocksFromClippedLines(lines, colorAtPx){
  const blocks=[];
  let cur=null;

  const lineGapOf = (A,B)=> (B.top - A.top); // top-based distance (we drew with top-left coords)

  for(const L of lines){
    // Detect dominant font name on the line
    const fontCounts = new Map();
    let size = 0;
    for(const s of L.segs){
      fontCounts.set(s.fontName, (fontCounts.get(s.fontName)||0) + s.str.length);
      size = Math.max(size, s.size);
    }
    const [fontName] = [...fontCounts.entries()].sort((a,b)=>b[1]-a[1])[0] || ['Times-Roman'];
    const mapped = mapFontName(fontName);

    // sample color at the visual middle of the line in px
    const px = {
      x: ((L.xMin + L.xMax)/2) / ptPerPx,
      y: ((L.top + L.bottom)/2) / ptPerPx
    };
    const colorHex = colorAtPx(px.x, px.y);

    if(!cur){
      cur = {
        lines:[L],
        font: mapped.mapped,
        rawFont: fontName,
        fauxBold: mapped.fauxBold,
        skewDeg: mapped.skewDeg,
        size: Math.round(size),
        colorHex,
        xMin: L.xMin, xMax: L.xMax,
        top: L.top, bottom: L.bottom,
      };
      blocks.push(cur);
      continue;
    }

    // can merge with current?
    const sizeClose = Math.abs(cur.size - size) <= Math.max(0.6, cur.size*0.05);
    const sameFont  = cur.font === mapped.mapped;
    const gap = lineGapOf(cur.lines[cur.lines.length-1], L);
    const expectedGap = Math.max( cur.size*1.2, 12 );
    const gapOK = gap <= expectedGap*1.6; // tolerate a bit

    if(sizeClose && sameFont && gapOK){
      cur.lines.push(L);
      cur.size = Math.max(cur.size, Math.round(size));
      cur.xMin = Math.min(cur.xMin, L.xMin);
      cur.xMax = Math.max(cur.xMax, L.xMax);
      cur.top  = Math.min(cur.top,  L.top);
      cur.bottom = Math.max(cur.bottom, L.bottom);
    }else{
      // start a new block
      cur = {
        lines:[L],
        font: mapped.mapped,
        rawFont: fontName,
        fauxBold: mapped.fauxBold,
        skewDeg: mapped.skewDeg,
        size: Math.round(size),
        colorHex,
        xMin: L.xMin, xMax: L.xMax,
        top: L.top, bottom: L.bottom,
      };
      blocks.push(cur);
    }
  }

  // compute per-block lineHeight (median inter-line distance) and text
  for(const b of blocks){
    const gaps=[];
    for(let i=1;i<b.lines.length;i++){
      const A=b.lines[i-1], B=b.lines[i];
      gaps.push(B.top - A.top); // top distances (top-left system)
    }
    const fallback = Math.round(b.size*1.35);
    b.lineHeight = gaps.length ? Math.round( med(gaps) ) : fallback;
    b.width = Math.max(16, Math.round(b.xMax - b.xMin));
    b.text = b.lines.map(L => L.segs.map(s => s.str).join('')).join('\n');
  }
  return blocks;
}

// ---------- main entry ----------
async function cloneFromArea(selPt, selPx){
  try{
    // 1) read all spans
    const allSpans = await getPageTextSpans();

    // 2) keep spans that intersect selection at all
    const sx1=selPt.x, sy1=selPt.y, sx2=selPt.x+selPt.w, sy2=selPt.y+selPt.h;
    const hits = allSpans.filter(s=>{
      const ix1=s.x, iy1=s.y, ix2=s.x+s.w, iy2=s.y+s.h;
      return !(ix2<sx1 || ix1>sx2 || iy2<sy1 || iy1>sy2);
    });
    if(!hits.length){ setStat("No text found in selection.","err"); return; }

    // 3) lines → clip to selection
    const linesAll = buildLinesKeepSegments(hits);
    const clipped = linesAll
      .map(L => clipLineToSelection(L, selPt))
      .filter(Boolean);

    if(!clipped.length){ setStat("No text after clipping.","err"); return; }

    // 4) build blocks & styles
    const blocks = buildBlocksFromClippedLines(clipped, sampleColorMedianAtPx);

    if(!blocks.length){ setStat("No blocks created.","err"); return; }

    // 5) create items
    const newIds=[];
    for(const b of blocks){
      const id = uuid();
      items.push({
        id,
        type:'text',
        page: pageNum,
        x: Math.round(b.xMin),
        y: Math.round(b.lines[0].top),
        width: b.width,
        text: b.text,
        font: b.font,
        size: b.size,
        colorHex: b.colorHex || '#000000',
        lineHeight: b.lineHeight,
        fauxBold: b.fauxBold||0,
        skewDeg: b.skewDeg||0,
        tracking: 0
      });
      newIds.push(id);
    }

    // 6) single group around all new items
    const rects = newIds.map(id=>{
      const it = items.find(i=>i.id===id);
      const lineCount = (it.text.match(/\n/g)||[]).length + 1;
      const h = Math.max(it.lineHeight, Math.round(it.size*1.35)) * lineCount;
      return { x:it.x, y:it.y, w:it.width, h };
    });
    const gx = Math.min(...rects.map(r=>r.x));
    const gy = Math.min(...rects.map(r=>r.y));
    const gxe= Math.max(...rects.map(r=>r.x+r.w));
    const gye= Math.max(...rects.map(r=>r.y+r.h));
    const gid = uuid();
    groups.push({
      id: gid,
      page: pageNum,
      x: gx, y: gy, w: gxe-gx, h: gye-gy,
      children: newIds.map(id=>({refId:id}))
    });

    setStat(`Cloned ${newIds.length} block(s).`, "ok");
    // select the new group (editor already has setSelected)
    if(typeof setSelected === 'function') setSelected('g:'+gid);
    redraw(); setQueued();
  }catch(err){
    console.error(err);
    setStat("Clone error: "+(err?.message||err), "err");
  }
}

// expose to the existing app
window.cloneFromArea = cloneFromArea;
// ---------- end ----------
