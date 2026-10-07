import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function createPng(width, height, r, g, b, a) {
  const rawData = [];
  for (let y = 0; y < height; y++) {
    rawData.push(0); // filter: none
    for (let x = 0; x < width; x++) {
      rawData.push(r, g, b, a);
    }
  }
  const compressed = zlib.deflateSync(Buffer.from(rawData));

  function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
      crc ^= buf[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (-(crc & 1) & 0xedb88320);
      }
    }
    return (crc ^ -1) >>> 0;
  }

  function chunk(type, data) {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const body = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(body), 0);
    return Buffer.concat([len, body, crcBuf]);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function createIco(width, height) {
  const pixelBytes = width * height * 4;
  const maskBytes = ((width + 31) >> 5) * 4 * height;
  const imageSize = 40 + pixelBytes + maskBytes;

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // ICO
  header.writeUInt16LE(1, 4); // 1 image

  const dir = Buffer.alloc(16);
  dir[0] = width === 256 ? 0 : width;
  dir[1] = height === 256 ? 0 : height;
  dir[2] = 0; // color count
  dir[3] = 0; // reserved
  dir.writeUInt16LE(1, 4); // planes
  dir.writeUInt16LE(32, 6); // bpp
  dir.writeUInt32LE(imageSize, 8);
  dir.writeUInt32LE(22, 12); // offset

  const bih = Buffer.alloc(40);
  bih.writeUInt32LE(40, 0); // biSize
  bih.writeInt32LE(width, 4);
  bih.writeInt32LE(height * 2, 8); // double height for mask
  bih.writeUInt16LE(1, 12); // biPlanes
  bih.writeUInt16LE(32, 14); // biBitCount
  bih.writeUInt32LE(0, 16); // BI_RGB
  bih.writeUInt32LE(pixelBytes, 20);

  const pixels = Buffer.alloc(pixelBytes);
  for (let i = 0; i < pixelBytes; i += 4) {
    pixels[i] = 0xff; // B
    pixels[i + 1] = 0x2b; // G
    pixels[i + 2] = 0x2b; // R
    pixels[i + 3] = 0xff; // A
  }

  const mask = Buffer.alloc(maskBytes, 0); // 0 = opaque

  return Buffer.concat([header, dir, bih, pixels, mask]);
}

const iconsDir = path.resolve('apps/desktop/src-tauri/icons');
fs.mkdirSync(iconsDir, { recursive: true });

fs.writeFileSync(path.join(iconsDir, '32x32.png'), createPng(32, 32, 0x2b, 0x2b, 0xff, 0xff));
fs.writeFileSync(path.join(iconsDir, '128x128.png'), createPng(128, 128, 0x2b, 0x2b, 0xff, 0xff));
fs.writeFileSync(
  path.join(iconsDir, '128x128@2x.png'),
  createPng(256, 256, 0x2b, 0x2b, 0xff, 0xff),
);
fs.writeFileSync(path.join(iconsDir, 'icon.png'), createPng(512, 512, 0x2b, 0x2b, 0xff, 0xff));
fs.writeFileSync(path.join(iconsDir, 'icon.ico'), createIco(32, 32));
fs.writeFileSync(path.join(iconsDir, 'icon.icns'), createPng(128, 128, 0x2b, 0x2b, 0xff, 0xff));

console.log('Icons generated successfully in', iconsDir);
