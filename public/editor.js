/* public/editor.js
 * App shell: viewer + overlay editor + area selection.
 * Requires:
 *  - pdf.js initialized on window.pdfjsLib (see HTML order above)
 *  - /api/edit endpoint (pdf-lib renderer)
 *  - CSS classes from your page (block, group, marquee, etc.)
 */

/* ---------- PDF.js bootstrap (safety) ---------- */
const pdfjsLib = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
if (!pdfjsLib || !pdfjsLib.GlobalWorkerOptions) {
  console.error('pdfjsLib not initialized. Ensure the script tags order in HTML.');
}

/* ---------- DOM helpers ---------- */
const $ = (id) => document.getElementById(id);
const API_EDIT = "/api/edit";

const setStat = (t, cls = "") => { const el = $('stat'); if (el) { el.textContent = t; el.className = "status " + cls; } };
const setMeta = () => { const el = $('meta'); if (el) el.textContent = `Page ${pageNum} | scale ${scale.toFixed(2)}`; };
const setQueued = () => { const el = $('queued'); if (el) el.textContent = items.length + " items queued"; };

/* ---------- State (also exposed to clone.js) ---------- */
let pdfDoc = null, pageNum = 1, pageCount = 1, scale = 1.10, ptPerPx = 1, pageHeightPts = 0;
let fileB64 = null, lastClickPt = null;
let items = [], groups = [], selectedId = null, areaMode = false, eyedropMode = false;

// Expose for clone.js
Object.assign(window, { pdfDoc, pageNum, ptPerPx, pageHeightPts, items, groups });

/* Keep window globals in sync when pageNum/ptPerPx/pageHeightPts change */
function syncGlobals() {
  window.pageNum = pageNum;
  window.ptPerPx = ptPerPx;
  window.pageHeightPts = pageHeightPts;
  window.items = items;
  window.groups = groups;
}

/* ---------- Utilities ---------- */
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      const s = String(fr.result || "");
      resolve(s.includes(",") ? s.split(",")[1] : s);
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}
function hexToRgb01(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255];
}
function guessFontFromName(name) {
  const fname = (name || '').toString();
  const isHelv = /helv/i.test(fname), isCour = /cour/i.test(fname);
  const isBold = /bold|bd|semibold|demi|medium/i.test(fname);
  const isItal = /ital|oblique|it|obl/i.test(fname);
  if (isHelv) return isBold && isItal ? 'Helvetica-BoldOblique' : isBold ? 'Helvetica-Bold' : isItal ? 'Helvetica-Oblique' : 'Helvetica';
  if (isCour) return isBold && isItal ? 'Courier-BoldOblique' : isBold ? 'Courier-Bold' : isItal ? 'Courier-Oblique' : 'Courier';
  return isBold && isItal ? 'Times-BoldItalic' : isBold ? 'Times-Bold' : isItal ? 'Times-Italic' : 'Times-Roman';
}

/* color sampler used by eyedrop (clone.js has its own sampler) */
function sampleColorMedianAtPx(pxX, pxY) {
  const cv = $('cv'), ctx = cv.getContext('2d');
  let radius = 3, best = '#000000';
  const toHex = v => Math.round(v).toString(16).padStart(2, '0');
  const med = a => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  while (radius <= 10) {
    const x0 = Math.max(0, Math.round(pxX) - radius), y0 = Math.max(0, Math.round(pxY) - radius);
    const w = Math.min(radius * 2 + 1, cv.width - x0), h = Math.min(radius * 2 + 1, cv.height - y0);
    const d = ctx.getImageData(x0, y0, w, h).data; const Rs = [], Gs = [], Bs = [];
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b; if (lum > 235) continue;
      Rs.push(r); Gs.push(g); Bs.push(b);
    }
    if (Rs.length) { best = '#' + toHex(med(Rs)) + toHex(med(Gs)) + toHex(med(Bs)); break; }
    radius += 2;
  }
  return best;
}

