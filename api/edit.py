# api/edit.py
from http.server import BaseHTTPRequestHandler
import io, json, base64, fitz

class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        l = int(self.headers.get("Content-Length"))
        body = self.rfile.read(l)
        data = json.loads(body)

        pdf_bytes = base64.b64decode(data["file"])
        edits = data["edits"]

        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for e in edits:
            p = doc[e["page"]-1]
            rect = fitz.Rect(e["x"], e["y"], e["x"]+450, e["y"]+100)
            p.insert_textbox(rect, e["text"],
                             fontsize=e.get("size",11),
                             fontname=e.get("font","Times-Roman"),
                             color=(0,0,0))
        out = io.BytesIO(); doc.save(out)
        out_b64 = base64.b64encode(out.getvalue()).decode()

        self.send_response(200)
        self.send_header("Content-Type","application/json")
        self.end_headers()
        self.wfile.write(json.dumps({"pdf":out_b64}).encode())
