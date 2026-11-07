'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { cftPlatform, downloadUrl, findExecutable, chromiumStatus } = require('../electron/chromium');
const { privateDirectory, writePrivate } = require('../src/privatefiles');
const { Settings } = require('../src/settings');

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

test('window preferences preserve legacy settings and remain independent of proxy settings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-window-settings-'));
  try {
    fs.writeFileSync(path.join(root, 'settings.json'), JSON.stringify({ socksViaSystemProxy: true }));
    const settings = new Settings(root);
    assert.deepEqual(settings.get(), { socksViaSystemProxy: true, browserWindowMode: 'remember', browserWindowState: 'maximized' });
    settings.rememberWindowState('fullscreen');
    settings.set({ socksViaSystemProxy: false });
    assert.equal(new Settings(root).get().browserWindowState, 'fullscreen');
    settings.set({ browserWindowMode: 'maximized' });
    settings.rememberWindowState('normal');
    assert.equal(settings.get().browserWindowState, 'fullscreen');
    assert.throws(() => settings.set({ browserWindowMode: 'invalid' }), /窗口模式/);
    assert.equal(new Settings(root).get().browserWindowMode, 'maximized');
    settings.set({ browserWindowMode: 'remember' });
    settings.rememberWindowState('minimized');
    assert.equal(settings.get().browserWindowState, 'fullscreen');
    settings.rememberWindowState('normal');
    assert.equal(new Settings(root).get().browserWindowState, 'normal');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native browser window state follows maximize/fullscreen changes across windows and restarts',
  { skip: process.platform !== 'win32', timeout: 90000 }, async () => {
    const { ProfileStore } = require('../src/store');
    const { BrowserManager } = require('../src/browser');
    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-window-state-'));
    const store = new ProfileStore(root), settings = new Settings(root);
    let manager = new BrowserManager(store, null, settings, { startPage: false, downloadsDirectory: path.join(root, 'Downloads') });
    const windowFor = async (context, page) => {
      const session = await context.newCDPSession(page);
      return { session, windowId: (await session.send('Browser.getWindowForTarget')).windowId };
    };
    const expectState = async (window, expected) => {
      let actual;
      for (let i = 0; i < 100; i++) {
        actual = (await window.session.send('Browser.getWindowBounds', { windowId: window.windowId })).bounds.windowState;
        if (actual === expected) return;
        await delay(50);
      }
      assert.equal(actual, expected);
    };
    const setState = async (window, state) => {
      await window.session.send('Browser.setWindowBounds', { windowId: window.windowId, bounds: { windowState: state } });
      await expectState(window, state);
    };
    try {
      const first = store.create({ viewport: { width: 800, height: 600 } });
      await manager.open(first.id);
      const context = manager.getContext(first.id), page = context.pages()[0];
      assert.equal(page.viewportSize(), null);
      const nativeWindow = await windowFor(context, page);
      await expectState(nativeWindow, 'maximized');
      await setState(nativeWindow, 'fullscreen');
      const popupEvent = context.waitForEvent('page');
      await nativeWindow.session.send('Target.createTarget', { url: 'about:blank', newWindow: true });
      const popup = await windowFor(context, await popupEvent);
      assert.notEqual(popup.windowId, nativeWindow.windowId);
      await expectState(popup, 'fullscreen');
      const second = store.create({});
      await manager.open(second.id);
      const secondContext = manager.getContext(second.id);
      await expectState(await windowFor(secondContext, secondContext.pages()[0]), 'fullscreen');
      await manager.closeAll();
      assert.equal(new Settings(root).get().browserWindowState, 'fullscreen');
      manager = new BrowserManager(store, null, new Settings(root), { startPage: false, downloadsDirectory: path.join(root, 'Downloads') });
      await manager.open(first.id);
      const restartedContext = manager.getContext(first.id);
      await expectState(await windowFor(restartedContext, restartedContext.pages()[0]), 'fullscreen');
    } finally { await manager.closeAll(); fs.rmSync(root, { recursive: true, force: true }); }
  });

test('new Windows browser environment accepts native window bounds instead of a fixed Playwright viewport',
  { skip: process.platform !== 'win32', timeout: 30000 }, async () => {
    const { ProfileStore } = require('../src/store');
    const { BrowserManager } = require('../src/browser');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cike-window-viewport-'));
    const store = new ProfileStore(root);
    const manager = new BrowserManager(store, null, new Settings(root), { startPage: false, downloadsDirectory: path.join(root, 'Downloads') });
    try {
      const profile = store.create({ viewport: { width: 800, height: 600 } });
      await manager.open(profile.id);
      assert.equal(manager.getContext(profile.id).pages()[0].viewportSize(), null);
    } finally { await manager.closeAll(); fs.rmSync(root, { recursive: true, force: true }); }
  });
