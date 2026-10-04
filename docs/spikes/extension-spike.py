#!/usr/bin/env python3
"""Extension spike: install extensions in a running Suwayomi-Server and check
each source end to end: popular list -> chapters -> pages -> first page image.

Usage: extension-spike.py [server-url]   (default http://127.0.0.1:4599)
"""
import json
import sys
import time
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4599"
PKGS = [
    "eu.kanade.tachiyomi.extension.all.mangadex",
    "eu.kanade.tachiyomi.extension.all.mangaplus",
    "eu.kanade.tachiyomi.extension.all.webtoons",
    "eu.kanade.tachiyomi.extension.en.weebcentral",
    "eu.kanade.tachiyomi.extension.en.asurascans",
    "eu.kanade.tachiyomi.extension.en.flamecomics",
    "eu.kanade.tachiyomi.extension.en.manganelo",
    "eu.kanade.tachiyomi.extension.en.mangago",
    "eu.kanade.tachiyomi.extension.all.mangafire",  # runWebView path (#2347)
    "eu.kanade.tachiyomi.extension.en.allanime",  # runWebView path (#2347)
]


def gql(query, timeout=180):
    req = urllib.request.Request(
        BASE + "/api/graphql",
        json.dumps({"query": query}).encode(),
        {"content-type": "application/json"},
    )
    body = json.load(urllib.request.urlopen(req, timeout=timeout))
    if body.get("errors"):
        raise RuntimeError(body["errors"][0]["message"][:300])
    return body["data"]


def check(pkg):
    row = {"pkg": pkg.rsplit(".", 1)[1]}
    try:
        ext = gql(f'mutation{{updateExtension(input:{{id:"{pkg}",patch:{{install:true}}}})'
                  f'{{extension{{versionName source{{nodes{{id lang displayName}}}}}}}}}}')
        ext = ext["updateExtension"]["extension"]
        row["version"] = ext["versionName"]
        sources = ext["source"]["nodes"]
        src = next((s for s in sources if s["lang"] == "en"), sources[0])
        row["source"] = src["displayName"]
        row["step"] = "installed"

        mangas = gql(f'mutation{{fetchSourceManga(input:{{source:"{src["id"]}",type:POPULAR,page:1}})'
                     f'{{mangas{{id title}}}}}}')["fetchSourceManga"]["mangas"]
        assert mangas, "popular list is empty"
        row["step"] = "popular"

        # Some top entries are licensed stubs with no chapters; try a few.
        for manga in mangas[:5]:
            chapters = gql(f'mutation{{fetchMangaAndChapters(input:{{id:{manga["id"]},fetchManga:true,fetchChapters:true}})'
                           f'{{chapters{{id name}}}}}}')["fetchMangaAndChapters"]["chapters"]
            if chapters:
                break
        assert chapters, "no chapters in the first 5 manga"
        row["manga"] = manga["title"][:40]
        row["step"] = "chapters"

        pages = gql(f'mutation{{fetchChapterPages(input:{{chapterId:{chapters[-1]["id"]}}})'
                    f'{{pages}}}}')["fetchChapterPages"]["pages"]
        assert pages, "chapter has no pages"
        row["step"] = "pages"

        url = pages[0] if pages[0].startswith("http") else BASE + pages[0]
        resp = urllib.request.urlopen(url, timeout=180)
        data = resp.read()
        ctype = resp.headers.get("content-type", "")
        assert ctype.startswith("image/") and len(data) > 1000, f"bad image: {ctype} {len(data)}B"
        row["step"] = "image"
        row["ok"] = True
    except Exception as e:  # the spike records every failure instead of stopping
        row["ok"] = False
        row["error"] = f"{type(e).__name__}: {e}"[:300]
    return row


if __name__ == "__main__":
    for pkg in PKGS:
        t = time.time()
        row = check(pkg)
        row["secs"] = round(time.time() - t)
        print(json.dumps(row), flush=True)
