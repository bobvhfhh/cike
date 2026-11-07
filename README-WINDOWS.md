# CIKE for Windows 11 x64

This is a local Windows compatibility build of upstream CIKE v0.5.15
(commit cdaac85). It is not an official upstream release.

Repository: https://github.com/bobvhfhh/cike/tree/codex/windows-v0.5.15
Fork parent: https://github.com/chainfix/cike (not the other Windows fork).
See [comparison and design decisions](docs/WINDOWS-COMPARISON.md) for what was
learned from engeeeee/cike and what was deliberately not adopted.

## Run

Extract the complete Windows archive, then double-click `CIKE.exe`.
Keep the other files and the `resources` directory next to the executable.
The packaged version includes its matching Chromium; Node.js and a separate
browser installation are not required.

The original profile format, fingerprint scripts, proxy routing and API
are unchanged. The existing update status field now explains manual updates.
Data still defaults to `%USERPROFILE%\.local-fingerprint-browser`.
Close CIKE and all its profile browsers before backing up that directory.
Updates must be installed manually: the upstream updater only publishes Mac
packages, which cannot update this Windows build.

## Build

Requires Windows 11 x64, Node.js 22 or later and Internet access.

```powershell
npm ci
npm run test:windows
npm run pack:win-x64
npm run test:windows-app
```

The app is written to `dist/CIKE-win32-x64/CIKE.exe`. Chromium is cached under
`.windows-build/` for subsequent builds. Use `npm run electron` for development;
the original Settings page can download Chromium on Windows using the built-in
Windows `tar.exe` ZIP extractor. Proxy checks use Windows `curl.exe` without
opening a console window.

The build also creates `dist/CIKE-0.5.15-windows-x64.zip` and `SHA256SUMS.txt`.
Windows GitHub Actions runs both tests before uploading an artifact. The first
build/download requires Internet access; the packaged application's first
launch uses its bundled Chromium. Windows status/version checks use an actual
sandboxed browser probe and fall back to the bundled copy if a saved browser is
missing or broken.

Known upstream issue: the new-profile form's Windows choice stores `windows`,
but the old fingerprint code expects `win`. Create the profile, then use
Edit -> Windows -> Save before opening it. This compatibility branch leaves the
original fingerprint behavior and data migration policy untouched.

This build is unsigned and may show a Windows SmartScreen warning. No system
security settings, firewall rules, proxy settings or existing browser data are
changed by the compatibility patches.
