#!/usr/bin/env python3
"""NanoYomi host spike: same 10 sources and steps as docs/spikes/extension-spike.py,
over the host's stdio JSON protocol instead of Suwayomi's GraphQL.

Usage: nano-host-spike.py <yomi-host launcher> <work dir>
"""
import json, os, queue, subprocess, sys, threading, time, urllib.request

HOST, WORK = sys.argv[1], sys.argv[2]
INDEX = "https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.json"
SOLVER = "http://127.0.0.1:8191/v1"
PKGS = [
    "eu.kanade.tachiyomi.extension.all.mangadex",
    "eu.kanade.tachiyomi.extension.all.mangaplus",
    "eu.kanade.tachiyomi.extension.all.webtoons",
    "eu.kanade.tachiyomi.extension.en.weebcentral",
    "eu.kanade.tachiyomi.extension.en.asurascans",
    "eu.kanade.tachiyomi.extension.en.flamecomics",
    "eu.kanade.tachiyomi.extension.en.manganelo",
    "eu.kanade.tachiyomi.extension.en.mangago",
    "eu.kanade.tachiyomi.extension.all.mangafire",
    "eu.kanade.tachiyomi.extension.en.allanime",
]


class Host:
    def __init__(self):
        os.makedirs(WORK + "/data", exist_ok=True)
        self.p = subprocess.Popen([HOST, WORK + "/data"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                  stderr=open(WORK + "/host.log", "w"), text=True, encoding="utf-8")
        self.waiting, self.next, self.webview = {}, 0, []
        threading.Thread(target=self.read, daemon=True).start()

    def read(self):
        for line in self.p.stdout:
            msg = json.loads(line)
            if "wv" in msg:  # the host asks the app for a WebView; nothing answers, as on Linux in Nano
                self.webview.append(msg["wv"])
            elif msg.get("id") in self.waiting:
                self.waiting.pop(msg["id"]).put(msg)

    def call(self, op, timeout=120, **args):
        self.next += 1
        q = queue.Queue()
        self.waiting[self.next] = q
        self.p.stdin.write(json.dumps({"id": self.next, "op": op, **args}) + "\n")
        self.p.stdin.flush()
        try:
            msg = q.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError(f"{op} gave no reply in {timeout}s")
        if "error" in msg:
            e = RuntimeError(msg["error"][:300])
            e.challenge = msg.get("challenge")
            raise e
        return msg["result"]


def solve(host, url):
    """Nano's solver.rs flow: FlareSolverr passes the check, the host gets its cookies and user agent."""
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 60000, "returnOnlyCookies": True}).encode()
    v = json.load(urllib.request.urlopen(urllib.request.Request(SOLVER, body, {"content-type": "application/json"}), timeout=120))
    assert v["status"] == "ok", f'solver: {v.get("message")}'
    s, now = v["solution"], time.time()
    cookies = []
    for c in s["cookies"]:  # the same Set-Cookie lines as solver.rs builds
        line = f'{c["name"]}={c["value"]}; Domain={c["domain"].lstrip(".")}; Path={c.get("path", "/")}'
        if c.get("expires", 0) > 0:
            line += f'; Max-Age={max(0, int(c["expires"] - now))}'
        line += "; Secure" * bool(c.get("secure")) + "; HttpOnly" * bool(c.get("httpOnly"))
        cookies.append(line)
    assert any(c.startswith("cf_clearance=") for c in cookies), "solver: no cf_clearance cookie"
    host.call("setCookies", url=url, cookies=cookies)
    host.call("setUserAgent", url=url, userAgent=s["userAgent"])
    stored = host.call("cookies", url=url)
    assert any(c.startswith("cf_clearance=") for c in stored), f"host did not store cf_clearance: {stored}"


def call(host, row, op, **args):
    try:
        return host.call(op, **args)
    except RuntimeError as e:
        if not getattr(e, "challenge", None):
            raise
        solve(host, e.challenge["url"])
        row["cloudflare"] = "solved by FlareSolverr, cf_clearance stored in the host"
        return host.call(op, **args)


def check(host, ext, key):
    row = {"pkg": ext["packageName"].rsplit(".", 1)[1], "version": ext["versionName"]}
    before = len(host.webview)
    try:
        jar = f'{WORK}/{row["pkg"]}.jar'
        if not os.path.exists(jar):
            urllib.request.urlretrieve(ext["resources"]["jarUrl"], jar)
        sources = host.call("load", jar=jar, signingKey=key)
        src = next((s for s in sources if s["lang"] == "en"), sources[0])
        row["source"], row["step"] = src["name"], "loaded"

        mangas = call(host, row, "popular", source=src["id"], page=1)["mangas"]
        assert mangas, "popular list is empty"
        row["step"] = "popular"

        for manga in mangas[:5]:
            chapters = call(host, row, "update", source=src["id"], manga=manga)["chapters"]
            if chapters:
                break
        assert chapters, "no chapters in the first 5 manga"
        row["manga"], row["step"] = (manga["title"] or "")[:40], "chapters"

        pages = call(host, row, "pages", source=src["id"], chapter=chapters[-1])
        assert pages, "chapter has no pages"
        row["step"] = "pages"

        path = call(host, row, "download", source=src["id"], page=pages[0])
        data = open(path, "rb").read()
        os.remove(path)
        magic = {b"\xff\xd8": "jpeg", b"\x89P": "png", b"RI": "webp", b"GI": "gif", b"\xff\x0a": "jxl", b"\x00\x00": "avif/jxl"}
        kind = magic.get(data[:2])
        assert kind and len(data) > 1000, f"bad image: {data[:8]!r} {len(data)}B"
        row["step"], row["image"], row["ok"] = "image", f"{kind} {len(data) // 1024} KB", True
    except Exception as e:  # record every failure, like the Suwayomi spike
        row["ok"], row["error"] = False, f"{type(e).__name__}: {e}"[:300]
    if len(host.webview) > before:
        row["webview_requests"] = sorted(set(host.webview[before:]))
    return row


if __name__ == "__main__":
    index = json.load(urllib.request.urlopen(INDEX))
    key = index["signingKey"]
    exts = {e["packageName"]: e for e in index["extensionList"]["extensions"]}
    host = Host()
    for pkg in PKGS:
        t = time.time()
        row = check(host, exts[pkg], key) if pkg in exts else {"pkg": pkg, "ok": False, "error": "not in index"}
        row["secs"] = round(time.time() - t)
        print(json.dumps(row), flush=True)
    host.p.stdin.close()
