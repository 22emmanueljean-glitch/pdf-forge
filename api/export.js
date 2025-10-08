const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

function toRgb(arr) {
  if (!Array.isArray(arr) || arr.length !== 3) return rgb(0, 0, 0);
  return rgb(arr[0], arr[1], arr[2]);
}
function mapStdFont(mapped) {
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
  return m[mapped] || StandardFonts.TimesRoman;
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

    // Collect needed fonts
    const need = new Set();
    for (const b of blocks) if (b.type !== "line") need.add(b.font_mapped || "Times-Roman");
    const embedded = {};
    for (const name of need) embedded[name] = await pdf.embedFont(mapStdFont(name));
    if (!embedded["Times-Roman"]) embedded["Times-Roman"] = await pdf.embedFont(StandardFonts.TimesRoman);

    for (const b of blocks) {
      const p = pdf.getPage(Math.max(0, (b.page || 1) - 1));
      const H = p.getHeight();

      if (b.type === "line") {
        const yFromBottom = H - b.y - b.thick;
        p.drawRectangle({ x: b.x, y: yFromBottom, width: b.width, height: b.thick, color: toRgb(b.color) });
        continue;
      }

      const fontName = b.font_mapped || "Times-Roman";
      const font = embedded[fontName] || embedded["Times-Roman"];
      const size = Number(b.size || 11);
      const width = Number(b.width || 460);
      const lh = Number(b.line_height || size * 1.35);
      const track = Number(b.tracking || 0);
      const color = toRgb(b.color || [0, 0, 0]);

      let yTop = Number(b.y || 700);
      const paras = String(b.text || "").split(/\r?\n/);
      for (const para of paras) {
        const lines = wrap(para, font, size, width, track);
        for (const line of lines) {
          const yBottom = H - yTop - size;
          p.drawText(line, { x: b.x, y: yBottom, font, size, color, maxWidth: width });
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