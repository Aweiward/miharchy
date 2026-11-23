#!/usr/bin/env python3
"""seed.py <A|B|C|D|finish>: build the showcase library on the verify run's scratch miharchy-core.

Stages A to D add manga from MangaDex. Each manga joins the library before its chapters are
fetched, so chapters with recent uploads count as updates. Updates group by the day core
fetched them, so run each stage on a core whose clock is shifted (start-at): A at -5d, B at -3d,
C at -1d, D at 0. `finish` runs on the real clock: it leaves each series' two newest updates
unread and marks its older updates read (with today's lastReadAt, for the reading card), then bookmarks and downloads a few updates."""
import json, os, sys, time, urllib.error, urllib.request

RUN = os.environ.get("MIHARCHY_VERIFY_DIR") or sys.exit("set MIHARCHY_VERIFY_DIR (see README.md)")
MANGADEX = "2499283573021220255"

# (search query, exact title, category, chapters left unread; None = leave all unread)
LIBRARY = [
    ("Yotsuba to!", "Yotsuba&!", "Reading", 6),
    ("Chainsaw Man", "Chainsaw Man", "Reading", 3),
    ("Bocchi the Rock", "Bocchi the Rock!", "Reading", 11),
    ("One Punch-Man", "One-Punch Man (Webcomic)", "Reading", 2),
    ("Horimiya", "Horimiya", "Reading", 0),
    ("Tomo-chan wa Onna no ko", "Tomo-chan wa Onna no ko!", "Reading", 40),
    ("Azumanga Daioh", "Azumanga Daioh (2009 Print)", "Reading", 12),
    ("Blue Lock", "Blue Lock", "Reading", None),
    ("Eleceed", "Eleceed", "Webtoon", 9),
    ("Lookism", "Lookism", "Webtoon", 14),
    ("Omniscient Reader", "Omniscient Reader's Viewpoint", "Webtoon", None),
    ("Sousou no Frieren", "Frieren: Beyond Journey's End", "Plan to read", None),
    ("Spy x Family", "SPY×FAMILY", "Plan to read", None),
    ("Dandadan", "Dandadan", "Plan to read", None),
    ("Witch Hat Atelier", "Witch Hat Atelier", "Plan to read", None),
    ("Dungeon Meshi", "Delicious in Dungeon", "Plan to read", None),
    ("Kusuriya no Hitorigoto", "The Apothecary Diaries", "Plan to read", None),
    # Series still releasing in English (chapters inside the 3-month window; see pick.py).
    ("Mairimashita! Iruma-kun", "Welcome to Demon School! Iruma-kun", "Reading", 12),
    ("Tate no Yuusha no Nariagari", "The Rising of the Shield Hero", "Reading", 8),
    ("Kage no Jitsuryokusha ni Naritakute", "The Eminence in Shadow", "Reading", 6),
    ("Youjo Senki", "The Saga of Tanya the Evil", "Reading", 12),
    ("Kagurabachi", "Kagurabachi", "Reading", 3),
    ("Boruto Two Blue Vortex", "Boruto: Two Blue Vortex", "Reading", 3),
    ("Ki ni Natteru Hito ga Otoko ja Nakatta", "The Guy She Was Interested in Wasn't a Guy at All", "Reading", 11),
    ("Ruri Dragon", "RuriDragon", "Reading", 2),
    ("SSS-Class Suicide Hunter", "SSS-Class Revival Hunter", "Webtoon", 3),
]
STAGES = {"The Eminence in Shadow": "B", "The Rising of the Shield Hero": "B",
          "SSS-Class Revival Hunter": "C", "Welcome to Demon School! Iruma-kun": "C",
          "The Guy She Was Interested in Wasn't a Guy at All": "D"}
BOOKMARK = ("The Guy She Was Interested in Wasn't a Guy at All", "Welcome to Demon School! Iruma-kun")
DOWNLOAD = "SSS-Class Revival Hunter"


