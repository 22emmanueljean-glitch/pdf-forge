// app.js (ES module) — wires "Load Preview" and renders page 1

// ---- pdf.js (read from global for modules) ----
const PDFJS = window.pdfjsLib || window['pdfjs-dist/build/pdf'];
if (!PDFJS) {
  console.error('pdf.js not found. Ensure the pdf.min.js <script> and the window.pdfjsLib assignment run before this file.');
}

// ---- tiny helpers ----
const $ = (id) => document.getElementById(id);
const setStat = (t, cls = "") => { const el = $('stat'); if (el) { el.textContent = t; el.className = "status " + cls; } };
const setMeta = (pageNum, scale) => { const el = $('meta'); if (el) el.textContent = `Page ${pageNum} | scale ${scale.toFixed(2)}`; };

// ---- state ----
let pdfDoc = null;
let pageNum = 1;
let pageCount = 1;
let scale = 1.10;   // 110%
let ptPerPx = 1;
let pageHeightPts = 0;

Object.assign(window, { pdfDoc, pageNum, ptPerPx, pageHeightPts }); // optional expose

async function fileToArrayBuffer(file) {
  return file.arrayBuffer();
}

// ---- render current page to #cv ----
async function renderPage() {
  const page = await pdfDoc.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const baseViewport = page.getViewport({ scale: 1 });

  const cv = $('cv');
  if (!cv) { console.error('#cv canvas not found'); return; }
  const ctx = cv.getContext('2d');

  cv.width = viewport.width;
  cv.height = viewport.height;

  ptPerPx = baseViewport.width / viewport.width;
  pageHeightPts = baseViewport.height;

  await page.render({ canvasContext: ctx, viewport }).promise;

  const wrap = $('pageWrap');
  if (wrap) wrap.style.display = '';
  setMeta(pageNum, scale);
}

// ---- wire UI after DOM ready ----
window.addEventListener('DOMContentLoaded', () => {
  const loadBtn = $('load');
  if (!loadBtn) {
    console.error('Load button #load not found in DOM');
    return;
  }

  loadBtn.addEventListener('click', async () => {
    try {
      const fileInput = $('file');
      const f = fileInput?.files?.[0];
      if (!f) { setStat('Choose a PDF.', 'err'); return; }

      setStat('Loading…');

      // load with pdf.js
      const buf = await fileToArrayBuffer(f);
      const loadingTask = PDFJS.getDocument({ data: buf });
      pdfDoc = await loadingTask.promise;

      pageCount = pdfDoc.numPages;
      pageNum = 1;

      // populate pageSelect if present
      const sel = $('pageSelect');
      if (sel) {
        sel.innerHTML = '';
        for (let i = 1; i <= pageCount; i++) {
          const o = document.createElement('option'); o.value = String(i); o.textContent = String(i);
          sel.appendChild(o);
        }
        sel.value = '1';
        sel.onchange = async (e) => { pageNum = Number(e.target.value) || 1; await renderPage(); };
      }

      // zoom slider if present
      const zoom = $('zoom');
      if (zoom) {
        zoom.oninput = async (e) => { scale = Number(e.target.value) / 100; await renderPage(); };
      }

      // prev/next if present
      const prev = $('prev'), next = $('next');
      if (prev) prev.onclick = async () => { if (!pdfDoc) return; pageNum = Math.max(1, pageNum - 1); if (sel) sel.value = String(pageNum); await renderPage(); };
      if (next) next.onclick = async () => { if (!pdfDoc) return; pageNum = Math.min(pageCount, pageNum + 1); if (sel) sel.value = String(pageNum); await renderPage(); };

      // render first page
      await renderPage();

      // reveal tools panel if present
      const tools = $('tools');
      if (tools) tools.style.display = '';

      setStat(`Loaded ${pageCount} page(s).`, 'ok');
    } catch (err) {
      console.error(err);
      setStat('Error: ' + (err?.message || err), 'err');
    }
  });
});
