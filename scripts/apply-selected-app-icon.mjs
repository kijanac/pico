#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { inflateSync, deflateSync } from "node:zlib";

const root = join(dirname(new URL(import.meta.url).pathname), "..");
const source = join(root, "pi-mobile/assets/app-icon.png");
const iosIcon = join(root, "pi-mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png");
const androidRes = join(root, "pi-mobile/android/app/src/main/res");

function crcTable() {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
}
const CRC = crcTable();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function readPng(path) {
  const b = readFileSync(path);
  if (b.slice(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`not a PNG: ${path}`);
  let off = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idats = [];
  while (off < b.length) {
    const len = b.readUInt32BE(off);
    const type = b.slice(off + 4, off + 8).toString("ascii");
    const data = b.slice(off + 8, off + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error("only 8-bit PNGs are supported");
      colorType = data[9];
      if (![2, 6].includes(colorType)) throw new Error(`unsupported PNG color type ${colorType}`);
    } else if (type === "IDAT") {
      idats.push(data);
    }
    off += 12 + len;
  }
  const channels = colorType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idats));
  const out = new Uint8ClampedArray(width * height * 4);
  const stride = width * channels + 1;
  for (let y = 0; y < height; y++) {
    const filter = raw[y * stride];
    if (filter !== 0) throw new Error("only PNG filter type 0 is supported by this lightweight script");
    for (let x = 0; x < width; x++) {
      const si = y * stride + 1 + x * channels;
      const di = (y * width + x) * 4;
      out[di] = raw[si];
      out[di + 1] = raw[si + 1];
      out[di + 2] = raw[si + 2];
      out[di + 3] = channels === 4 ? raw[si + 3] : 255;
    }
  }
  return { width, height, rgba: out };
}

function sampleBilinear(image, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const result = [0, 0, 0, 0];
  for (let yy = 0; yy <= 1; yy++) {
    for (let xx = 0; xx <= 1; xx++) {
      const sx = xx ? x1 : x0;
      const sy = yy ? y1 : y0;
      const w = (xx ? tx : 1 - tx) * (yy ? ty : 1 - ty);
      const i = (sy * image.width + sx) * 4;
      result[0] += image.rgba[i] * w;
      result[1] += image.rgba[i + 1] * w;
      result[2] += image.rgba[i + 2] * w;
      result[3] += image.rgba[i + 3] * w;
    }
  }
  return result.map(Math.round);
}

function resize(image, size) {
  const rgba = Buffer.alloc(size * size * 4);
  const scaleX = image.width / size;
  const scaleY = image.height / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = sampleBilinear(image, (x + 0.5) * scaleX - 0.5, (y + 0.5) * scaleY - 0.5);
      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = a;
    }
  }
  return { width: size, height: size, rgba };
}

function pngRgb(image) {
  const raw = Buffer.alloc((image.width * 3 + 1) * image.height);
  for (let y = 0; y < image.height; y++) {
    const row = y * (image.width * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < image.width; x++) {
      const si = (y * image.width + x) * 4;
      const di = row + 1 + x * 3;
      raw[di] = image.rgba[si];
      raw[di + 1] = image.rgba[si + 1];
      raw[di + 2] = image.rgba[si + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const image = readPng(source);
if (image.width !== 1024 || image.height !== 1024) throw new Error("selected app icon must be 1024x1024");

writeFileSync(iosIcon, pngRgb(image));

const densities = [
  ["mipmap-mdpi", 48, 108],
  ["mipmap-hdpi", 72, 162],
  ["mipmap-xhdpi", 96, 216],
  ["mipmap-xxhdpi", 144, 324],
  ["mipmap-xxxhdpi", 192, 432],
];
for (const [dir, launcherSize, foregroundSize] of densities) {
  const fullDir = join(androidRes, dir);
  mkdirSync(fullDir, { recursive: true });
  const launcher = pngRgb(resize(image, launcherSize));
  writeFileSync(join(fullDir, "ic_launcher.png"), launcher);
  writeFileSync(join(fullDir, "ic_launcher_round.png"), launcher);
  writeFileSync(join(fullDir, "ic_launcher_foreground.png"), pngRgb(resize(image, foregroundSize)));
}

writeFileSync(join(androidRes, "values/ic_launcher_background.xml"), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#C76F4A</color>\n</resources>\n`);

console.log("Applied selected app icon to iOS and Android launcher assets.");
