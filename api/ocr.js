// /api/ocr.js
import Tesseract from 'tesseract.js';

export default async function handler(req, res) {
  try {
    const { image } = await req.json?.() || req.body;
    if (!image) return res.status(400).json({ error: 'No image data' });

    console.log('🧠 Running OCR via Tesseract...');
    const result = await Tesseract.recognize(image, 'eng', {
      logger: m => console.log(m.status, m.progress)
    });

    const text = result.data.text || '';
    const words = result.data.words || [];

    // Map words to pdf.js-like items
    const items = words.map(w => ({
      str: w.text,
      x: w.bbox.x0,
      y: w.bbox.y0,
      w: w.bbox.x1 - w.bbox.x0,
      h: w.bbox.y1 - w.bbox.y0,
      fontName: 'Times-Roman',
      colorHex: '#000000',
      sizePx: Math.max(10, w.bbox.y1 - w.bbox.y0),
      fauxBold: 0,
      skewDeg: 0
    }));

    res.status(200).json({ items });
  } catch (err) {
    console.error('OCR handler error:', err);
    res.status(500).json({ error: err.message || 'OCR failed' });
  }
}
