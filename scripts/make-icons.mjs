// Draws the TrueDiff icon (a filter: three bars getting shorter, on GitHub green) as PNGs.
// No image libraries: a tiny PNG encoder with 4x4 supersampling for anti-aliasing.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const BG = [31, 136, 61]; // #1f883d
const FG = [255, 255, 255];

function insideRoundRect(x, y, x0, y0, x1, y1, r) {
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const SS = 4;
  // Geometry in unit space.
  const bars = [
    { y: 0.3, w: 0.62 },
    { y: 0.5, w: 0.42 },
    { y: 0.7, w: 0.2 },
  ];
  const barH = 0.11;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (pxl + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!insideRoundRect(x, y, 0, 0, 1, 1, 0.22)) continue;
          bg++;
          if (bars.some((b) => insideRoundRect(x, y, 0.5 - b.w / 2, b.y - barH / 2, 0.5 + b.w / 2, b.y + barH / 2, barH / 2))) fg++;
        }
      }
      const n = SS * SS;
      const a = bg / n;
      const t = bg ? fg / bg : 0;
      const i = (py * size + pxl) * 4;
      for (let c = 0; c < 3; c++) px[i + c] = Math.round(BG[c] * (1 - t) + FG[c] * t);
      px[i + 3] = Math.round(a * 255);
    }
  }
  return px;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `icon-${size}.png`), png(size, draw(size)));
}
console.log(`Icons written to ${outDir}`);