/* ---------- PDF render ---------- */
async function renderPage() {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const baseViewport = page.getViewport({ scale: 1 });

  const cv = $('cv'), ctx = cv.getContext('2d');
  cv.width = viewport.width; cv.height = viewport.height;
  ptPerPx = baseViewport.width / viewport.width;
  pageHeightPts = baseViewport.height;

  await page.render({ canvasContext: ctx, viewport }).promise;

  $('pageWrap').style.display = '';
  setMeta();
  syncGlobals();

  cv.onpointermove = (e) => {
    const r = cv.getBoundingClientRect();
    const x = Math.round((e.clientX - r.left) * ptPerPx);
    const y = Math.round((e.clientY - r.top) * ptPerPx);
    $('coords').textContent = `x: ${x}  y: ${y}`;
  };
}

/* ---------- UI hookups ---------- */
(function wireUI() {
  const loadBtn = $('load');
  if (loadBtn) {
    loadBtn.onclick = async () => {
      try {
        const f = $('file').files[0]; if (!f) { setStat("Choose a PDF."); return; }
        fileB64 = await fileToBase64(f);
        const buf = await f.arrayBuffer();
        pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
        pageCount = pdfDoc.numPages; pageNum = 1; syncGlobals();

        $('tools').style.display = '';
        const sel = $('pageSelect'); sel.innerHTML = "";
        for (let i = 1; i <= pageCount; i++) { const o = document.createElement('option'); o.value = String(i); o.textContent = String(i); sel.appendChild(o); }
        sel.value = "1";

        await renderPage();
        redraw();
        setStat(`Loaded ${pageCount} page(s).`, "ok");
      } catch (e) {
        console.error(e);
        setStat("Error: " + (e?.message || e), "err");
      }
    };
  }

  $('reset').onclick = () => {
    pdfDoc = null; fileB64 = null; items = []; groups = []; selectedId = null; $('tools').style.display = 'none';
    const cv = $('cv'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
    $('overlay').innerHTML = ""; $('pageWrap').style.display = 'none';
    setQueued(); setStat("Cleared.");
  };

  $('prev').onclick = async () => { if (!pdfDoc) return; pageNum = Math.max(1, pageNum - 1); $('pageSelect').value = String(pageNum); await renderPage(); redraw(); };
  $('next').onclick = async () => { if (!pdfDoc) return; pageNum = Math.min(pageCount, pageNum + 1); $('pageSelect').value = String(pageNum); await renderPage(); redraw(); };
  $('zoom').oninput = async e => { if (!pdfDoc) return; scale = Number(e.target.value) / 100; await renderPage(); redraw(); };
  $('pageSelect').onchange = async e => { pageNum = Number(e.target.value) || 1; await renderPage(); redraw(); };

  $('toggleGuides').onchange = (e) => { if (e.target.checked) document.body.classList.remove('noguides'); else document.body.classList.add('noguides'); };

  $('eyedrop').onclick = () => {
    eyedropMode = !eyedropMode; areaMode = false;
    $('eyedrop').textContent = eyedropMode ? "Eyedrop (ON)" : "Eyedrop";
    $('areaClone').textContent = "Select Area (Clone)";
    setStat(eyedropMode ? "Click near text to pick style." : "Eyedrop off.", "ok");
  };
  $('areaClone').onclick = () => {
    areaMode = !areaMode; eyedropMode = false;
    $('areaClone').textContent = areaMode ? "Select Area (ON)" : "Select Area (Clone)";
    $('eyedrop').textContent = "Eyedrop";
    setStat(areaMode ? "Drag a rectangle to clone just that area." : "Area clone off.", "ok");
  };
  $('ungroup').onclick = () => {
    if (!isGroup(selectedId)) { setStat("Select a section (group) first.", "err"); return; }
    const gid = selectedId.slice(2);
    groups = groups.filter(g => g.id !== gid); selectedId = null; redraw(); setQueued(); setStat("Ungrouped.", "ok");
  };

  // text/line add buttons
  $('addText').onclick = () => {
    if (!fileB64) { setStat("Load a PDF first.", "err"); return; }
    if (!lastClickPt) { setStat("Click preview to position first.", "err"); return; }
    const pg = Number($('pageSelect').value) || pageNum;
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    items.push({
      id, type: 'text', page: pg, x: lastClickPt.x, y: lastClickPt.y,
      width: parseFloat($('width').value) || 460,
      text: $('text').value || "",
      font: $('font').value || "Times-Roman",
      size: parseFloat($('size').value) || 11,
      colorHex: $('color').value || "#000000",
      lineHeight: parseFloat($('lineHeight').value) || Math.round((parseFloat($('size').value) || 11) * 1.35),
      fauxBold: parseInt($('fauxBold').value) || 0,
      skewDeg: parseFloat($('skewDeg').value) || 0,
      tracking: parseFloat($('tracking').value) || 0
    });
    setSelected(id); redraw(); setQueued(); setStat("Text added.", "ok");
  };

  $('addLine').onclick = () => {
    if (!fileB64) { setStat("Load a PDF first.", "err"); return; }
    if (!lastClickPt) { setStat("Click preview to position first.", "err"); return; }
    const pg = Number($('pageSelect').value) || pageNum;
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
    items.push({ id, type: 'line', page: pg, x: lastClickPt.x, y: lastClickPt.y, width: parseFloat($('lineWidth').value) || 460, thick: parseFloat($('lineThick').value) || 2, colorHex: $('color').value || "#000000" });
    setSelected(id); redraw(); setQueued(); setStat("Line added.", "ok");
  };

  // quick color buttons
  $('quickRed').onclick = () => { $('color').value = '#c62828'; updateSelectedFromSidebar(); };
  $('quickBlue').onclick = () => { $('color').value = '#1565c0'; updateSelectedFromSidebar(); };
  $('quickBody').onclick = () => { $('color').value = '#000000'; updateSelectedFromSidebar(); };

  // generate
  $('apply').onclick = async () => {
    try {
      if (!fileB64) { setStat("Load a PDF first.", "err"); return; }
      if (items.length === 0) { setStat("No items queued.", "err"); return; }
      setStat("Generating…");
      const edits = items.map(it => {
        const [r, g, b] = hexToRgb01(it.colorHex || '#000000');
        if (it.type === 'text') {
          return {
            type: 'text', page: it.page, x: it.x, y: it.y, width: it.width, text: it.text,
            font: it.font, size: it.size, color: [r, g, b],
            lineHeight: it.lineHeight || Math.round(it.size * 1.35),
            fauxBold: it.fauxBold || 0, skewDeg: it.skewDeg || 0, tracking: it.tracking || 0
          };
        }
        return { type: 'line', page: it.page, x: it.x, y: it.y, width: it.width, thick: it.thick, color: [r, g, b] };
      });
      const r = await fetch(API_EDIT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: fileB64, edits }) });
      if (!r.ok) { const t = await r.text(); throw new Error(t || r.statusText); }
      const { pdf } = await r.json();
      const blob = new Blob([Uint8Array.from(atob(pdf), c => c.charCodeAt(0))], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'PDF_Forge_Output.pdf'; a.click();
      setStat("Done ✓ File downloaded.", "ok");
    } catch (e) { console.error(e); setStat("Error: " + e.message, "err"); }
  };
})();

