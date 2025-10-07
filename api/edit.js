// /api/edit.js
import { PythonShell } from 'python-shell';

export default async function handler(req, res) {
  try {
    // read body safely
    const body = await new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => data += chunk);
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });
    const parsed = JSON.parse(body); // { file:base64, edits:[...] }

    // build python payload once – avoid serialising parsed again
    const pyPayload = JSON.stringify(parsed);

    const code = `
import sys, json, base64, fitz, io
payload = json.loads('''${pyPayload}''')
pdf_bytes = base64.b64decode(payload["file"])
doc = fitz.open(stream=pdf_bytes, filetype="pdf")

for e in payload["edits"]:
    page_index = int(e["page"])-1
    if page_index < 0 or page_index >= doc.page_count:
        continue
    p = doc[page_index]
    x,y = float(e["x"]), float(e["y"])
    text  = e["text"]
    font  = e.get("font") or "Times-Roman"
    size  = float(e.get("size") or 11)
    width = float(e.get("width") or 460)
    color = e.get("color") or [0,0,0]
    if isinstance(color, list) and len(color)==3:
        color = tuple(color)
    else:
        color = (0,0,0)
    rect = fitz.Rect(x, y, x + width, y + size*3)  # simple height guess
    p.insert_textbox(rect, text, fontsize=size, fontname=font, color=color)

out = io.BytesIO()
doc.save(out)
doc.close()
print(json.dumps({"pdf":base64.b64encode(out.getvalue()).decode()}))
`;

    const result = await PythonShell.runString(code, { mode: 'text', pythonOptions: ['-u'] });
    const final = JSON.parse(result.join(''));
    res.status(200).json(final);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message || 'Server error' });
  }
}