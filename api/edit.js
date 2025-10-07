import { PythonShell } from 'python-shell';
import fs from 'fs';

export default async function handler(req, res) {
  try {
    const data = await new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => resolve(body));
    });

    const result = await PythonShell.runString(
      `
import sys, json, base64, fitz, io
data=json.loads(${JSON.stringify(data)})
pdf_b64=data["file"]; edits=data["edits"]
pdf=base64.b64decode(pdf_b64)
doc=fitz.open(stream=pdf, filetype="pdf")
for e in edits:
    p=doc[e["page"]-1]
    r=fitz.Rect(e["x"],e["y"],e["x"]+450,e["y"]+120)
    p.insert_textbox(r,e["text"],fontsize=e.get("size",11),fontname=e.get("font","Times-Roman"))
out=io.BytesIO();doc.save(out)
print(json.dumps({"pdf":base64.b64encode(out.getvalue()).decode()}))
      `,
      { mode: 'text', pythonOptions: ['-u'] }
    );

    res.status(200).json(JSON.parse(result.join('')));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
}
