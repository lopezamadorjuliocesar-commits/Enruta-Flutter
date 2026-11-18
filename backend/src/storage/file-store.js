'use strict';
// Archivos en disco local (./storage). Nunca se guardan binarios en SQLite. Las rutas se resuelven dentro de la raíz (anti path traversal).
const fs = require('fs');
const path = require('path');

const MAGIC = [
  { mime: 'image/png', ext: 'png', test: (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];
const detectImage = (buf) => MAGIC.find((m) => m.test(buf)) || null;

function createFileStore(rootDir) {
  const root = path.resolve(rootDir);
  const resolve = (rel) => { const full = path.resolve(root, rel); if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Ruta de archivo fuera del almacenamiento.'); return full; };
  return {
    root,
    async save(rel, buffer) { const full = resolve(rel); await fs.promises.mkdir(path.dirname(full), { recursive: true }); await fs.promises.writeFile(full, buffer); return rel; },
    async read(rel) { return fs.promises.readFile(resolve(rel)); },
    async remove(rel) { await fs.promises.rm(resolve(rel), { force: true }); },
  };
}
module.exports = { createFileStore, detectImage };
