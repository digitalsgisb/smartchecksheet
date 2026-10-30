import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crc = b => { let c = 0xffffffff; for (const byte of b) { c ^= byte; for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) { const t = Buffer.from(type), n = Buffer.alloc(4), checksum = Buffer.alloc(4); n.writeUInt32BE(data.length); checksum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([n, t, data, checksum]); }
function inside(x, y, p) { let yes = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { if ((p[i][1] > y) !== (p[j][1] > y) && x < (p[j][0] - p[i][0]) * (y - p[i][1]) / (p[j][1] - p[i][1]) + p[i][0]) yes = !yes; } return yes; }
function distance(x, y, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(x - a[0] - t * dx, y - a[1] - t * dy); }
function icon(size, maskable = false) {
  const raw = Buffer.alloc(size * (size * 4 + 1)); const poly = [[16, 43], [16, 23], [26, 29], [26, 19], [37, 26], [37, 14], [47, 14], [47, 43]];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let color = [0, 0, 0, 0];
    for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
      let px = (x + (sx + .5) / 2) / size * 64, py = (y + (sy + .5) / 2) / size * 64;
      const rounded = maskable || Math.hypot(Math.max(18 - px, 0, px - 46), Math.max(18 - py, 0, py - 46)) <= 18;
      let c = rounded ? [0, 0, 0, 255] : [0, 0, 0, 0];
      if (maskable) { px = (px - 32) / .8 + 32; py = (py - 32) / .8 + 32; }
      if (inside(px, py, poly)) c = [255, 255, 255, 255];
      if (distance(px, py, [24, 40], [30, 45]) < 2 || distance(px, py, [30, 45], [43, 30]) < 2) c = [0, 0, 0, 255];
      color = color.map((v, i) => v + c[i] / 4);
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4; color.forEach((v, i) => raw[offset + i] = Math.round(v));
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
mkdirSync('public/icons', { recursive: true });
writeFileSync('public/icons/icon-192.png', icon(192));
writeFileSync('public/icons/icon-512.png', icon(512));
writeFileSync('public/icons/maskable-512.png', icon(512, true));
console.log('Generated 192px, 512px and maskable PWA icons.');
