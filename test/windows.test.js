'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cftPlatform, downloadUrl, findExecutable, chromiumStatus } = require('../electron/chromium');
const { privateDirectory, writePrivate } = require('../src/privatefiles');

test('Chromium download mapping covers supported Windows 11 x64 builds', () => {
  assert.equal(cftPlatform('win32', 'x64'), 'win64');
  assert.match(downloadUrl('win32', 'x64'), /\/win64\/chrome-win64\.zip$/);
  assert.throws(() => cftPlatform('win32', 'arm64'), /不支持/);
});

test('Windows Chromium discovery finds chrome.exe in nested CfT archives', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-win-chrome-'));
  try {
    const exe = path.join(root, 'chrome-win64', 'chrome.exe');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.writeFileSync(exe, 'fixture');
    assert.equal(findExecutable(root), exe);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Windows data files use inherited user ACLs and Chromium markers recover from invalid entries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-win-data-'));
  const previousPlatform = process.platform;
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    const data = path.join(root, '中文 路径', 'CIKE');
    privateDirectory(data);
    writePrivate(path.join(data, 'marker.txt'), 'not-an-executable\n');
    const status = await chromiumStatus(data);
    assert.equal(status.installed, false);
  } finally {
    Object.defineProperty(process, 'platform', { value: previousPlatform, configurable: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