/* ---------- Overlay drawing ---------- */
function isGroup(id) { return typeof id === 'string' && id.startsWith('g:'); }

function redraw() {
  const ov = $('overlay'); ov.innerHTML = "";
  drawGroups(ov);
  drawItems(ov);
  setQueued();
}

/* Items */
function drawItems(ov) {
  const pageItems = items.filter(it => it.page === pageNum);
  for (const it of pageItems) {
    const div = document.createElement('div');
    div.className = 'block';
    div.dataset.id = it.id;
    if (!isGroup(selectedId) && it.id === selectedId) div.classList.add('selected');

    // controls
    const close = document.createElement('div'); close.className = 'close' + ((selectedId === it.id) ? '' : ' hidden'); close.textContent = '×';
    close.title = 'Delete'; close.onclick = (ev) => { ev.stopPropagation(); items = items.filter(x => x.id !== it.id); groups.forEach(g => g.children = g.children.filter(ch => ch.refId !== it.id)); if (selectedId === it.id) selectedId = null; redraw(); setQueued(); };
    div.appendChild(close);

    const handle = document.createElement('div'); handle.className = 'handle'; div.appendChild(handle);

    // style position/sizing
    div.style.left = (it.x / ptPerPx) + 'px';
    if (it.type === 'text') {
      div.style.top = (it.y / ptPerPx) + 'px';
      div.style.width = (it.width / ptPerPx) + 'px';
      div.style.fontFamily = it.font;
      div.style.fontSize = (it.size / ptPerPx) + 'px';
      div.style.color = it.colorHex;
      div.style.lineHeight = ((it.lineHeight || Math.round(it.size * 1.35)) / ptPerPx);
      div.textContent = it.text;
    } else {
      const pxH = Math.max(1, it.thick / ptPerPx);
      div.style.top = ((it.y / ptPerPx) - (pxH / 2)) + 'px';
      div.style.width = (it.width / ptPerPx) + 'px';
      div.style.height = pxH + 'px';
      div.style.background = it.colorHex;
      div.textContent = '';
    }

    // selection
    div.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      if (ev.target !== handle && ev.target !== close) setSelected(it.id);
    });

    // drag (no transform jitter, we update left/top live)
    div.addEventListener('pointerdown', (ev) => {
      if (ev.target === handle || ev.target === close) return;
      ev.preventDefault(); div.setPointerCapture(ev.pointerId);
      setSelected(it.id);
      const startX = ev.clientX, startY = ev.clientY;
      const baseLeft = parseFloat(div.style.left), baseTop = parseFloat(div.style.top);
      const move = (e) => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        div.style.left = (baseLeft + dx) + 'px';
        div.style.top = (baseTop + dy) + 'px';
      };
      const up = (e) => {
        div.releasePointerCapture(ev.pointerId);
        div.removeEventListener('pointermove', move);
        div.removeEventListener('pointerup', up);
        const left = parseFloat(div.style.left), top = parseFloat(div.style.top);
        if (it.type === 'text') { it.x = Math.round(left * ptPerPx); it.y = Math.round(top * ptPerPx); }
        else {
          const pxH = Math.max(1, it.thick / ptPerPx);
          it.x = Math.round(left * ptPerPx);
          it.y = Math.round((top + pxH / 2) * ptPerPx);
        }
        redraw();
      };
      div.addEventListener('pointermove', move);
      div.addEventListener('pointerup', up, { once: true });
    });

    // resize width (right handle)
    handle.addEventListener('pointerdown', (ev) => {
      ev.stopPropagation(); ev.preventDefault();
      setSelected(it.id); handle.setPointerCapture(ev.pointerId);
      const startX = ev.clientX, startW = parseFloat(div.style.width);
      const move = (e) => { const dw = e.clientX - startX; div.style.width = Math.max(20, startW + dw) + 'px'; };
      const up = () => {
        handle.releasePointerCapture(ev.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        it.width = Math.round(parseFloat(div.style.width) * ptPerPx); redraw();
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up, { once: true });
    });

    ov.appendChild(div);
  }
  ov.style.pointerEvents = 'none'; Array.from(ov.children).forEach(c => c.style.pointerEvents = 'auto');
}

