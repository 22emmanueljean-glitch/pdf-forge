// api/edit.js
// Unified renderer for text & line edits using top-left coordinates
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
const colorToRgb = (c)=> Array.isArray(c) && c.length===3 ? rgb(c[0],c[1],c[2]) : rgb(0,0,0);

function widthOfText(font, size, text, tracking){
  if(!tracking) return font.widthOfTextAtSize(text, size);
  const baseline = font.widthOfTextAtSize(text, size);
  const extra = Math.max(0, [...String(text)].length - 1) * tracking;
  return baseline + extra;
}
function wrapText(text, font, size, maxWidth, tracking){
  const words = String(text||'').split(/(\s+)/);
  const lines = []; let line='';
  for(const w of words){
    const test = line + w;
    const wpx = widthOfText(font, size, test, tracking);
    if(wpx <= maxWidth || line.length===0){ line = test; }
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
      const H = page.getHeight();

      if(e.type==='text'){
        const fontName = e.font || 'Times-Roman';
        const size = Number(e.size || 11);
        const width = Number(e.width || 460);
        const color = colorToRgb(e.color || [0,0,0]);
        const font = embedded[fontName] || embedded['Times-Roman'];
        const tracking = Number(e.tracking || 0);
        const fauxBold = Math.max(0, Math.min(3, Number(e.fauxBold || 0)));
        const skewDeg = Number(e.skewDeg || 0);
        const underline = !!e.underline;
        const lineHeight = Number(e.lineHeight || Math.round(size*1.35));
        const x = Number(e.x || 72);
        let yTop = Number(e.y || 700);
        const skewRad = (skewDeg * Math.PI) / 180;

        const paragraphs = String(e.text||'').split(/\r?\n/);
        for(const para of paragraphs){
          const lines = wrapText(para, font, size, width, tracking);
          for(const line of lines){
            // draw with optional faux bold + skew + tracking (char by char)
            for(let pass=0; pass<=fauxBold; pass++){
              const passDx = pass===0 ? 0 : (pass%2 ? 0.15 : -0.15);
              const passDy = pass===0 ? 0 : (pass%2 ? 0.10 : -0.10);
              let cx = x + passDx;
              for(const ch of [...line]){
                const yFromBottom = H - yTop - size + passDy;
                const opts = { x: cx, y: yFromBottom, font, size, color, maxWidth: width };
                if(skewDeg!==0){
                  const xSkew = Math.tan(skewRad);
                  opts.rotate = { type: 'skew', xSkew, ySkew: 0 };
                }
                page.drawText(ch, opts);
                cx += font.widthOfTextAtSize(ch, size) + tracking;
              }
            }
            if(underline){
              const w = widthOfText(font, size, line, tracking);
              const yUL = H - yTop - size*0.2;
              page.drawLine({ start:{x, y:yUL}, end:{x:x+w, y:yUL}, thickness: 0.8, color });
            }
            yTop += lineHeight;
          }
          yTop += (lineHeight * 0.15);
        }
      } else if(e.type==='line'){
        const x = Number(e.x || 72);
        const yTop = Number(e.y || 700);
        const width = Number(e.width || 460);
        const thick = Math.max(0.5, Number(e.thick || 1));
        const color = colorToRgb(e.color || [0,0,0]);
        const yFromBottom = H - yTop - thick;
        page.drawRectangle({ x, y: yFromBottom, width, height: thick, color, borderColor: color, borderWidth: 0 });
      }
    }

    const out = await pdf.save({ updateFieldAppearances:false, useObjectStreams:false });
    res.status(200).json({ pdf: Buffer.from(out).toString('base64') });
  }catch(err){
    res.status(500).json({ error: String(err?.message || err) });
  }
};
