// Read-only release gate: verify actual PNG alpha, not just a drawn checkerboard.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { createHash } from "node:crypto";

export function inspectRgbaPng(bytes) {
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "PNG signature");
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR");
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert.ok(width > 0 && width <= 4096 && height > 0 && height <= 4096);
  assert.equal(bytes[24], 8, "Require 8-bit PNG");
  assert.equal(bytes[25], 6, "Require real RGBA, not opaque RGB");
  assert.deepEqual([...bytes.subarray(26, 29)], [0, 0, 0], "Non-interlaced standard PNG");
  const compressed = []; let ended = false;
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset), kind = bytes.toString("ascii", offset + 4, offset + 8);
    assert.ok(offset + 12 + length <= bytes.length, "Truncated PNG chunk");
    if (kind === "IDAT") compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (kind === "IEND") { ended = true; break; }
  }
  assert.ok(ended && compressed.length, "PNG must have IDAT and IEND");
  const stride = width * 4, expected = (stride + 1) * height;
  const raw = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected });
  assert.equal(raw.length, expected);
  let previous = Buffer.alloc(stride), zero = 0, partial = 0, opaque = 0, borderPixels = 0;
  for (let y = 0; y < height; y++) {
    const offset = y * (stride + 1), filter = raw[offset], row = Buffer.allocUnsafe(stride);
    assert.ok(filter <= 4, "Unsupported PNG filter");
    for (let i = 0; i < stride; i++) {
      const left = i >= 4 ? row[i - 4] : 0, up = previous[i], upperLeft = i >= 4 ? previous[i - 4] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      if (filter === 2) predictor = up;
      if (filter === 3) predictor = Math.floor((left + up) / 2);
      if (filter === 4) {
        const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
        predictor = a <= b && a <= c ? left : b <= c ? up : upperLeft;
      }
      row[i] = (raw[offset + 1 + i] + predictor) & 255;
    }
    for (let x = 0; x < width; x++) {
      const alpha = row[x * 4 + 3];
      if (alpha === 0) zero++; else if (alpha === 255) opaque++; else partial++;
      if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && alpha !== 0) borderPixels++;
    }
    previous = row;
  }
  assert.ok(zero > width * height * .1 && opaque > 0, "Both transparent background and opaque subject required");
  assert.equal(borderPixels, 0, "Artwork or matte reaches canvas boundary");
  return { width, height, transparent_pixels: zero, partial_pixels: partial, opaque_pixels: opaque, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

export function checkPetAssets(root) {
  const catalog = JSON.parse(readFileSync(resolve(root, "public/assets/pets/catalog.json"), "utf8"));
  assert.equal(catalog.schema_version, 1);
  assert.ok(typeof catalog.catalog_version === "string" && catalog.catalog_version.length <= 128);
  assert.equal(catalog.assets.length, 28);
  assert.equal(new Set(catalog.assets.map(a => a.asset_key)).size, 28);
  assert.equal(new Set(catalog.assets.map(a => a.image_url)).size, 28);
  const assets = catalog.assets.map(a => {
    assert.equal(a.published, true, `${a.asset_key} has not passed release QA`);
    assert.match(a.asset_key, /^[a-z]+(?:-[a-z]+)*-v1$/);
    assert.equal(a.image_url, `/assets/pets/v1/${a.asset_key.slice(0, -3)}.png`);
    assert.ok(typeof a.species === "string" && [...a.species].length > 0 && [...a.species].length <= 64);
    assert.ok(typeof a.emoji === "string" && [...a.emoji].length > 0 && [...a.emoji].length <= 8);
    const stats = inspectRgbaPng(readFileSync(resolve(root, "public", a.image_url.slice(1))));
    // 128px portrait at 3x; full-size 1254px masters are archived separately.
    assert.deepEqual([stats.width, stats.height], [384, 384]);
    assert.ok(stats.bytes < 400_000, "Pet thumbnail payload unexpectedly large");
    return { asset_key: a.asset_key, image_url: a.image_url, ...stats };
  });
  return { passed: true, catalog_version: catalog.catalog_version, count: assets.length, total_bytes: assets.reduce((sum, a) => sum + a.bytes, 0), assets };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkPetAssets(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
  console.log(JSON.stringify(process.argv.includes("--details") ? result : { passed: result.passed, count: result.count, total_bytes: result.total_bytes, catalog_version: result.catalog_version }, null, 2));
}