/* Groups */
function drawGroups(ov) {
  const pageGroups = groups.filter(g => g.page === pageNum);
  pageGroups.forEach(g => {
    const div = document.createElement('div'); div.className = 'group'; div.dataset.id = "g:" + g.id;
    if (isGroup(selectedId) && selectedId === "g:" + g.id) div.classList.add('selected');
    div.style.left = (g.x / ptPerPx) + 'px'; div.style.top = (g.y / ptPerPx) + 'px';
    div.style.width = (g.w / ptPerPx) + 'px'; div.style.height = (g.h / ptPerPx) + 'px';

    const close = document.createElement('div'); close.className = 'g-close'; close.textContent = '×';
    close.title = 'Remove group frame (keeps contents)'; close.onclick = (ev) => { ev.stopPropagation(); groups = groups.filter(x => x.id !== g.id); if (selectedId === "g:" + g.id) selectedId = null; redraw(); setQueued(); };
    div.appendChild(close);

    ['tl', 'tr', 'bl', 'br'].forEach(pos => { const h = document.createElement('div'); h.className = 'g-handle ' + pos; div.appendChild(h); });

    // drag group (move items with it)
    div.addEventListener('pointerdown', (ev) => {
      if (ev.target.classList.contains('g-handle') || ev.target === close) return;
      ev.preventDefault(); div.setPointerCapture(ev.pointerId); setSelected("g:" + g.id);
      const startX = ev.clientX, startY = ev.clientY;
      const baseLeft = parseFloat(div.style.left), baseTop = parseFloat(div.style.top);
      const move = (e) => {
        const dx = e.clientX - startX, dy = e.clientY - startY;
        div.style.left = (baseLeft + dx) + 'px'; div.style.top = (baseTop + dy) + 'px';
      };
      const up = () => {
        div.releasePointerCapture(ev.pointerId);
        div.removeEventListener('pointermove', move);
        div.removeEventListener('pointerup', up);
        const newLeft = parseFloat(div.style.left), newTop = parseFloat(div.style.top);
        const dptX = Math.round(newLeft * ptPerPx) - g.x, dptY = Math.round(newTop * ptPerPx) - g.y;
        g.x += dptX; g.y += dptY;
        g.children.forEach(ch => { const it = items.find(i => i.id === ch.refId); if (it) { it.x += dptX; it.y += dptY; } });
        redraw();
      };
      div.addEventListener('pointermove', move);
      div.addEventListener('pointerup', up, { once: true });
    });

    // resize/scale group
    div.querySelectorAll('.g-handle').forEach(h => {
      h.addEventListener('pointerdown', ev => {
        ev.stopPropagation(); ev.preventDefault(); setSelected("g:" + g.id); h.setPointerCapture(ev.pointerId);
        const rect = div.getBoundingClientRect();
        const startX = ev.clientX, startY = ev.clientY;
        const startW = rect.width, startH = rect.height;
        const startGX = g.x, startGY = g.y, startGW = g.w, startGH = g.h;
        const corner = h.classList.contains('tl') ? 'tl' : h.classList.contains('tr') ? 'tr' : h.classList.contains('bl') ? 'bl' : 'br';
        const move = e => {
          const dx = e.clientX - startX, dy = e.clientY - startY;
          let newW = startW, newH = startH, newX = rect.left, newY = rect.top;
          if (corner === 'br') { newW = Math.max(20, startW + dx); newH = Math.max(20, startH + dy); }
          if (corner === 'tr') { newW = Math.max(20, startW + dx); newH = Math.max(20, startH - dy); newY = rect.top + dy; }
          if (corner === 'bl') { newW = Math.max(20, startW - dx); newH = Math.max(20, startH + dy); newX = rect.left + dx; }
          if (corner === 'tl') { newW = Math.max(20, startW - dx); newH = Math.max(20, startH - dy); newX = rect.left + dx; newY = rect.top + dy; }
          div.style.left = newX + 'px'; div.style.top = newY + 'px'; div.style.width = newW + 'px'; div.style.height = newH + 'px';
        };
        const up = () => {
          h.releasePointerCapture(ev.pointerId);
          h.removeEventListener('pointermove', move);
          h.removeEventListener('pointerup', up);
          const rect2 = div.getBoundingClientRect(); const sX = rect2.width / startW, sY = rect2.height / startH;
          const newGX = Math.round(rect2.left * ptPerPx), newGY = Math.round(rect2.top * ptPerPx);
          const dGX = newGX - startGX, dGY = newGY - startGY;
          const centerX = startGX + startGW / 2, centerY = startGY + startGH / 2;
          g.x = newGX; g.y = newGY; g.w = Math.round(startGW * sX); g.h = Math.round(startGH * sY);
          g.children.forEach(ch => {
            const it = items.find(i => i.id === ch.refId); if (!it) return;
            const relX = it.x - centerX, relY = it.y - centerY;
            it.x = Math.round(centerX + relX * sX + dGX);
            it.y = Math.round(centerY + relY * sY + dGY);
            if (it.type === 'text') {
              it.width = Math.round(it.width * sX);
              it.size = Math.max(5, Math.round(it.size * ((sX + sY) / 2)));
              it.lineHeight = Math.max(6, Math.round((it.lineHeight || Math.round(it.size * 1.35)) * ((sX + sY) / 2)));
              it.tracking = (it.tracking || 0) * ((sX + sY) / 2);
            } else {
              it.width = Math.round(it.width * sX);
              it.thick = Math.max(0.5, (it.thick || 1) * ((sX + sY) / 2));
            }
          });
          redraw();
        };
        h.addEventListener('pointermove', move);
        h.addEventListener('pointerup', up, { once: true });
      });
    });

    ov.appendChild(div);
  });
  ov.style.pointerEvents = 'none'; Array.from(ov.children).forEach(c => c.style.pointerEvents = 'auto');
}

