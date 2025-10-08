const pdfjsLib = require("pdfjs-dist");
pdfjsLib.GlobalWorkerOptions.workerSrc = require("pdfjs-dist/build/pdf.worker.js");

function intersects(a, b) {
  return !(a.x + a.w < b.x || a.x > b.x + b.w || a.y + a.h < b.y || a.y > b.y + b.h);
}
function mapStd(name = "", flags = 0) {
  const n = String(name);
  const isHelv = /helv/i.test(n);
  const isCour = /cour/i.test(n);
  const isTimes = /times|newroman|tnr|minion|garamond|serif/i.test(n) || (!isHelv && !isCour);
  const isBold = /bold|bd|semibold|demi|medium/i.test(n) || (flags & 0x40000);
  const isItal = /italic|oblique|it|obl/i.test(n) || (flags & 0x20000);
  let fam = "Times";
  if (isHelv) fam = "Helvetica";
  else if (isCour) fam = "Courier";
  let v = fam;
  if (isBold && isItal) v = fam + (fam === "Helvetica" ? "-BoldOblique" : fam === "Times" ? "-BoldItalic" : "-BoldOblique");
  else if (isBold) v = fam + "-Bold";
  else if (isItal) v = fam + (fam === "Helvetica" ? "-Oblique" : fam === "Times" ? "-Italic" : "-Oblique");
  else if (fam === "Times") v = "Times-Roman";
  return v;
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
    const doc = await pdfjsLib.getDocument({ data: pdfData }).promise;
    const pno = Math.min(Math.max(1, page), doc.numPages);
    const pg = await doc.getPage(pno);
    const vp = pg.getViewport({ scale: 1.0 }); // points
    const H = vp.height;

    const tc = await pg.getTextContent();
    const out = [];
    for (const it of tc.items) {
      const [a, b, c, d, e, f] = it.transform;
      const size = Math.max(Math.abs(a), Math.abs(d));
      const x = e;
      const yTop = H - f - size;     // convert to top-left
      const w = it.width;
      const h = size * 1.2;          // approximate text box height
      const spanRect = { x, y: yTop, w, h };
      if (!intersects(spanRect, rect)) continue;

      out.push({
        text: it.str,
        x, y: yTop, w, h,
        size,
        font_name: it.fontName || "",
        font_mapped: mapStd(it.fontName || "", (it.font && it.font.black) ? it.font.black : 0)
      });
    }

    res.status(200).json({ page_width: vp.width, page_height: vp.height, spans: out });
  } catch (e) {
    res.status(500).json({ error: String(e && e.message || e) });
  }
};