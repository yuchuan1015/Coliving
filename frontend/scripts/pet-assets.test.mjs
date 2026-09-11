import { test } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { inspectRgbaPng, checkPetAssets } from "./pet-assets-check.mjs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Small synthetic decoder fixtures, not pet art. Include real PNG chunk checksums.
const crc32 = bytes => {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (kind, data) => {
  const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(kind, 4); data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4); return bytes;
};
function png(filter, alpha = (x, y) => x === 1 && y === 1 ? 255 : x === 2 && y === 2 ? 128 : 0, color = 6) {
  const width = 4, height = 4, bpp = color === 6 ? 4 : 3, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = color;
  let previous = Buffer.alloc(width * bpp); const scanlines = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(width * bpp), encoded = Buffer.alloc(row.length + 1); encoded[0] = filter;
    for (let x = 0; x < width; x++) { row[x * bpp] = 70; row[x * bpp + 1] = 100; row[x * bpp + 2] = 150; if (bpp === 4) row[x * bpp + 3] = alpha(x, y); }
    for (let i = 0; i < row.length; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = previous[i], c = i >= bpp ? previous[i - bpp] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = [0, a, b, Math.floor((a + b) / 2), pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      encoded[i + 1] = (row[i] - predict) & 255;
    }
    scanlines.push(encoded); previous = row;
  }
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(scanlines))), chunk("IEND", Buffer.alloc(0))]);
}
for (const filter of [0, 1, 2, 3, 4]) test(`pet PNG alpha inspection decodes filter ${filter}`, () => {
  const stats = inspectRgbaPng(png(filter));
  assert.equal(stats.transparent_pixels, 14); assert.equal(stats.opaque_pixels, 1); assert.equal(stats.partial_pixels, 1);
});
test("pet cutout gate rejects RGB, all-opaque, all-empty and clipped art", () => {
  assert.throws(() => inspectRgbaPng(png(0, undefined, 2)), /RGBA/);
  assert.throws(() => inspectRgbaPng(png(0, () => 255)), /transparent background/);
  assert.throws(() => inspectRgbaPng(png(0, () => 0)), /opaque subject/);
  assert.throws(() => inspectRgbaPng(png(0, (x, y) => x === 0 && y === 0 ? 255 : 0)), /boundary/);
  assert.throws(() => inspectRgbaPng(png(0).subarray(0, 50)), /Truncated|IDAT/);
});
test("all 28 released pet assets are genuine padded transparent PNGs", () => {
  const report = checkPetAssets(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  assert.equal(report.count, 28);
});
