import base64
import io
from typing import List, Dict, Any
from fastapi import FastAPI
from pydantic import BaseModel
import fitz  # PyMuPDF

app = FastAPI(title="PDF Forge Engine")

# ---------- Schemas ----------
class Rect(BaseModel):
    x: float
    y: float
    w: float
    h: float

class AnalyzeRequest(BaseModel):
    file_b64: str
    page: int
    rect: Rect

class SpanOut(BaseModel):
    text: str
    x: float
    y: float
    w: float
    h: float
    size: float
    color: List[float] # [r,g,b] 0..1
    font_name: str
    bold: bool
    italic: bool
    font_xref: int

class AnalyzeResponse(BaseModel):
    page_width: float
    page_height: float
    spans: List[SpanOut]
    fonts: Dict[str, Any] = {}

class BlockIn(BaseModel):
    page: int
    x: float
    y: float
    width: float
    text: str
    font_xref: int
    size: float
    color: List[float]   # [r,g,b] 0..1
    line_height: float   # in points
    tracking: float = 0  # optional pt/char

class ExportRequest(BaseModel):
    file_b64: str
    blocks: List[BlockIn]

class ExportResponse(BaseModel):
    file_b64: str

# ---------- Helpers ----------
def _norm_rgba(color_int: int):
    # PyMuPDF colors are floats already on spans; but in some cases it’s int.
    # Keep a guard.
    try:
        r, g, b = color_int
        return [float(r), float(g), float(b)]
    except Exception:
        return [0.0, 0.0, 0.0]

def _span_bbox(span):
    # span has bbox [x0, y0, x1, y1]
    x0, y0, x1, y1 = span["bbox"]
    return x0, y0, x1 - x0, y1 - y0

def _font_flags_to_style(span):
    # PyMuPDF text dict includes "flags"
    flags = span.get("flags", 0)
    bold = bool(flags & 0b1000000) or "Bold" in span.get("font", "")
    italic = bool(flags & 0b0010000) or ("Italic" in span.get("font", "") or "Oblique" in span.get("font", ""))
    return bold, italic

# ---------- API ----------
@app.post("/analyze", response_model=AnalyzeResponse)
def analyze(req: AnalyzeRequest):
    pdf_bytes = base64.b64decode(req.file_b64)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    pno = max(0, req.page - 1)
    page = doc[pno]
    pw, ph = page.rect.width, page.rect.height

    # PyMuPDF page text as a structure
    text = page.get_text("dict")  # blocks / lines / spans
    sx1, sy1 = req.rect.x, req.rect.y
    sx2, sy2 = sx1 + req.rect.w, sy1 + req.rect.h

    spans_out: List[SpanOut] = []
    for block in text.get("blocks", []):
        if block.get("type", 0) != 0:
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                x, y, w, h = _span_bbox(span)
                # intersect (top-left system in PyMuPDF)
                if not (x + w < sx1 or x > sx2 or y + h < sy1 or y > sy2):
                    r, g, b = span.get("color", (0, 0, 0))
                    bold, italic = _font_flags_to_style(span)
                    font_xref = span.get("font_xref", 0)  # PyMuPDF provides this
                    spans_out.append(SpanOut(
                        text=span.get("text", ""),
                        x=float(x), y=float(y), w=float(w), h=float(h),
                        size=float(span.get("size", 11.0)),
                        color=[float(r), float(g), float(b)],
                        font_name=span.get("font", ""),
                        bold=bold, italic=italic,
                        font_xref=int(font_xref or 0),
                    ))

    # (Optional) include font metadata map to help the client list what’s available
    # Also proves font extraction is possible
    fonts = {}
    for xref, fdict in doc.get_page_fonts(pno):
        fonts[str(xref)] = {
            "name": fdict.get("name", ""),
            "is_embedded": fdict.get("embedded", False),
            "is_ttf": fdict.get("type", "").lower().find("truetype") >= 0 or fdict.get("type", "").lower().find("opentype") >= 0,
            "type": fdict.get("type", ""),
        }

    return AnalyzeResponse(page_width=pw, page_height=ph, spans=spans_out, fonts=fonts)

@app.post("/export", response_model=ExportResponse)
def export(req: ExportRequest):
    pdf_bytes = base64.b64decode(req.file_b64)
    doc = fitz.open(stream=pdf_bytes, filetype="pdf")

    # cache extracted fonts (xref -> fitz.Font instance)
    font_cache: Dict[int, fitz.Font] = {}

    for b in req.blocks:
        pno = max(0, b.page - 1)
        page = doc[pno]

        # get or make font
        fnt = font_cache.get(b.font_xref)
        if fnt is None:
            try:
                # extract font file from xref
                fontfile, ext, _ = doc.extract_font(b.font_xref)
                # ext is like 'ttf' / 'otf' / None
                # load font from buffer
                fnt = fitz.Font(buffer=fontfile)
            except Exception:
                # fallback to built-in if extraction fails
                fnt = fitz.Font("Times-Roman")
            font_cache[b.font_xref] = fnt

        # draw multi-paragraph text with custom line height & tracking
        # We'll break the text ourselves and place lines.
        text = b.text or ""
        lines = text.split("\n")
        x = float(b.x)
        y = float(b.y)
        max_w = float(b.width)
        lh = float(b.line_height or (b.size * 1.35))
        track = float(b.tracking or 0.0)  # pt per char

        # Use a text box to wrap, then redraw line-by-line to enforce tracking.
        # First, let PyMuPDF wrap to know line breaks approx:
        tb = fitz.TextWriter(page.rect)
        # Instead of TextWriter (no tracking), we can call page.insert_textbox progressively.
        remaining = "\n".join(lines)

        # We'll implement a simple wrap using PyMuPDF’s measuring:
        def wrap_line(s: str):
            if not s:
                return [""]
            words = s.split(" ")
            out, cur = [], ""
            for w in words:
                test = (cur + (" " if cur else "") + w)
                wpt = page.get_text_length(test, font=fnt, fontsize=b.size) + (max(0, len(test)-1) * track)
                if wpt <= max_w or cur == "":
                    cur = test
                else:
                    out.append(cur)
                    cur = w
            if cur:
                out.append(cur)
            return out

        # Final draw loop
        for para in lines:
            wrapped = wrap_line(para)
            for line in wrapped:
                if line == "":
                    y += lh
                    continue
                # draw each char with manual tracking
                cursor_x = x
                for ch in line:
                    page.insert_text(
                        fitz.Point(cursor_x, y + b.size),  # PyMuPDF uses top-left y
                        ch,
                        font=fnt,
                        fontsize=b.size,
                        color=(b.color[0], b.color[1], b.color[2]),
                    )
                    # advance
                    aw = page.get_text_length(ch, font=fnt, fontsize=b.size)
                    cursor_x += aw + track
                y += lh
            # small paragraph spacing
            y += lh * 0.15

    out = doc.tobytes()
    return ExportResponse(file_b64=base64.b64encode(out).decode("ascii"))
