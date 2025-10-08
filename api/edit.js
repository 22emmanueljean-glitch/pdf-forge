// api/edit.js
// Draws text with line wrapping, per-block lineHeight, fauxBold (multi-pass), fauxItalic (xSkew), and tracking.
// Colors as [0..1]. Coordinates are TOP-LEFT in points.

const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

function mapFont(name) {
  const m = {
    'Times-Roman': StandardFonts.TimesRoman,
    'Times-Bold': StandardFonts.TimesBold,
    'Times-Italic': StandardFonts.TimesItalic,
    'Times-BoldItalic': StandardFonts.TimesBoldItalic,
    'Helvetica': StandardFonts.Helvetica,
    'Helvetica-Bold': StandardFonts.HelveticaBold,
    'Helvetica-Oblique': StandardFonts.HelveticaOblique,
    'Helvetica-BoldOblique': StandardFonts.HelveticaBoldOblique,
    'Courier': StandardFonts.Courier,
    'Courier-Bold': StandardFonts.CourierBold,
    'Courier-Oblique': StandardFonts.CourierOblique,
    'Courier-BoldOblique': StandardFonts.CourierBoldOblique,
  };
  return m[name] || StandardFonts.TimesRoman;
}
function colorToRgb(c){ return Array.isArray(c) && c.length===3 ? rgb(c[0],c[1],c[2]) : rgb(0,0,0); }

// word wrap with tracking support
function widthOfText(font, fontSize, text, tracking){
  if(!tracking) return font.widthOfTextAtSize(text, fontSize);
  let w = font.widthOfTextAtSize(text, fontSize);
  const letters = [...String(text)];
  const extra = Math.max(0, letters.length - 1) * tracking;
  return w + extra;
}
function wrapText(text, font, fontSize, maxWidth, tracking){
  const words = String(text||'').split(/(\s+)/); // keep spaces
  const lines = []; let line='';
  for(const w of words){
    const test = line + w;
    const width = widthOfText(font, fontSize, test, tracking);
    if(width <= maxWidth || line.length===0){ line = test; }
    else { lines.push(line.trimEnd()); line = w.trimStart(); }
  }
  if(line.length) lines.push(line.trimEnd());
  return lines;
}

module.exports = async (req, res) => {
  try{
    if(req.method!=='POST'){ res.status(405).json({error:'Use POST'}); return; }
    const chunks=[]; for await (const ch of req) chunks.push(ch);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const pdfBytes = Buffer.from(body.file, 'base64');
    const edits = Array.isArray(body.edits)? body.edits : [];

    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata:false });

    // embed needed core14 fonts
    const need = new Set();
    for(const e of edits){ if(e.type==='text') need.add(e.font||'Times-Roman'); }
    const embedded = {};
    for(const name of need){ embedded[name] = await pdf.embedFont(mapFont(name)); }
    if(!embedded['Times-Roman']) embedded['Times-Roman'] = await pdf.embedFont(StandardFonts.TimesRoman);

    for(const e of edits){
      const pageIndex = Math.max(0, (e.page||1)-1);
      const page = pdf.getPage(pageIndex);
      const pageHeight = page.getHeight();

      if(e.type==='text'){
        const fontName = e.font || 'Times-Roman';
        const fontSize = Number(e.size || 11);
        const width = Number(e.width || 460);
        const color = colorToRgb(e.color || [0,0,0]);
        const font = embedded[fontName] || embedded['Times-Roman'];
        const tracking = Number(e.tracking || 0); // pt per char gap
        const fauxBold = Math.max(0, Math.min(3, Number(e.fauxBold || 0))); // extra passes
        const skewDeg = Number(e.skewDeg || 0);
        const lineHeight = Number(e.lineHeight || Math.round(fontSize*1.35));
        const x = Number(e.x || 72);
        let yTop = Number(e.y || 700);

        const paragraphs = String(e.text||'').split(/\r?\n/);
        const skewRad = (skewDeg * Math.PI) / 180;

        // helper to draw one line (with tracking & optional skew)
        const drawLine = (str, yLine) => {
          // build a single string with manual tracking by inserting small spaces if tracking>0
          // pdf-lib doesn't have letterSpacing; approximate by drawing char-by-char with dx.
          if(Math.abs(tracking) < 0.001 && skewDeg===0 && fauxBold===0){
            const yFromBottom = pageHeight - yLine - fontSize;
            page.drawText(str, { x, y: yFromBottom, font, size: fontSize, color, maxWidth: width });
            return;
          }
          // advanced draw: char-by-char with transforms
          let cursorX = x;
          for(let pass=0; pass<=fauxBold; pass++){
            const passDx = pass===0 ? 0 : (pass===1 ? 0.15 : -0.15);
            const passDy = pass===0 ? 0 : (pass===1 ? 0.10 : -0.10);
            cursorX = x + passDx;
            const chars=[...str];
            for(const ch of chars){
              const yFromBottom = pageHeight - yLine - fontSize + passDy;
              const opts = { x: cursorX, y: yFromBottom, font, size: fontSize, color, maxWidth: width };
              if(skewDeg!==0){
                const xSkew = Math.tan(skewRad);
                opts.rotate = { type: 'skew', xSkew, ySkew: 0 };
              }
              page.drawText(ch, opts);
              cursorX += font.widthOfTextAtSize(ch, fontSize) + tracking;
            }
          }
        };

        for(const para of paragraphs){
          const lines = wrapText(para, font, fontSize, width, tracking);
          for(const line of lines){
            drawLine(line, yTop);
            yTop += lineHeight;
          }
          yTop += (lineHeight * 0.15);
        }
      }
      else if(e.type==='line'){
        const x = Number(e.x || 72);
        const yTop = Number(e.y || 700);
        const width = Number(e.width || 460);
        const thick = Math.max(0.5, Number(e.thick || 1));
        const color = colorToRgb(e.color || [0,0,0]);
        const yFromBottom = pageHeight - yTop - thick;
        page.drawRectangle({ x, y: yFromBottom, width, height: thick, color, borderColor: color, borderWidth: 0 });
      }
    }

    const out = await pdf.save({ updateFieldAppearances:false, useObjectStreams:false });
    res.status(200).json({ pdf: Buffer.from(out).toString('base64') });
  }catch(err){
    res.status(500).json({ error: String(err?.message || err) });
  }
};
