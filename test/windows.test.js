'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const { PassThrough } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');
const browserFixture = { chromium: { launch: async () => ({
  version: () => '156.0.8078.4', close: async () => {},
}) } };

function load(relative, replacements = {}, extraProcess = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const localRequire = require('node:module').createRequire(filename);
  const module = { exports: {} };
  const wrapper = vm.runInNewContext(
    `(function(require, module, exports, __dirname, process) { ${fs.readFileSync(filename, 'utf8')}\n})`,
    { console, URL, Buffer, setTimeout, clearTimeout },
    { filename },
  );
  const mockRequire = name => replacements[name] || localRequire(name);
  mockRequire.resolve = localRequire.resolve;
  wrapper(mockRequire, module, module.exports,
    path.dirname(filename), { ...process, ...extraProcess });
  return module.exports;
}

function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-windows-test-'));
  t.after(() => {
    const target = path.resolve(dir);
    assert.equal(path.dirname(target), path.resolve(os.tmpdir()));
    assert.ok(path.basename(target).startsWith('cike-windows-test-'));
    fs.rmSync(target, { recursive: true, force: true });
  });
  return dir;
}

test('Windows uses bundled Chromium without altering the saved profile directory', async t => {
  const dir = temporary(t);
  const exe = path.join(dir, 'resources', 'chromium', 'chrome-win64', 'chrome.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'test fixture');
  const chromium = load('electron/chromium.js', { playwright: browserFixture }, {
    platform: 'win32', resourcesPath: path.join(dir, 'resources'),
  });
  const status = await chromium.chromiumStatus(path.join(dir, 'data'));
  assert.equal(status.installed, true);
  assert.equal(status.executable, exe);
  assert.equal(await chromium.downloadChromium(path.join(dir, 'data')), exe);
  assert.equal(fs.existsSync(path.join(dir, 'data')), false);
});

test('Existing downloaded Chromium keeps priority over the bundled copy', async t => {
  const dir = temporary(t);
  const exe = path.join(dir, 'custom chrome.exe');
  fs.writeFileSync(exe, 'test fixture');
  const chromium = load('electron/chromium.js', { playwright: browserFixture }, { platform: 'win32' });
  const marker = chromium.executableMarker(dir);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  fs.writeFileSync(marker, exe);
  assert.equal((await chromium.chromiumStatus(dir)).executable, exe);
});

test('Windows downloads through a redirect and extracts ZIP paths with spaces', {
  skip: process.platform !== 'win32',
}, async t => {
  const dir = temporary(t);
  const source = path.join(dir, "source with spaces & apostrophe'");
  fs.mkdirSync(path.join(source, 'chrome-win64'), { recursive: true });
  fs.writeFileSync(path.join(source, 'chrome-win64', 'chrome.exe'), 'test fixture');
  const zip = path.join(dir, 'fixture.zip');
  const tar = path.join(process.env.SystemRoot, 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-cf', zip, '-C', source, '.'], { windowsHide: true });
  const bytes = fs.readFileSync(zip);
  let requests = 0;
  const fakeHttps = {
    get(url, options, callback) {
      const request = new PassThrough();
      request.setTimeout = () => request;
      queueMicrotask(() => {
        const response = new PassThrough();
        requests++;
        response.statusCode = requests === 1 ? 302 : 200;
        response.headers = requests === 1
          ? { location: 'https://download.example.test/fixture.zip' }
          : { 'content-length': String(bytes.length) };
        callback(response);
        response.end(requests === 1 ? '' : bytes);
      });
      return request;
    },
  };
  const chromium = load('electron/chromium.js', { https: fakeHttps, playwright: browserFixture }, {
    platform: 'win32', resourcesPath: path.join(dir, 'no-resources'),
  });
  const data = path.join(dir, "data with spaces & apostrophe'");
  const exe = await chromium.downloadChromium(data);
  assert.equal(requests, 2);
  assert.equal(fs.readFileSync(exe, 'utf8'), 'test fixture');
  assert.equal((await chromium.chromiumStatus(data)).executable, exe);
});

test('Windows proxy checks call curl.exe without a console window', async () => {
  const calls = [];
  const proxycheck = load('src/proxycheck.js', {
    child_process: {
      execFile(file, args, options, callback) {
        calls.push({ file, args, options });
        callback(null, calls.length === 1 ? '8.8.8.8' : '{}', '');
      },
    },
  }, { platform: 'win32' });
  const result = await proxycheck.checkProxy({ type: 'http', host: '127.0.0.1', port: 8080 });
  assert.equal(result.status, 'ok');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.file, path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe'));
    assert.equal(call.options.windowsHide, true);
  }
});

test('Windows cannot offer a macOS update package', async () => {
  const updater = load('electron/updater.js', { electron: { app: { getVersion: () => '0.5.15' } } }, { platform: 'win32' });
  const result = await updater.checkUpdate();
  assert.equal(result.manual, true);
  assert.equal(result.available, false);
  assert.equal(result.latest, null);
  await assert.rejects(updater.installUpdate(), /Apple/);
});

test('Windows version probes report the real version, share work and retry failures', async t => {
  const file = path.join(temporary(t), 'chrome.exe');
  fs.writeFileSync(file, 'fixture');
  let launches = 0, closes = 0, fail = true;
  const chromium = load('electron/chromium.js', { playwright: { chromium: { launch: async options => {
    launches++;
    assert.equal(options.chromiumSandbox, true);
    assert.equal(options.executablePath, file);
    if (fail) throw new Error('broken browser');
    return { version: () => '156.1.2.3', close: async () => { closes++; } };
  } } } }, { platform: 'win32' });
  await assert.rejects(chromium.windowsBrowserVersion(file), /broken browser/);
  fail = false;
  const versions = await Promise.all([chromium.windowsBrowserVersion(file), chromium.windowsBrowserVersion(file)]);
  assert.deepEqual(versions, ['156.1.2.3', '156.1.2.3']);
  assert.equal(launches, 2);
  assert.equal(closes, 1);
});

test('A broken saved Windows browser falls back to the verified bundled browser', async t => {
  const directory = temporary(t);
  const resources = path.join(directory, 'resources');
  const bundled = path.join(resources, 'chromium', 'chrome.exe');
  const broken = path.join(directory, 'broken.exe');
  fs.mkdirSync(path.dirname(bundled), { recursive: true });
  fs.writeFileSync(bundled, 'valid fixture');
  fs.writeFileSync(broken, 'invalid fixture');
  fs.mkdirSync(path.join(directory, 'browsers'));
  fs.writeFileSync(path.join(directory, 'browsers', 'chromium-executable.txt'), broken);
  const chromium = load('electron/chromium.js', { playwright: { chromium: { launch: async options => {
    if (options.executablePath === broken) throw new Error('cannot launch');
    return { version: () => '156.1.2.3', close: async () => {} };
  } } } }, { platform: 'win32', resourcesPath: resources });
  const status = await chromium.chromiumStatus(directory);
  assert.equal(status.installed, true);
  assert.equal(status.executable, bundled);
  assert.equal(status.version, '156.1.2.3');
});

test('Original download saving retains filenames and avoids concurrent overwrites on Windows', async t => {
  const { saveDownload } = require('../src/downloads');
  const directory = temporary(t);
  const makeDownload = text => ({
    suggestedFilename: () => 'example.txt',
    saveAs: filename => fs.promises.writeFile(filename, text),
  });
  const destinations = await Promise.all([
    saveDownload(makeDownload('first'), directory),
    saveDownload(makeDownload('second'), directory),
  ]);
  assert.equal(new Set(destinations).size, 2);
  assert.deepEqual(destinations.map(file => fs.readFileSync(file, 'utf8')).sort(), ['first', 'second']);
  assert.deepEqual(fs.readdirSync(directory).sort(), ['example (1).txt', 'example.txt']);
});

test('Local API and profile CRUD retain the original behavior', async t => {
  const { startBackend } = require('../src/server');
  const backend = await startBackend(temporary(t));
  t.after(() => new Promise(resolve => backend.server.close(resolve)));
  const api = async (route, method = 'GET', body) => {
    const response = await fetch(new URL(route, backend.url), {
      method,
      headers: { 'x-api-token': backend.token, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    assert.equal(response.status, 200);
    return response.json();
  };
  assert.equal((await fetch(new URL('/api/profiles', backend.url))).status, 401);
  const { profile } = await api('/api/profiles', 'POST', { name: 'Windows test', platform: 'win' });
  assert.equal(profile.platform, 'win');
  assert.equal((await api('/api/profiles')).profiles.length, 1);
  await api(`/api/profiles/${profile.id}`, 'PATCH', { group: 'test' });
  assert.equal((await api(`/api/profiles/${profile.id}`)).profile.group, 'test');
  await api(`/api/profiles/${profile.id}`, 'DELETE');
  assert.equal((await api('/api/profiles')).profiles.length, 0);
});
