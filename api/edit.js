// api/edit.js
// Serverless function for Vercel (Node) using pdf-lib.
// Accepts JSON:
// { file: <base64>, edits: [ {type:'text', page,x,y,width,text,font,size,color}, {type:'line', page,x,y,width,thick,color} ] }
//
// Notes:
// - Coordinates in POINTS, origin at TOP-LEFT (like the editor preview).
// - Colors as [r,g,b] in 0..1 (the editor sends in 0..1).
// - Text wraps within 'width', with ~1.35 line height.
// - Lines are drawn as thin rectangles (x,y,width,thick) at given TOP-LEFT.

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
function wrapText(text, font, fontSize, maxWidth){
  const words = String(text||'').split(/(\s+)/); // keep spaces
  const lines = []; let line='';
  for(const w of words){
    const test = line + w;
    const width = font.widthOfTextAtSize(test, fontSize);
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

    // gather needed fonts
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

        const x = Number(e.x || 72);
        let yTop = Number(e.y || 700);
        const lineHeight = fontSize * 1.35;

        const paragraphs = String(e.text||'').split(/\r?\n/);
        for(const para of paragraphs){
          const lines = wrapText(para, font, fontSize, width);
          for(const line of lines){
            const yFromBottom = pageHeight - yTop - fontSize;
            page.drawText(line, { x, y: yFromBottom, font, size: fontSize, color, maxWidth: width });
            yTop += lineHeight;
          }
          yTop += (lineHeight * 0.15); // paragraph spacing
        }
      }
      else if(e.type==='line'){
        const x = Number(e.x || 72);
        const yTop = Number(e.y || 700);
        const width = Number(e.width || 460);
        const thick = Math.max(0.5, Number(e.thick || 1));
        const color = colorToRgb(e.color || [0,0,0]);
        // Convert to bottom-left:
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