/* ---------- Selection + keyboard ---------- */
function setSelected(id) {
  selectedId = id;
  if (isGroup(id)) { $('text').value = ""; redraw(); return; }
  const it = items.find(x => x.id === id); if (!it) { $('text').value = ""; redraw(); return; }
  if (it.type === 'text') {
    $('text').value = it.text || ""; $('font').value = it.font || 'Times-Roman'; $('size').value = it.size || 11; $('color').value = it.colorHex || '#000000'; $('width').value = it.width || 460; $('lineHeight').value = it.lineHeight || Math.round((it.size || 11) * 1.35); $('fauxBold').value = it.fauxBold || 0; $('skewDeg').value = it.skewDeg || 0; $('tracking').value = it.tracking || 0;
  } else {
    $('text').value = ""; $('color').value = it.colorHex || '#000000'; $('lineWidth').value = it.width || 460; $('lineThick').value = it.thick || 2;
  }
  redraw();
}
function updateSelectedFromSidebar() {
  if (isGroup(selectedId)) return;
  const it = items.find(x => x.id === selectedId); if (!it) return;
  if (it.type === 'text') {
    it.text = $('text').value || ""; it.font = $('font').value || "Times-Roman"; it.size = parseFloat($('size').value) || 11; it.colorHex = $('color').value || "#000000"; it.width = parseFloat($('width').value) || 460; it.lineHeight = parseFloat($('lineHeight').value) || Math.round(it.size * 1.35); it.fauxBold = parseInt($('fauxBold').value) || 0; it.skewDeg = parseFloat($('skewDeg').value) || 0; it.tracking = parseFloat($('tracking').value) || 0;
  } else {
    it.colorHex = $('color').value || it.colorHex || "#000000"; it.width = parseFloat($('lineWidth').value) || it.width || 460; it.thick = parseFloat($('lineThick').value) || it.thick || 2;
  }
  redraw();
}
;['text', 'font', 'size', 'color', 'width', 'lineHeight', 'fauxBold', 'skewDeg', 'tracking', 'lineWidth', 'lineThick'].forEach(id => {
  const el = $(id); if (!el) return;
  el.addEventListener(id === 'text' ? 'input' : 'change', updateSelectedFromSidebar);
});

