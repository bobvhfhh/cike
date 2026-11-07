'use strict';
const fs = require('fs');
const path = require('path');
const packager = require('electron-packager');
const { downloadChromium } = require('../electron/chromium');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');

function windowsIcon() {
  // Reuse the original artwork embedded in the macOS icon; no redesign.
  const source = fs.readFileSync(path.join(root, 'electron', 'assets', 'icon.icns'));
  let png;
  for (let offset = 8; offset + 8 <= source.length;) {
    const length = source.readUInt32BE(offset + 4);
    if (length < 8 || offset + length > source.length) throw new Error('Invalid source icon');
    if (source.toString('ascii', offset, offset + 4) === 'ic08') {
      png = source.subarray(offset + 8, offset + length);
      break;
    }
    offset += length;
  }
  if (!png) throw new Error('Original 256px icon not found');
  const header = Buffer.alloc(22);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(header.length, 18);
  const icon = path.join(root, 'electron', 'assets', 'icon.ico');
  fs.writeFileSync(icon, Buffer.concat([header, png]));
  return icon;
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('Build on Windows x64');
  }
  const build = path.join(root, '.windows-build');
  const exe = await downloadChromium(build, ({ pct }) => {
    if (pct === 100) console.log('Chromium download complete');
  });
  console.log('Bundling Chromium:', exe);
  const outputs = await packager({
    dir: root,
    name: 'CIKE',
    platform: 'win32',
    arch: 'x64',
    icon: windowsIcon(),
    out: path.join(root, 'dist'),
    overwrite: true,
    prune: true,
    asar: true,
    ignore: [/^\/(test|scripts|docs|\.github|\.git|\.windows-build|\.browsers|dist|data|README-WINDOWS\.md)(\/|$)/, /\.(zip|log)$/i],
    extraResource: [path.join(build, 'browsers', 'chromium')],
    ...(process.env.CIKE_ELECTRON_ZIP_DIR ? { electronZipDir: process.env.CIKE_ELECTRON_ZIP_DIR } : {}),
    win32metadata: { ProductName: 'CIKE', FileDescription: 'CIKE' },
  });
  fs.copyFileSync(path.join(root, 'README-WINDOWS.md'), path.join(outputs[0], 'README-WINDOWS.md'));
  const filename = `CIKE-${require('../package.json').version}-windows-x64.zip`;
  const archive = path.join(root, 'dist', filename);
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'),
    ['-a', '-cf', archive, '-C', path.dirname(outputs[0]), path.basename(outputs[0])], { windowsHide: true });
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(archive)) hash.update(chunk);
  fs.writeFileSync(path.join(root, 'dist', 'SHA256SUMS.txt'), `${hash.digest('hex')}  ${filename}\n`);
  console.log('Windows app:', path.join(outputs[0], 'CIKE.exe'));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
