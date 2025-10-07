// api/analyze.js
import { PythonShell } from 'python-shell';

export default async function handler(req, res) {
  try {
    const body = await new Promise((resolve) => {
      let b = ''; req.on('data', c => b += c); req.on('end', () => resolve(b));
    });
    const { file } = JSON.parse(body); // base64

    const py = `
import json, base64, fitz, io
pdf = base64.b64decode(${JSON.stringify('').slice(0,-2)} + ${JSON.stringify('')} )  # placeholder line
`; // we'll inject file b64 safely below

    const code = `
import json, base64, fitz, io
pdf_b64 = ${JSON.stringify(file)}
pdf = base64.b64decode(pdf_b64)
doc = fitz.open(stream=pdf, filetype="pdf")
out = {"pages":[]}
for i, page in enumerate(doc, start=1):
    d = page.get_text("dict")
    blocks = []
    for bi, b in enumerate(d["blocks"]):
        if "lines" not in b: continue
        for li, ln in enumerate(b["lines"]):
            for si, sp in enumerate(ln["spans"]):
                bbox = sp.get("bbox") or ln.get("bbox") or b.get("bbox")
                font = sp.get("font","")
                size = sp.get("size",0)
                color = sp.get("color",0)  # int; PyMuPDF color in 0xRRGGBB
                text  = sp.get("text","")
                blocks.append({
                    "bbox": bbox, "font": font, "size": size,
                    "color": color, "text": text[:60]
                })
    # Build style palette (unique (font,size,color) combos)
    styles = {}
    for bl in blocks:
        key = f'{bl["font"]}|{bl["size"]}|{bl["color"]}'
        if key not in styles:
            styles[key] = {"font": bl["font"], "size": bl["size"], "color": bl["color"], "count": 0}
        styles[key]["count"] += 1
    out["pages"].append({"page": i, "blocks": blocks, "styles": [
        {"id": idx, **v} for idx, v in enumerate(sorted(styles.values(), key=lambda s: -s["count"]))
    ]})
print(json.dumps(out))
`;

    const result = await PythonShell.runString(code, { mode: 'text', pythonOptions: ['-u'] });
    res.status(200).json(JSON.parse(result.join('')));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