def api(route, body=None):
    # The secret goes in a header, never on a command line.
    cfg = json.load(open(RUN + "/core/core.json"))
    req = urllib.request.Request(cfg["url"] + "/api/" + route, json.dumps(body or {}).encode(),
                                 {"content-type": "application/json", "authorization": "Bearer " + cfg["secret"]})
    try:
        return json.load(urllib.request.urlopen(req, timeout=180))
    except urllib.error.HTTPError as e:
        raise RuntimeError(route + ": " + e.read().decode())


def mark(ids, patch):
    if ids:
        api("chapter.update", {"ids": ids, **patch})


def stage(name):
    picked = []
    for query, title, cat, unread in LIBRARY:
        if STAGES.get(title, "A") != name:
            continue
        ms = api("source.search", {"source": MANGADEX, "page": 1, "query": query})["mangas"]
        m = next(m for m in ms if m["title"] == title)
        api("manga.update", {"ids": [m["id"]], "inLibrary": True})
        picked.append((m, cat, unread))
        print("in library", m["id"], title, flush=True)

    time.sleep(2)  # a fetch in the same second as the add makes no updates
    cats = {c["name"]: c["id"] for c in api("category.list")["categories"]}
    for c in ("Reading", "Webtoon", "Plan to read"):
        if c not in cats:
            cats[c] = api("category.create", {"name": c})["category"]["id"]

    for m, cat, unread in picked:
        try:
            chs = api("manga.refresh", {"id": m["id"]})["chapters"]
        except RuntimeError as e:
            # MangaDex lists no English chapters for licensed series: the manga shows by its cover only.
            # Any other failure (core down, the network) stops the stage.
            if "returned no chapters" not in str(e):
                raise
            print("no chapters:", e, flush=True)
            chs = []
        api("manga.update", {"ids": [m["id"]], "addToCategories": [cats[cat]]})
        if unread is not None and chs:
            chs.sort(key=lambda c: c["sourceOrder"])
            mark([c["id"] for c in chs[:max(0, len(chs) - unread)]], {"isRead": True})
        print("seeded", m["id"], m["title"], cat, len(chs), "chapters", flush=True)


def finish():
    since = int((time.time() - 90 * 86400) * 1000)
    lib = {m["id"]: m for m in api("library.list")["mangas"]}
    ups = api("chapter.list", {"mangaIds": list(lib), "since": since})["chapters"]
    by = {}
    for c in sorted(ups, key=lambda c: -int(c["uploadDate"])):
        m = lib[c["mangaId"]]
        if int(c["fetchedAt"]) > int(m["inLibraryAt"]):
            by.setdefault(m["title"], []).append(c)
    read, unread = [], []
    for title, cs in by.items():
        keep = [] if title == "Yotsuba&!" else cs[:2]  # Yotsuba's only recent upload is a re-upload of chapter 1.
        unread += [c["id"] for c in keep]
        read += [c["id"] for c in cs[len(keep):]]
        print(title, "keeps", [c["name"] for c in keep], flush=True)
    mark(read, {"isRead": True, "lastPageRead": 1})  # the page save sets lastReadAt, as the reader does
    mark(unread, {"isRead": False})
    mark([by[t][0]["id"] for t in BOOKMARK if t in by], {"isBookmarked": True})
    cid = by[DOWNLOAD][0]["id"] if DOWNLOAD in by else None
    downloaded = lambda: api("chapter.list", {"ids": [cid]})["chapters"][0]["isDownloaded"]
    if cid and not downloaded():
        api("download.enqueue", {"ids": [cid]})  # an enqueue starts the downloader
        for _ in range(60):
            if downloaded():
                break
            time.sleep(2)
    print(len(unread), "unread updates,", len(read), "read")


if len(sys.argv) != 2 or sys.argv[1] not in ("A", "B", "C", "D", "finish"):
    sys.exit("usage: seed.py <A|B|C|D|finish>")
finish() if sys.argv[1] == "finish" else stage(sys.argv[1])
