#!/usr/bin/env python3
# Drives miharchy-core's browse routes over Keiyoushi sources, as a real client would (#365).
# Usage: core-browse-check.py <core.json> <pkg,pkg,...>, packages without the eu.kanade.tachiyomi.extension. prefix.
# Run it against a core with scratch MIHARCHY_CORE_DATA and MIHARCHY_CORE_CONFIG, never the real ones.
import json, sys, urllib.request, time
cfg = json.load(open(sys.argv[1])); URL = cfg["url"]; H = {"Authorization": "Bearer " + cfg["secret"]}
def api(name, **body):
    req = urllib.request.Request(f"{URL}/api/{name}", json.dumps(body).encode(), H)
    try: return json.load(urllib.request.urlopen(req, timeout=300))
    except urllib.error.HTTPError as e: return json.load(e)
def img(path):
    try:
        r = urllib.request.urlopen(urllib.request.Request(URL + path, headers=H), timeout=300); b = r.read()
        return f"{r.headers['Content-Type']} {len(b)}B"
    except urllib.error.HTTPError as e: return "ERR " + json.load(e)["error"]["kind"]
PKGS = sys.argv[2].split(",")
api("extensionRepo.add", url="https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json")
for p in PKGS:
    r = api("extension.install", pkgName="eu.kanade.tachiyomi.extension." + p)
    if "error" in r: print(p, "install", r["error"]); continue
sources = api("source.list")["sources"]
for p in PKGS:
    name = p.split(".")[1]
    cands = [s for s in sources if s["lang"] in ("en", "all")]
    ext = api("extension.list")
    ids = [s["id"] for e in ext["extensions"] if e["pkgName"].endswith("." + p) for s in e.get("sources", []) if s["lang"] in ("en", "all")]
    if not ids: print(p, "no en source"); continue
    sid = ids[0]; t = time.time(); row = {"pkg": p}
    try:
        pop = api("source.popular", source=sid, page=1)
        if "error" in pop: row["popular"] = pop["error"]; print(json.dumps(row)); continue
        row["popular"] = len(pop["mangas"]); m = pop["mangas"][0]
        row["cover"] = img(m["thumbnailUrl"]) if m["thumbnailUrl"] else None
        ref = api("manga.refresh", id=m["id"])
        if "error" in ref: row["refresh"] = ref["error"]; print(json.dumps(row)); continue
        ch = ref["chapters"]; row["chapters"] = len(ch); row["status"] = ref["manga"]["status"]; row["realUrl"] = bool(ref["manga"]["realUrl"])
        newest = max(ch, key=lambda c: c["sourceOrder"])
        pages = api("chapter.pages", id=newest["id"])
        if "error" in pages: row["pages"] = pages["error"]; print(json.dumps(row)); continue
        row["pages"] = len(pages["pages"]); row["page0"] = img(pages["pages"][0]) if pages["pages"] else None
        s = api("source.search", source=sid, page=1, query=m["title"][:12]); row["search"] = len(s.get("mangas", [])) if "mangas" in s else s["error"]["kind"]
    except Exception as e: row["exc"] = repr(e)
    row["s"] = round(time.time() - t); print(json.dumps(row), flush=True)
