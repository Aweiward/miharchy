# Extension spike (2026-10-04)

Question: do current Keiyoushi extensions (lib 1.6, Kotlin 2.x builds) run on Suwayomi-Server, given open issues #2298 (dex-to-jar bytecode) and #2347 (WebView `getFactory`)?

Answer: yes. 9 of 10 popular sources passed end to end. The one failure is a dead site, not Suwayomi.

## Setup

- Suwayomi-Server v2.4.2366 (jar, sha256 checked) on OpenJDK 26, headless on `127.0.0.1:4599`, WebUI and tray off.
- Keiyoushi repo `https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json`.
- `extension-spike.py` installs each extension, then checks: popular list → chapters → pages → first page is an image.

## Results

| Extension | Version | Result |
|---|---|---|
| MangaDex | 1.6.0 | pass |
| MANGA Plus | 1.6.66 | pass |
| Webtoons.com | 1.6.2 | pass |
| Weeb Central | 1.6.25 | pass |
| Asura Scans | 1.6.69 | pass |
| Mangago | 1.6.41 | pass |
| MangaFire (`runWebView`) | 1.6.34 | pass |
| AllManga (`runWebView`) | 1.6.29 | pass |
| Manganato (Cloudflare) | 1.6.22 | pass, only with FlareSolverr and `flareSolverrAsResponseFallback: true` |
| Flame Comics | 1.6.0 | fail: `flamecomics.xyz` redirects to a Discord invite, so the site is gone |

## Findings

- No `VerifyError`, `NoClassDefFoundError` or `Stub!` in the server log. #2298 did not hit any tested extension.
- The log shows one `NoSuchMethodException: WebView.getFactory()` (#2347), but both `runWebView` sources still passed.
- Cloudflare-protected sources need FlareSolverr (or Byparr) running beside Suwayomi. Without it they fail with `Cloudflare bypass currently disabled`. With it but without `flareSolverrAsResponseFallback`, Manganato got HTTP 403 after FlareSolverr solved the challenge.
- FlareSolverr 3.5.2 ran from `ghcr.io/flaresolverr/flaresolverr` in Docker; one solve took about 11 s.
