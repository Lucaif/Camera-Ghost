// GIF89a encoder ported from the original WebView implementation in timelapse.tsx.
// Floyd-Steinberg dithering, 216-color cube + 40 grays, LZW with table reset.

const PALETTE: number[] = (() => {
  const p: number[] = [];
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 6; g++)
      for (let b = 0; b < 6; b++)
        p.push(Math.round((r * 255) / 5), Math.round((g * 255) / 5), Math.round((b * 255) / 5));
  for (let i = 0; i < 40; i++) {
    const v = Math.round((i * 255) / 39);
    p.push(v, v, v);
  }
  while (p.length < 768) p.push(0);
  return p;
})();

const LUT: Uint8Array = (() => {
  const lut = new Uint8Array(32 * 32 * 32);
  for (let ri = 0; ri < 32; ri++) {
    for (let gi = 0; gi < 32; gi++) {
      for (let bi = 0; bi < 32; bi++) {
        const r = ri * 8, g = gi * 8, b = bi * 8;
        let best = 0, bestD = Infinity;
        for (let i = 0; i < 256; i++) {
          const dr = r - PALETTE[i * 3];
          const dg = g - PALETTE[i * 3 + 1];
          const db = b - PALETTE[i * 3 + 2];
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) { bestD = d; best = i; if (d === 0) break; }
        }
        lut[(ri << 10) | (gi << 5) | bi] = best;
      }
    }
  }
  return lut;
})();

function nearestColor(r: number, g: number, b: number): number {
  return LUT[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
}

class ByteArray {
  data: number[] = [];
  writeByte(b: number) { this.data.push(b & 0xff); }
  writeShort(s: number) { this.writeByte(s); this.writeByte(s >> 8); }
  writeBytes(a: number[] | Uint8Array, off = 0, len?: number) {
    const length = len ?? a.length;
    for (let i = off; i < off + length; i++) this.writeByte(a[i]);
  }
  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.data);
  }
}

function quantize(pixels: Uint8ClampedArray, w: number, h: number): Uint8Array {
  const buf = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    buf[i * 3] = pixels[i * 4];
    buf[i * 3 + 1] = pixels[i * 4 + 1];
    buf[i * 3 + 2] = pixels[i * 4 + 2];
  }
  const indexed = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 3;
      const r = Math.max(0, Math.min(255, (buf[idx] + 0.5) | 0));
      const g = Math.max(0, Math.min(255, (buf[idx + 1] + 0.5) | 0));
      const b = Math.max(0, Math.min(255, (buf[idx + 2] + 0.5) | 0));
      const ci = nearestColor(r, g, b);
      indexed[y * w + x] = ci;
      const er = r - PALETTE[ci * 3];
      const eg = g - PALETTE[ci * 3 + 1];
      const eb = b - PALETTE[ci * 3 + 2];
      if (x + 1 < w) {
        buf[idx + 3] += er * 0.4375;
        buf[idx + 4] += eg * 0.4375;
        buf[idx + 5] += eb * 0.4375;
      }
      if (y + 1 < h) {
        const row = ((y + 1) * w + x) * 3;
        if (x > 0) {
          buf[row - 3] += er * 0.1875;
          buf[row - 2] += eg * 0.1875;
          buf[row - 1] += eb * 0.1875;
        }
        buf[row] += er * 0.3125;
        buf[row + 1] += eg * 0.3125;
        buf[row + 2] += eb * 0.3125;
        if (x + 1 < w) {
          buf[row + 3] += er * 0.0625;
          buf[row + 4] += eg * 0.0625;
          buf[row + 5] += eb * 0.0625;
        }
      }
    }
  }
  return indexed;
}

