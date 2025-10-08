const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function toRgb(hexOrArr) {
  if (Array.isArray(hexOrArr)) return rgb(hexOrArr[0], hexOrArr[1], hexOrArr[2]);
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hexOrArr || "#000000");
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}
function mapFont(name) {
  const m = {
    "Times-Roman": StandardFonts.TimesRoman,
    "Times-Bold": StandardFonts.TimesBold,
    "Times-Italic": StandardFonts.TimesItalic,
    "Times-BoldItalic": StandardFonts.TimesBoldItalic,
    "Helvetica": StandardFonts.Helvetica,
    "Helvetica-Bold": StandardFonts.HelveticaBold,
    "Helvetica-Oblique": StandardFonts.HelveticaOblique,
    "Helvetica-BoldOblique": StandardFonts.HelveticaBoldOblique,
    "Courier": StandardFonts.Courier,
    "Courier-Bold": StandardFonts.CourierBold,
    "Courier-Oblique": StandardFonts.CourierOblique,
    "Courier-BoldOblique": StandardFonts.CourierBoldOblique
  };
  return m[name] || StandardFonts.TimesRoman;
}
function wrap(text, font, size, maxW, tracking = 0) {
  const words = String(text || "").split(/(\s+)/); // keep spaces
  const out = [];
  let line = "";
  for (const w of words) {
    const test = line + w;
    const wpt = font.widthOfTextAtSize(test, size) + Math.max(0, test.length - 1) * tracking;
    if (wpt <= maxW || line.length === 0) line = test;
    else { out.push(line.trimEnd()); line = w.trimStart(); }
  }
  if (line.length) out.push(line.trimEnd());
  return out;
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
    const body = await new Promise((resolve, reject) => {
      let d = "";
      req.on("data", c => d += c);
      req.on("end", () => resolve(JSON.parse(d)));
      req.on("error", reject);
    });
    const { file_b64, blocks } = body;
    if (!file_b64 || !Array.isArray(blocks)) return res.status(400).json({ error: "Missing file_b64/blocks" });

    const pdf = await PDFDocument.load(Buffer.from(file_b64, "base64"), { updateMetadata: false });

    // Embed needed fonts once
    const needed = new Set(blocks.filter(b => b.type !== "line").map(b => b.font_mapped || "Times-Roman"));
    const fonts = {};
    for (const n of needed) fonts[n] = await pdf.embedFont(mapFont(n));
    if (!fonts["Times-Roman"]) fonts["Times-Roman"] = await pdf.embedFont(StandardFonts.TimesRoman);

    for (const b of blocks) {
      const page = pdf.getPage(Math.max(0, (b.page || 1) - 1));
      const H = page.getHeight();
      if (b.type === "line") {
        page.drawRectangle({ x: b.x, y: H - b.y - b.thick, width: b.width, height: b.thick, color: toRgb(b.color) });
        continue;
      }
      const font = fonts[b.font_mapped || "Times-Roman"] || fonts["Times-Roman"];
      const size = Number(b.size || 11);
      const width = Number(b.width || 460);
      const lh = Number(b.line_height || size * 1.35);
      const track = Number(b.tracking || 0);
      const color = toRgb(b.color || [0, 0, 0]);

      let yTop = Number(b.y || 700);
      for (const para of String(b.text || "").split(/\r?\n/)) {
        for (const line of wrap(para, font, size, width, track)) {
          page.drawText(line, { x: b.x, y: H - yTop - size, font, size, color, maxWidth: width });
          yTop += lh;
        }
        yTop += lh * 0.15;
      }
    }

    const out = await pdf.save({ updateFieldAppearances: false, useObjectStreams: false });
    res.status(200).json({ file_b64: Buffer.from(out).toString("base64") });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};