window.addEventListener('keydown', (e) => {
  if (!selectedId) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (isGroup(selectedId)) { const gid = selectedId.slice(2); groups = groups.filter(g => g.id !== gid); }
    else { items = items.filter(x => x.id !== selectedId); groups.forEach(g => g.children = g.children.filter(ch => ch.refId !== selectedId)); }
    selectedId = null; redraw(); setQueued(); setStat("Deleted.", "ok"); e.preventDefault();
  }
});

/* ---------- Canvas interactions (placement / eyedrop / area clone) ---------- */
$('cv').addEventListener('pointerdown', async (e) => {
  const r = $('cv').getBoundingClientRect();
  const pxX = e.clientX - r.left, pxY = e.clientY - r.top;
  const xPt = Math.round(pxX * ptPerPx), yPt = Math.round(pxY * ptPerPx);

  if (eyedropMode) {
    const page = await pdfDoc.getPage(pageNum);
    const tc = await page.getTextContent();
    let best = null, bestD = 1e15;
    for (const it of tc.items) {
      const a = it.transform[0], d = it.transform[3], ex = it.transform[4], ey = it.transform[5];
      const size = Math.max(Math.abs(a), Math.abs(d));
      const x = ex, yTop = pageHeightPts - ey - size;
      const cx = x + (it.width / 2), cy = yTop + size * 0.6;
      const dx = cx - xPt, dy = cy - yPt; const dd = dx * dx + dy * dy;
      if (dd < bestD) { bestD = dd; best = { size, font: guessFontFromName(it.fontName), px: [cx / ptPerPx, cy / ptPerPx] }; }
    }
    if (best) {
      $('size').value = Math.max(6, Math.round(best.size));
      $('font').value = best.font;
      $('color').value = sampleColorMedianAtPx(best.px[0], best.px[1]);
      $('picked').textContent = `picked: ${best.font}, ${$('size').value}pt, ${$('color').value}`;
      setStat("Style picked.", "ok");
    }
    eyedropMode = false; $('eyedrop').textContent = "Eyedrop"; return;
  }

  if (areaMode) { startMarquee(pxX, pxY); return; }

  lastClickPt = { x: xPt, y: yPt };
  setStat(`Placement set at (${xPt}, ${yPt}).`, "ok");
});

