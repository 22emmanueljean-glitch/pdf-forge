import { renderPDF, initEditor } from './editor.js';

const fileInput = document.getElementById('file');
const loadBtn = document.getElementById('load');
const stage = document.getElementById('stage');
let pdfDoc = null;

loadBtn.addEventListener('click', async () => {
  const file = fileInput.files?.[0];
  if (!file) return alert('Select a PDF');
  const buf = await file.arrayBuffer();
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  pdfDoc = await pdfjsLib.getDocument({ data: buf }).promise;
  stage.innerHTML = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale: 1.1 });
    const wrapper = document.createElement('div');
    wrapper.style.position = 'relative';
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    wrapper.append(canvas, overlay);
    stage.appendChild(wrapper);
    initEditor(overlay, page, viewport);
  }
});
