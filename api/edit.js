// api/edit.js
import { PythonShell } from 'python-shell';

export default async function handler(req, res) {
  try {
    const body = await new Promise((resolve) => {
      let b=''; req.on('data', c => b += c); req.on('end', () => resolve(b));
    });
    const data = JSON.parse(body); // { file: b64, edits: [{page,x,y,text,font?,size?,color?,style_ref?}] , styles? }
    const code = `
import sys, json, base64, fitz, io
d = json.loads(${JSON.stringify(body)})
pdf = base64.b64decode(d["file"])
doc = fitz.open(stream=pdf, filetype="pdf")
styles = d.get("styles", {})  # { "2": { "0": {font,size,color}, "1": {...} }, ... }

for e in d["edits"]:
    p = doc[e["page"]-1]
    x,y = float(e["x"]), float(e["y"])
    text = e["text"]
    font = e.get("font"); size = e.get("size"); color = e.get("color")
    sr = e.get("style_ref")
    if sr is not None:
        # sr like {"page": 2, "id": 0}
        pg = str(sr.get("page"))
        sid = str(sr.get("id"))
        if pg in styles and sid in styles[pg]:
            st = styles[pg][sid]
            font = st.get("font", font)
            size = st.get("size", size)
            color = st.get("color", color)
    if color is None: color=(0,0,0)
    elif isinstance(color, int):
        # convert 0xRRGGBB int to tuple
        r = (color>>16) & 255; g = (color>>8) & 255; b = color & 255
        color = (r/255, g/255, b/255)
    rect = fitz.Rect(x, y, x+460, y+160)
    p.insert_textbox(rect, text, fontsize=float(size or 11), fontname=(font or "Times-Roman"), color=color)
out = io.BytesIO(); doc.save(out); print(json.dumps({"pdf": base64.b64encode(out.getvalue()).decode()}))
`;
    const result = await PythonShell.runString(code, { mode: 'text', pythonOptions: ['-u'] });
    res.status(200).json(JSON.parse(result.join('')));
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