/* marquee drag to define selection */
let marqueeEl = null, mStart = null;
function startMarquee(pxX, pxY) {
  const ov = $('overlay');
  if (marqueeEl && marqueeEl.parentNode) marqueeEl.parentNode.removeChild(marqueeEl);
  marqueeEl = document.createElement('div'); marqueeEl.className = 'marquee';
  marqueeEl.style.left = pxX + 'px'; marqueeEl.style.top = pxY + 'px'; marqueeEl.style.width = '0px'; marqueeEl.style.height = '0px'; ov.appendChild(marqueeEl);
  mStart = { x: pxX, y: pxY };

  const move = (e) => {
    const r = $('cv').getBoundingClientRect(); const cx = e.clientX - r.left, cy = e.clientY - r.top;
    const x = Math.min(mStart.x, cx), y = Math.min(mStart.y, cy);
    marqueeEl.style.left = x + 'px'; marqueeEl.style.top = y + 'px';
    marqueeEl.style.width = Math.abs(cx - mStart.x) + 'px'; marqueeEl.style.height = Math.abs(cy - mStart.y) + 'px';
  };
  const up = async () => {
    document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up);
    const rect = marqueeEl.getBoundingClientRect(), cvRect = $('cv').getBoundingClientRect();
    const selPx = { x: rect.left - cvRect.left, y: rect.top - cvRect.top, w: rect.width, h: rect.height };
    if (selPx.w < 5 || selPx.h < 5) { setStat("Selection too small.", "err"); marqueeEl.remove(); marqueeEl = null; return; }
    const selPt = { x: Math.round(selPx.x * ptPerPx), y: Math.round(selPx.y * ptPerPx), w: Math.round(selPx.w * ptPerPx), h: Math.round(selPx.h * ptPerPx) };

    // call clone.js implementation
    if (typeof window.cloneFromArea === 'function') {
      await window.cloneFromArea(selPt, selPx);
    } else {
      setStat("cloneFromArea not found. Make sure /public/clone.js is loaded after editor.js.", "err");
    }
    marqueeEl.remove(); marqueeEl = null;
  };
  document.addEventListener('pointermove', move, { passive: false });
  document.addEventListener('pointerup', up, { once: true });
}
