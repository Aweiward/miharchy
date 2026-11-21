# NanoYomi host spike (2026-11-21)

Question: can NanoYomi's extension host replace Suwayomi-Server as the part of Miharchy that runs extensions?

Answer: yes, for 9 of 10 sources, with two small host changes (`nano-host-spike.patch`). AllManga needs a hidden WebView, and nothing on Linux provides one.

## Setup

- NanoYomi `4e9ac9b` (2026-11-20), `host/` built with `./gradlew installDist` on Temurin JDK 21. Gradle 8.14 does not run on JDK 27.
- The host ran on Temurin JDK 21 and on the system OpenJDK 27. Both runs gave the same results.
- Keiyoushi repo `https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json`. All 1,711 extensions list a signed `jarUrl`, so no dex conversion is needed.
- `nano-host-spike.py` sends the host's stdio JSON requests: `load` (checks the signing key) → `popular` → `update` (chapters) → `pages` → `download` → first page is an image. The sources are the same as in `extension-spike.py`.
- On a `challenge` reply, the script does what Nano's `solver.rs` does: FlareSolverr 3.x on `127.0.0.1:8191` passes the check, then `setCookies` (with `Max-Age`, `Secure`, `HttpOnly`) and `setUserAgent`, then one retry. The script checks that the host stored `cf_clearance` before it retries.
- Nothing answers the host's WebView requests, as in Nano on Linux.

## Results

| Extension | Version | Result |
|---|---|---|
| MangaDex | 1.6.4 | pass |
| MANGA Plus | 1.6.69 | pass |
| Webtoons.com | 1.6.5 | pass |
| Weeb Central | 1.6.27 | pass |
| Asura Scans | 1.6.72 | pass |
| Flame Comics | 1.6.3 | pass (the site is back since the October spike) |
| Mangago | 1.6.45 | fail: `NoSuchAlgorithmException: AES/CBC/ZEROBYTEPADDING`. Pass after adding BouncyCastle (below). The JDK 27 run used the patched host |
| MangaFire (`runWebView` in October) | 1.6.38 | pass, with no WebView request |
| Manganato (Cloudflare) | 1.6.26 | fail with cookies: FlareSolverr returned `cf_clearance` and the host stored it, but the retry got the challenge again. Pass with the solver fallback (below) on the `www.nelomanga.net` mirror |
| AllManga | 1.6.32 | fail: `Timed out waiting for WebView after 20s` |

Every passing source took 3 to 8 s.

## Findings

- MangaFire needed `runWebView` on Suwayomi in October. Version 1.6.38 makes no WebView request, so AllManga is the only WebView source in this set.
- No `Stub!`, `NoClassDefFoundError` or `VerifyError` in the host log. Lib 1.6 extensions link against the host.
- Mangago needs BouncyCastle, which Android ships. Two lines fix it: `org.bouncycastle:bcprov-jdk18on` in `build.gradle.kts`, and `Security.addProvider(BouncyCastleProvider())` at the start of `main`.
- AllManga asks the host for a WebView (`create`, `loadHtml`, `eval`, `addListener`). Without a real browser it times out. AllManga 1.6.29 passed on Suwayomi in the October spike. This spike did not test whether Suwayomi still passes 1.6.32. A replacement needs a WebView bridge, for example Qt WebEngine or a headless Chromium.
- Manganato fails as Suwayomi did without `flareSolverrAsResponseFallback`. The site refuses OkHttp even with a stored `cf_clearance` cookie and the solver's user agent. The cause is probably the TLS fingerprint; this spike did not prove it. A replacement must use FlareSolverr's response body as the reply, as Suwayomi's `flareSolverrAsResponseFallback` does.
- The patch adds that fallback to the host's `CloudflareInterceptor`: on a challenge to a GET, FlareSolverr fetches the URL and its HTML becomes a 200 reply. With it, Manganato passed end to end on the `www.nelomanga.net` mirror (3 pages through FlareSolverr). The cover and page images needed no fallback.
- On the default `www.natomanga.com` mirror, the popular list came back empty. The site sent FlareSolverr the legacy layout, and Manganato 1.6.26 expects the modern layout there (`mirrorLegacyMap`). The extension and the site disagree. This spike did not check whether Suwayomi sees the same.

## The patch

`nano-host-spike.patch` applies to NanoYomi `4e9ac9b`. It is spike code, not product code:

- BouncyCastle as a JCE provider (Mangago).
- The FlareSolverr response fallback, on when `NANO_SOLVER` names the solver. It handles GET only and drops the solver's cookies.
