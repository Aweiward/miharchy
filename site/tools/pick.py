#!/usr/bin/env python3
"""pick.py: list candidate showcase manga from api.mangadex.org, one JSON line each.

The rule: ongoing, content rating safe, no Doujinshi tag, English chapters available, ordered by
follows, and at least one English chapter published in the last 90 days (the window's 3-month
Updates rule), so the series shows in Updates. Reads the public API only; needs no server."""
import datetime, json, time, urllib.parse, urllib.request

SINCE = (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%S")
DOUJINSHI = "b13b2a48-c720-44a9-9c77-39c9979373fb"


def get(path, q):
    url = "https://api.mangadex.org" + path + "?" + urllib.parse.urlencode(q, doseq=True)
    time.sleep(0.25)
    req = urllib.request.Request(url, headers={"User-Agent": "miharchy-showcase"})
    return json.load(urllib.request.urlopen(req, timeout=30))


for offset in (0, 100):
    ms = get("/manga", {"hasAvailableChapters": "true", "availableTranslatedLanguage[]": ["en"], "order[followedCount]": "desc",
                        "contentRating[]": ["safe"], "limit": 100, "offset": offset, "status[]": ["ongoing"],
                        "excludedTags[]": [DOUJINSHI]})["data"]
    for m in ms:
        feed = get("/manga/%s/feed" % m["id"], {"translatedLanguage[]": ["en"], "publishAtSince": SINCE, "limit": 1, "includeExternalUrl": 0})
        if feed["total"]:
            a = m["attributes"]
            fmt = [t["attributes"]["name"]["en"] for t in a["tags"] if t["attributes"]["group"] == "format"]
            title = a["title"].get("en") or next(iter(a["title"].values()))
            print(json.dumps({"title": title, "recent": feed["total"], "lang": a["originalLanguage"], "format": fmt}, ensure_ascii=False), flush=True)
