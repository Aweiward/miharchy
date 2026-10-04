# Cloudflare solvers: FlareSolverr vs Byparr (2026-10-04)

Question: which Cloudflare solver should Setup offer? FlareSolverr 3.5.2 (735 MB image) or Byparr (`ghcr.io/thephaseless/byparr`, 2.4 GB image, Camoufox)?

Answer: keep FlareSolverr. The two fail on different sites. FlareSolverr covers every Cloudflare-protected manga in the user's library; Byparr covers more sites in total but loses Kagane.

## Method

Five installed sources answer with a real Cloudflare challenge (`cf-mitigated: challenge`): Comix, Kagane, MangaDot, ManhuaUS and Read Comics Online. Each solver got the same `request.get` with `maxTimeout` 60000, two rounds, alternating per site. A success is `status: ok`, HTTP 200 and the real page; spot checks read the `<title>` of the returned HTML.

## Results

| Site | FlareSolverr | Byparr | Library manga |
|---|---|---|---|
| Comix | ✓ ✓ (12 s) | ✓ ✓ (6 s) | 2 |
| MangaDot | ✓ ✓ (11 s) | ✓ ✓ (6 s) | 2 |
| Kagane | ✓ ✓ (12 s) | ✗ ✗ (timeout) | 1 |
| ManhuaUS | ✗ ✗ (timeout) | ✓ ✓ (62 s) | 0 |
| Read Comics Online | ✗ ✗ (timeout) | ✓ ✓ (12–62 s) | 0 |
| Total | 6 of 10 | 8 of 10 | |

## Findings

- Earlier in the day FlareSolverr timed out on Comix and Kagane through Suwayomi; in the comparison it solved both every time. Results vary run to run, so the table is a snapshot.
- Both speak the FlareSolverr API, so switching is a Setup change (image and container name), not a Suwayomi change.
- A fallback proxy (Byparr, then FlareSolverr) would cover all five sites at the cost of two browsers running. Not built: no source the user reads needs it yet.
- Docker starts on demand (`docker.socket`), so after a reboot the container stayed down until something called Docker. The server unit now starts it (`ExecStartPre`).
