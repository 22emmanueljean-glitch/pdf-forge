const pdfjsLib = require("pdfjs-dist");
const { getDocument } = pdfjsLib;

pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.js");

function rectsIntersect(a, b) {
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}

function fontGuess(name = "", flags = 0) {
  const n = String(name);
  const isHelv = /helv/i.test(n);
  const isCour = /cour/i.test(n);
  const isTimes = /times|newroman|tnr|minion|garamond|serif/i.test(n) || (!isHelv && !isCour);
  const isBold = /bold|bd|semibold|demi|medium/i.test(n) || (flags & 0x40000); // pdfjs bold
  const isItal = /italic|oblique|it|obl/i.test(n) || (flags & 0x20000);       // pdfjs italic
  let fam = "Times";
  if (isHelv) fam = "Helvetica";
  else if (isCour) fam = "Courier";
  let variant = fam;
  if (isBold && isItal) variant = fam + (fam === "Helvetica" ? "-BoldOblique" : fam === "Times" ? "-BoldItalic" : "-BoldOblique");
  else if (isBold) variant = fam + "-Bold";
  else if (isItal) variant = fam + (fam === "Helvetica" ? "-Oblique" : fam === "Times" ? "-Italic" : "-Oblique");
  else if (fam === "Times") variant = "Times-Roman";
  return variant;
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
    const { file_b64, page, rect } = body;
    if (!file_b64 || !page || !rect) return res.status(400).json({ error: "Missing file_b64/page/rect" });

    const pdfData = Buffer.from(file_b64, "base64");
    const loadingTask = getDocument({ data: pdfData });
    const doc = await loadingTask.promise;
    const pno = Math.min(Math.max(1, page), doc.numPages);
    const pg = await doc.getPage(pno);

    // viewport 1.0 to work in PDF points
    const vp = pg.getViewport({ scale: 1.0 });
    const textContent = await pg.getTextContent();

    // pdf.js gives transforms in PDF coordinate space (origin bottom-left)
    const pageHeight = vp.height;

    const spans = [];
    for (const item of textContent.items) {
      const [a, b, c, d, e, f] = item.transform;
      // width is item.width, height is approx item.fontSize
      const size = Math.max(Math.abs(a), Math.abs(d));
      // Convert baseline to top-left box
      const x = e;
      const yTop = pageHeight - f - size;
      const w = item.width;
      const h = size * 1.2;
      const spanRect = { x, y: yTop, w, h };

      if (rectsIntersect(spanRect, rect)) {
        // Get color (pdf.js gives rgb in operatorList? Fallback to gray)
        // We can’t access fill color directly from item; sample via canvas on FE.
        // Here we pass font name and flags; FE can sample color per block.
        const fontName = (item.fontName || "").toString();
        const flags = item.font ? item.font.black : 0; // not reliable; keep 0
        const mapped = fontGuess(fontName, flags);
        spans.push({
          text: item.str,
          x, y: yTop, w, h,
          size,
          font_name: fontName,
          font_mapped: mapped
        });
      }
    }

    res.status(200).json({
      page_width: vp.width,
      page_height: vp.height,
      spans
    });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};