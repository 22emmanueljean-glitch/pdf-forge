// api/edit.js
// Node serverless function (no Python needed). Uses pdf-lib to add text to existing PDFs.
// Expects JSON: { file: <base64>, edits: [{page,x,y,text,width,size,font,color}] }
// - page: 1-based page number
// - x,y: TOP-LEFT PDF coordinates in points (same as your UI). We'll convert to pdf-lib's bottom-left.
// - width: wrap width in points (default 460)
// - size: font size (default 11)
// - font: one of ["Times-Roman","Times-Bold","Times-Italic","Times-BoldItalic","Helvetica","Helvetica-Bold","Helvetica-Oblique","Helvetica-BoldOblique","Courier","Courier-Bold","Courier-Oblique","Courier-BoldOblique"] (default Times-Roman)
// - color: [r,g,b] either 0..1 or 0..255 (default black)

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

function colorToRgb(c) {
  if (!Array.isArray(c) || c.length !== 3) return rgb(0, 0, 0);
  // allow either [0..1] or [0..255]
  const scale = (c[0] > 1 || c[1] > 1 || c[2] > 1) ? 255 : 1;
  return rgb(c[0] / scale, c[1] / scale, c[2] / scale);
}

// simple word-wrapper
function wrapText(text, font, fontSize, maxWidth) {
  const words = (text || '').split(/(\s+)/); // keep spaces
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line + w;
    const width = font.widthOfTextAtSize(test, fontSize);
    if (width <= maxWidth || line.length === 0) {
      line = test;
    } else {
      lines.push(line.trimEnd());
      line = w.trimStart();
    }
  }
  if (line.length) lines.push(line.trimEnd());
  return lines;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Use POST' });
      return;
    }
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));

    const pdfBytes = Buffer.from(body.file, 'base64');
    const edits = Array.isArray(body.edits) ? body.edits : [];

    const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });

    // Pre-embed any fonts we need
    const neededFonts = new Map();
    for (const e of edits) {
      const name = e.font || 'Times-Roman';
      neededFonts.set(name, mapFont(name));
    }
    const embedded = {};
    for (const [name, stdFont] of neededFonts.entries()) {
      embedded[name] = await pdf.embedFont(stdFont);
    }

    for (const e of edits) {
      const pageIndex = Math.max(0, (e.page || 1) - 1);
      const page = pdf.getPage(pageIndex);
      const pageHeight = page.getHeight();

      const fontName = e.font || 'Times-Roman';
      const fontSize = Number(e.size || 11);
      const width = Number(e.width || 460);
      const color = colorToRgb(e.color || [0, 0, 0]);
      const font = embedded[fontName] || embedded['Times-Roman'];

      // Incoming coordinates are TOP-LEFT. pdf-lib uses BOTTOM-LEFT.
      // We'll draw line by line from the top-left (x,y) downward.
      const x = Number(e.x || 72);
      let yTop = Number(e.y || 700);

      const lineHeight = fontSize * 1.35; // approximate leading
      const paragraphs = String(e.text || '').split(/\r?\n/);

      for (const para of paragraphs) {
        const lines = wrapText(para, font, fontSize, width);
        for (const line of lines) {
          const yFromBottom = pageHeight - yTop - fontSize; // baseline correction
          page.drawText(line, { x, y: yFromBottom, font, size: fontSize, color, maxWidth: width });
          yTop += lineHeight;
        }
        // paragraph spacing (slightly larger)
        yTop += (lineHeight * 0.15);
      }
    }

    const out = await pdf.save({ updateFieldAppearances: false, useObjectStreams: false });
    res.status(200).json({ pdf: Buffer.from(out).toString('base64') });
  } catch (err) {
    res.status(500).json({ error: String(err?.message || err) });
  }
};
