'use strict';
const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');
const yauzl = require('yauzl');

async function extractBrowserZip(filename, destination) {
  const root = path.resolve(destination);
  const archive = await yauzl.openPromise(filename, { strictFileNames: true });
  let total = 0;
  try {
    for await (const entry of archive.eachEntry()) {
      const parts = entry.fileName.replace(/\/$/, '').split('/');
      if (parts.some(part => !part || part === '.' || part === '..' ||
        /[<>:"\\|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
        throw new Error('内核压缩包包含不安全的路径');
      }
      const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
      if (mode && mode !== 0o100000 && mode !== 0o040000) {
        throw new Error('内核压缩包不能包含符号链接或特殊文件');
      }
      total += entry.uncompressedSize;
      if (total > 3 * 1024 * 1024 * 1024) throw new Error('内核解压后异常过大');
      const target = path.join(root, ...parts);
      if (path.relative(root, target).startsWith('..')) throw new Error('内核压缩包包含不安全的路径');
      if (entry.fileName.endsWith('/')) await fs.promises.mkdir(target, { recursive: true });
      else {
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await pipeline(await archive.openReadStreamPromise(entry), fs.createWriteStream(target, { flags: 'wx' }));
      }
    }
  } finally { archive.close(); }
}

module.exports = { extractBrowserZip };
