'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { _electron, chromium } = require('playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const directory = fs.mkdtempSync(path.join(root, '.windows-build', 'app-test-'));
  const dataDir = path.join(directory, 'profiles-data');
  const executablePath = path.join(root, 'dist', 'CIKE-win32-x64', 'CIKE.exe');
  const env = { ...process.env, LFB_DATA: dataDir, LFB_EXPOSE_DEBUGGER: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.LFB_CHROMIUM_EXECUTABLE;
  const local = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><title>CIKE Windows test</title>Windows profile test');
  });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${local.address().port}`;
  let electron;
  const launch = async (exposeDebugger = true) => {
    const app = await _electron.launch({
      executablePath,
      args: [`--user-data-dir=${path.join(directory, 'electron-data')}`],
      env: { ...env, LFB_EXPOSE_DEBUGGER: exposeDebugger ? '1' : '0' },
      timeout: 60000,
    });
    await app.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.hide();
    });
    return app;
  };
  try {
    electron = await launch();
    const window = await electron.firstWindow();
    const errors = [];
    window.on('pageerror', error => errors.push(error.message));
    await window.waitForFunction(() => document.querySelector('#profiles-list')?.textContent.includes('还没有环境'));
    const bundled = await window.evaluate(() => window.lfb.chromiumStatus());
    assert.equal(bundled.installed, true);
    assert.match(bundled.version, /^\d+\.\d+\.\d+\.\d+$/);
    assert.ok(bundled.executable.includes(`${path.sep}resources${path.sep}chromium${path.sep}`));
    console.log('PASS packaged app UI and bundled Chromium detection');
    const credentials = await window.evaluate(() => ({ url: window.lfb.apiBase, token: window.lfb.token }));
    const api = async (route, method = 'GET', body) => {
      const response = await fetch(new URL(route, credentials.url), {
        method,
        headers: { 'x-api-token': credentials.token, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const result = await response.json();
      assert.equal(response.status, 200, result.error);
      assert.equal(result.ok, true);
      return result;
    };

    await window.locator('[data-page="new"]').click();
    await window.locator('#n-group').fill('Windows compatibility test');
    await window.locator('#n-locale').selectOption('en-US');
    await window.locator('#n-tz').selectOption('Asia/Shanghai');
    await window.locator('#n-save').click();
    await window.locator('.env-card').waitFor();
    console.log('PASS unchanged create-profile UI');
    const first = (await api('/api/profiles')).profiles[0];
    await api(`/api/profiles/${first.id}`, 'PATCH', { platform: 'win' });
    const { profile: second } = await api('/api/profiles', 'POST', {
      name: 'Second environment', platform: 'win', locale: 'en-US', timezone: 'Asia/Shanghai',
    });
    const a = await api('/api/openBrowser', 'POST', { profile_id: first.id, headless: false });
    const b = await api('/api/openBrowser', 'POST', { profile_id: second.id, headless: true });
    assert.equal((await api('/api/openedList')).opened.length, 2);
    const browserA = await chromium.connectOverCDP(a.debug_url);
    const browserB = await chromium.connectOverCDP(b.debug_url);
    const contextA = browserA.contexts()[0];
    const contextB = browserB.contexts()[0];
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();
    await pageA.goto(origin);
    await pageB.goto(origin);
    await pageA.evaluate(() => {
      localStorage.setItem('cike-windows-test', 'persisted');
    });
    await contextA.addCookies([{ name: ['cike', 'test'].join('_'), value: 'first', url: origin, expires: Math.floor(Date.now() / 1000) + 86400 }]);
    assert.equal(await pageB.evaluate(() => localStorage.getItem('cike-windows-test')), null);
    assert.equal((await contextB.cookies(origin)).some(cookie => cookie.name === ['cike', 'test'].join('_')), false);
    assert.equal(await pageA.evaluate(() => navigator.platform), 'Win32');
    console.log('PASS headed/headless Chromium, two profiles, storage/cookie isolation');

    await api('/api/closeAllBrowsers', 'POST');
    await api('/api/openBrowser', 'POST', { profile_id: first.id, headless: true });
    const reopenedInfo = (await api('/api/openedList')).opened[0];
    const reopened = await chromium.connectOverCDP(reopenedInfo.debug_url);
    const reopenedPage = await reopened.contexts()[0].newPage();
    await reopenedPage.goto(origin);
    assert.equal(await reopenedPage.evaluate(() => localStorage.getItem('cike-windows-test')), 'persisted');
    assert.ok((await reopened.contexts()[0].cookies(origin)).some(cookie => cookie.name === ['cike', 'test'].join('_')));
    console.log('PASS profile persistence after browser restart');
    await api('/api/closeAllBrowsers', 'POST');
    await window.locator('[data-page="settings"]').click();
    await window.locator('#btn-check-update').click();
    await window.waitForFunction(() => document.querySelector('#update-status').textContent.includes('手动更新'));
    assert.equal(await window.locator('#btn-install-update').isVisible(), false);
    console.log('PASS manual Windows update notice without a false latest-version claim');
    await window.locator('[data-page="profiles"]').click();
    await window.locator('#btn-refresh-profiles').click();
    await electron.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
    await window.screenshot({ path: path.join(directory, 'windows-app.png') });
    assert.deepEqual(errors, []);
    await electron.close();
    const marker = path.join(dataDir, 'browsers', 'chromium-executable.txt');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, path.join(directory, 'missing-browser.exe'));
    electron = await launch(false);
    const restartedWindow = await electron.firstWindow();
    await restartedWindow.waitForFunction(() => document.querySelectorAll('.env-card').length === 2);
    console.log('PASS full application restart with saved environments');
    const defaultOpen = await restartedWindow.evaluate(async profileId => {
      const response = await fetch(new URL('/api/openBrowser', window.lfb.apiBase), {
        method: 'POST',
        headers: { 'x-api-token': window.lfb.token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: profileId, headless: true }),
      });
      return response.json();
    }, first.id);
    assert.equal(defaultOpen.open, true);
    assert.equal(defaultOpen.debug_url, undefined);
    console.log('PASS debugger remains disabled by default');
    console.log('PASS stale downloaded-browser path falls back to bundled Chromium');
    await electron.close();
    electron = null;
    console.log('Test evidence:', directory);
  } finally {
    if (electron) await electron.close().catch(() => {});
    await new Promise(resolve => local.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
