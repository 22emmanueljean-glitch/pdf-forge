// /src/vectorText.js
import Tesseract from 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
import opentype from 'https://cdn.jsdelivr.net/npm/opentype.js@latest/dist/opentype.min.js';
import pixelmatch from 'https://cdn.jsdelivr.net/npm/pixelmatch@5.3.0/+esm';
import { FONT_CATALOG } from './fonts/index.js';

export async function vectorToTextFallback(page, viewport) {
  const scale = viewport.scale || 1;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const vp = page.getViewport({ scale });
  canvas.width = vp.width;
  canvas.height = vp.height;

  const renderTask = page.render({ canvasContext: ctx, viewport: vp });
  await renderTask.promise;

  const { data: { words } } = await Tesseract.recognize(canvas, 'eng');

  const results = [];
  for (const w of words) {
    const x = w.bbox.x0;
    const y = w.bbox.y0;
    const wpx = w.bbox.x1 - w.bbox.x0;
    const hpx = w.bbox.y1 - w.bbox.y0;

    // extract snippet image
    const snip = document.createElement('canvas');
    snip.width = wpx; snip.height = hpx;
    const sctx = snip.getContext('2d');
    sctx.drawImage(canvas, x, y, wpx, hpx, 0, 0, wpx, hpx);

    const match = await matchFontToGlyph(snip, w.text);
    const color = getMedianColor(sctx, wpx, hpx);

    results.push({
      str: w.text,
      x, y, w: wpx, h: hpx,
      fontName: match.font,
      sizePx: match.size,
      colorHex: color
    });
  }
  return results;
}

function getMedianColor(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h).data;
  const rs = [], gs = [], bs = [];
  for (let i = 0; i < data.length; i += 4) {
    rs.push(data[i]); gs.push(data[i+1]); bs.push(data[i+2]);
  }
  const med = arr => arr.sort((a,b)=>a-b)[Math.floor(arr.length/2)];
  return `#${[med(rs), med(gs), med(bs)].map(v=>v.toString(16).padStart(2,'0')).join('')}`;
}

async function matchFontToGlyph(snip, text) {
  const ref = snip.getContext('2d').getImageData(0, 0, snip.width, snip.height);
  let best = { font: 'Times-Roman', size: 14, diff: Infinity };

  for (const font of FONT_CATALOG.slice(0, 25)) { // test first 25 fonts
    for (let size = 8; size <= 48; size += 2) {
      const test = renderGlyph(font, text, size, snip.width, snip.height);
      const diff = pixelDiff(ref, test);
      if (diff < best.diff) best = { font, size, diff };
    }
  }
  return best;
}

function renderGlyph(font, text, size, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = '#000';
  ctx.textBaseline = 'top';
  ctx.fillText(text, 0, 0);
  return ctx.getImageData(0, 0, w, h);
}

function pixelDiff(a, b) {
  const len = Math.min(a.data.length, b.data.length);
  let diff = 0;
  for (let i = 0; i < len; i += 4) {
    diff += Math.abs(a.data[i] - b.data[i]);
  }
  return diff / (a.width * a.height);
}