function lzwEncode(pixels: Uint8Array, minCodeSize: number, out: ByteArray) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  out.writeByte(minCodeSize);

  const bits = new ByteArray();
  let bitBuf = 0, bitLen = 0;
  const writeBits = (code: number, len: number) => {
    bitBuf |= code << bitLen; bitLen += len;
    while (bitLen >= 8) { bits.writeByte(bitBuf & 0xff); bitBuf >>>= 8; bitLen -= 8; }
  };

  const table = new Int32Array(4096 * 256).fill(-1);
  let codeSize = minCodeSize + 1;
  let nextCode = endCode + 1;
  const resetTable = () => { table.fill(-1); codeSize = minCodeSize + 1; nextCode = endCode + 1; };

  writeBits(clearCode, codeSize);
  let str = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const c = pixels[i];
    const key = str * 256 + c;
    const entry = table[key];
    if (entry >= 0) {
      str = entry;
    } else {
      writeBits(str, codeSize);
      if (nextCode < 4096) {
        table[key] = nextCode++;
        if (nextCode > (1 << codeSize) && codeSize < 12) codeSize++;
      } else {
        writeBits(clearCode, codeSize);
        resetTable();
      }
      str = c;
    }
  }
  writeBits(str, codeSize);
  writeBits(endCode, codeSize);
  if (bitLen > 0) bits.writeByte(bitBuf & 0xff);

  const data = bits.data;
  let j = 0;
  while (j < data.length) {
    const bs = Math.min(255, data.length - j);
    out.writeByte(bs);
    for (let k = 0; k < bs; k++) out.writeByte(data[j++]);
  }
  out.writeByte(0);
}

class GifEncoder {
  private w: number;
  private h: number;
  private delay: number;
  private buf = new ByteArray();
  private first = true;
  constructor(w: number, h: number, delayMs: number) {
    this.w = w;
    this.h = h;
    this.delay = Math.round(delayMs / 10); // GIF uses 1/100s
    this.buf.writeBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
  }
  addFrame(imageData: ImageData) {
    const indexed = quantize(imageData.data, this.w, this.h);
    if (this.first) {
      this.first = false;
      this.buf.writeShort(this.w); this.buf.writeShort(this.h);
      this.buf.writeByte(0xf7); this.buf.writeByte(0); this.buf.writeByte(0);
      for (let i = 0; i < 768; i++) this.buf.writeByte(PALETTE[i]);
      // Netscape loop
      this.buf.writeBytes([0x21, 0xff, 0x0b, 78, 69, 84, 83, 67, 65, 80, 69, 50, 46, 48, 0x03, 0x01, 0, 0, 0]);
    }
    this.buf.writeBytes([0x21, 0xf9, 0x04, 0x00]);
    this.buf.writeShort(this.delay);
    this.buf.writeByte(0); this.buf.writeByte(0);
    this.buf.writeByte(0x2c);
    this.buf.writeShort(0); this.buf.writeShort(0);
    this.buf.writeShort(this.w); this.buf.writeShort(this.h);
    this.buf.writeByte(0);
    lzwEncode(indexed, 8, this.buf);
  }
  finish(): Uint8Array {
    this.buf.writeByte(0x3b);
    return this.buf.toUint8Array();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

const nextTick = () => new Promise<void>(r => setTimeout(r, 0));

export async function encodeGif(
  frameSources: string[],
  size: number,
  delayMs: number,
  onProgress?: (pct: number) => void
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const encoder = new GifEncoder(size, size, delayMs);

  for (let i = 0; i < frameSources.length; i++) {
    onProgress?.(Math.round((i / frameSources.length) * 100));
    try {
      const img = await loadImage(frameSources[i]);
      ctx.clearRect(0, 0, size, size);
      // contain-style draw (centered)
      const ratio = Math.min(size / img.width, size / img.height);
      const dw = img.width * ratio;
      const dh = img.height * ratio;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      encoder.addFrame(ctx.getImageData(0, 0, size, size));
    } catch {
      // skip broken frames
    }
    await nextTick();
  }

  onProgress?.(99);
  const bytes = encoder.finish();
  return new Blob([bytes as BlobPart], { type: 'image/gif' });
}
