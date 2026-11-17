// Generates the source artwork without any image dependencies:
//   scripts/app-icon.png   (1024px, fed to `npm run tauri icon`)
//   src-tauri/icons/tray.png (44px black template image for the menu bar)
// Run: node scripts/make-icons.mjs && npm run tauri icon scripts/app-icon.png
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  let c, crc = ~0;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return ~crc >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const S = 3; // supersampling for smooth edges
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
        const p = pixel((x + (sx + 0.5) / S) / size, (y + (sy + 0.5) / S) / size);
        r += p[0] * p[3]; g += p[1] * p[3]; b += p[2] * p[3]; a += p[3];
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (a > 0) { raw[o] = r / a; raw[o + 1] = g / a; raw[o + 2] = b / a; }
      raw[o + 3] = Math.round((a / (S * S)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Shapes in unit coordinates (0..1).
const inRoundRect = (x, y, m, r) => {
  const dx = Math.max(m + r - x, 0, x - (1 - m - r));
  const dy = Math.max(m + r - y, 0, y - (1 - m - r));
  return x >= m && x <= 1 - m && y >= m && y <= 1 - m && dx * dx + dy * dy <= r * r;
};
// Person silhouette: head + shoulders, centred at cx, scaled by s.
const inPerson = (x, y, cx = 0.5, cy = 0.5, s = 1) => {
  const px = (x - cx) / s, py = (y - cy) / s;
  const head = px * px + (py + 0.13) * (py + 0.13) <= 0.105 * 0.105;
  const body = (px * px) / (0.2 * 0.2) + ((py - 0.2) * (py - 0.2)) / (0.19 * 0.19) <= 1 && py <= 0.2;
  return head || body;
};

writeFileSync("scripts/app-icon.png", png(1024, (x, y) => {
  if (!inRoundRect(x, y, 0.1, 0.18)) return [0, 0, 0, 0];
  if (inPerson(x, y, 0.5, 0.5, 1.15)) return [255, 255, 255, 1];
  const t = y; // vertical gradient, top → bottom
  return [Math.round(64 - 30 * t), Math.round(140 - 50 * t), Math.round(255 - 35 * t), 1];
}));
writeFileSync("src-tauri/icons/tray.png", png(44, (x, y) =>
  inPerson(x, y, 0.5, 0.48, 1.9) ? [0, 0, 0, 1] : [0, 0, 0, 0]));
console.log("icons written");
