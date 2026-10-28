import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const directory = 'artifacts/browser-extension';
const local = [],
  central = [];
let offset = 0;
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
for (const file of [
  'LICENSE',
  'background.js',
  'bridge.js',
  'manifest.json',
  'popup.css',
  'popup.html',
]) {
  const name = Buffer.from(file),
    bytes = await readFile(directory + '/' + file),
    compressed = deflateRawSync(bytes);
  const crc = crc32(bytes),
    header = Buffer.alloc(30),
    entry = Buffer.alloc(46);
  header.writeUInt32LE(0x04034b50);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(33, 12);
  header.writeUInt32LE(crc, 14);
  header.writeUInt32LE(compressed.length, 18);
  header.writeUInt32LE(bytes.length, 22);
  header.writeUInt16LE(name.length, 26);
  entry.writeUInt32LE(0x02014b50);
  entry.writeUInt16LE(20, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(8, 10);
  entry.writeUInt16LE(33, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(compressed.length, 20);
  entry.writeUInt32LE(bytes.length, 24);
  entry.writeUInt16LE(name.length, 28);
  entry.writeUInt32LE(offset, 42);
  local.push(header, name, compressed);
  central.push(entry, name);
  offset += header.length + name.length + compressed.length;
}
const index = Buffer.concat(central),
  end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50);
end.writeUInt16LE(central.length / 2, 8);
end.writeUInt16LE(central.length / 2, 10);
end.writeUInt32LE(index.length, 12);
end.writeUInt32LE(offset, 16);
const archive = Buffer.concat([...local, index, end]);
await mkdir('dist/downloads', { recursive: true });
await writeFile('artifacts/VideoSreeeen-SourceHelper.zip', archive);
await writeFile('dist/downloads/VideoSreeeen-SourceHelper.zip', archive);
console.log(
  JSON.stringify({
    file: 'VideoSreeeen-SourceHelper.zip',
    bytes: archive.length,
    sha256: createHash('sha256').update(archive).digest('hex'),
  }),
);
