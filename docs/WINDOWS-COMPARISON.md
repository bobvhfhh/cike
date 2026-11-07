# Windows port decisions (2026-11-07)

This branch is a direct fork of [chainfix/cike](https://github.com/chainfix/cike),
based on v0.5.15, commit `cdaac85`. The fork's `main` branch tracks the author's
v0.7.0. The Windows branch intentionally preserves the previously delivered
v0.5.15 application behavior rather than silently migrating existing profiles.

## Reference reviewed

[engeeeee/cike](https://github.com/engeeeee/cike) at
`35e247d` was reviewed against its upstream base `abeacd2`. In particular,
`d03ef63` adds Windows runtime/build support and `6017d2d` adds window-state
management. These commits are design references; neither was cherry-picked.
No source files from that fork were copied wholesale.

The reference uses the author's newer v0.7.0 behavior. Its removal of legacy
fingerprint patches, credential migration, profile conversion, proxy checks,
and download changes mostly originate upstream, not in its Windows port.
Claiming these as improvements from the other Windows fork would be misleading.

## Adopted ideas, implemented for this older base

| Area | Decision and reason |
| --- | --- |
| Windows Chromium version | Query a sandboxed temporary browser over Playwright's pipe: GUI `chrome.exe --version` cannot reliably supply stdout. Add an in-memory cache keyed by file path, size and modification time; share concurrent probes and retry failed probes. |
| Browser usability | Reject a broken saved executable and fall back to the bundled Chromium. Inspect the real version rather than labeling every executable with the manifest version. Validate downloaded browser versions before writing the marker. |
| System curl | Resolve Windows' `System32/curl.exe` explicitly and hide its console. Keep v0.5.15's network and authentication semantics; do not backport v0.7.0's proxy subsystem. |
| Updates | Return an explicit manual-update result, display it using the existing status field, and never claim the installed version is latest without checking. Never offer the author's Mac installer on Windows. |
| Desktop integration | Use the existing artwork, hide the menu bar on Windows, and set a Windows app ID. |
| Repeatable delivery | Build a ZIP with SHA256 and run compatibility plus packaged-desktop tests on a Windows runner before uploading an artifact. No automatic public-release publishing workflow. |

## Deliberately not adopted

- The reference's full-screen inheritance and automatic maximization add a new
  setting, background polling, and native window changes. They are useful for
  some users but exceed this port's compatibility-only scope.
- Keep `%USERPROFILE%\.local-fingerprint-browser`. Switching to
  `%LOCALAPPDATA%\CIKE` would make the existing environments appear missing.
- Keep the pinned v0.5.15 dependency lock and original fingerprint code. Moving
  to v0.7.0 requires a separately reviewed migration with explicit backup.
- Keep Chromium bundled for offline first launch. The reference's smaller ZIP
  requires an additional first-run download.
- Keep Windows 11's built-in `tar.exe` for trusted official browser archives.
  Adding the reference's ZIP parser would introduce a dependency for a platform
  where a native extractor is already available.
- Do not copy release scripts tied to another account, fixed workflow run IDs,
  or automatic publication on workflow edits.

## Limits retained from v0.5.15

This port is not a backport of the author's security overhaul. It retains the
legacy JS fingerprint modifications, plaintext proxy storage and API behavior.
The original new-profile form stores `windows` while its fingerprint recipe
expects `win`; the existing edit dialog stores `win` correctly. This known
upstream issue is documented, not silently changed. Local automatic geolocation
also retains the original HTTP/HTTPS mismatch. A Windows build does not fix
these issues or guarantee website detection scores.
