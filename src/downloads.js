'use strict';
const fs = require('fs/promises');
const path = require('path');
const os = require('os');
const pendingDownloads = new WeakMap();

// Set native preferences before launching the profile. Chromium's native
// download manager preserves filenames, numbers collisions and records the
// permanent path in chrome://downloads. CDP's `allow` policy overwrites names.
async function prepareDownloads(profileDirectory, directory = path.join(os.homedir(), 'Downloads')) {
  directory = path.resolve(directory);
  await fs.mkdir(directory, { recursive: true });
  const defaultDirectory = path.join(profileDirectory, 'Default');
  await fs.mkdir(defaultDirectory, { recursive: true });
  const filename = path.join(defaultDirectory, 'Preferences');
  let preferences = {};
  try { preferences = JSON.parse(await fs.readFile(filename, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  preferences.background_mode = { ...preferences.background_mode, enabled: false };
  preferences.profile = { ...preferences.profile, name: path.basename(profileDirectory), exit_type: 'Normal' };
  preferences.session = { ...preferences.session, restore_on_startup: 5 };
  preferences.download = {
    ...preferences.download,
    default_directory: directory,
    prompt_for_download: false,
    directory_upgrade: true,
  };
  const temporary = filename + '.cike-downloads';
  try {
    await fs.writeFile(temporary, JSON.stringify(preferences), { mode: 0o600 });
    await fs.rename(temporary, filename);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

async function configureDownloads(context, directory = path.join(os.homedir(), 'Downloads')) {
  if (process.platform === 'win32') {
    await fs.mkdir(directory, { recursive: true });
    let queue = Promise.resolve();
    pendingDownloads.set(context, () => queue);
    context.on('download', download => {
      queue = queue.then(async () => {
        const name = path.basename(download.suggestedFilename()).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
        const extension = path.extname(name), stem = path.basename(name, extension);
        let target = path.join(directory, name), suffix = 1;
        while (true) {
          try { await fs.access(target); target = path.join(directory, `${stem} (${suffix++})${extension}`); }
          catch (error) { if (error.code === 'ENOENT') break; throw error; }
        }
        await download.saveAs(target);
      }).catch(error => console.error('[CIKE] Could not save browser download:', error.message));
    });
    return;
  }
  const page = context.pages()[0] || await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    // Undo Playwright's allowAndName policy, which stores GUID-named artifacts
    // in a temporary directory. Native defaults apply to all tabs and popups.
    await session.send('Browser.setDownloadBehavior', { behavior: 'default' });
  } finally {
    await session.detach();
  }
}

async function finishDownloads(context) { await pendingDownloads.get(context)?.(); }

module.exports = { prepareDownloads, configureDownloads, finishDownloads };
