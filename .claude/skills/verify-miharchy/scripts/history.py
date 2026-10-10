#!/usr/bin/env python3
"""Stamp chapters read at chosen times on the scratch server, through a restored backup.

  history.py <chapterId>=<YYYY-MM-DDTHH:MM> ...   (local time)

Suwayomi sets lastReadAt only on a lastPageRead save, at the server's clock. A
backup's BackupHistory carries its own time, so this builds a minimal .tachibk
(each named chapter read, with a history entry at its time) and restores it,
as a sync restores the phone's history. Prints each chapter's isRead and
lastReadAt read back.
"""
import datetime
import gzip
import json
import os
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def gql(query, variables=None):
    out = subprocess.run([os.path.join(HERE, "gql.sh"), query, json.dumps(variables or {})], check=True, capture_output=True, text=True).stdout
    reply = json.loads(out)
    if reply.get("errors"):
        sys.exit("graphql: " + json.dumps(reply["errors"]))
    return reply["data"]


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def field(number, value):
    if isinstance(value, bool):
        return varint(number << 3) + varint(int(value))
    if isinstance(value, int):
        return varint(number << 3) + varint(value)
    data = value.encode() if isinstance(value, str) else value
    return varint(number << 3 | 2) + varint(len(data)) + data


def backup(manga):
    # Numbers from sync/src/main/kotlin/eu/kanade/tachiyomi/data/backup/models.
    out = b""
    for m in manga:
        body = field(1, int(m["sourceId"])) + field(2, m["url"]) + field(3, m["title"]) + field(100, True)
        for c in m["chapters"]:
            body += field(16, field(1, c["url"]) + field(2, c["name"]) + field(4, True) + field(10, c["sourceOrder"]))
        for c in m["chapters"]:
            body += field(104, field(1, c["url"]) + field(2, c["at"] * 1000))
        out += field(1, body)
    return gzip.compress(out)


def main(args):
    times = {}
    for a in args:
        cid, at = a.split("=", 1)
        times[int(cid)] = int(datetime.datetime.fromisoformat(at).timestamp())
    if not times:
        sys.exit(__doc__)
    nodes = gql("query($ids: [Int!]) { chapters(filter: { id: { in: $ids } }) { nodes { id url name sourceOrder manga { id url sourceId title } } } }", {"ids": list(times)})["chapters"]["nodes"]
    manga = {}
    for c in nodes:
        m = manga.setdefault(c["manga"]["id"], dict(c["manga"], chapters=[]))
        m["chapters"].append(dict(c, at=times[c["id"]]))
    with tempfile.NamedTemporaryFile(suffix=".tachibk", delete=False) as f:
        f.write(backup(manga.values()))
    token = subprocess.run(["bash", "-c", 'source "$1/env.sh" && token && echo "$PORT"', "sh", HERE], check=True, capture_output=True, text=True).stdout.split()
    query = "mutation($backup: Upload!) { restoreBackup(input: { backup: $backup, flags: { includeManga: true, includeChapters: true, includeHistory: true, includeCategories: false, includeTracking: false, includeClientData: false, includeServerSettings: false } }) { id } }"
    out = subprocess.run(["curl", "-s", "-m", "60", "-H", "Authorization: Bearer " + token[0],
                          "-F", "operations=" + json.dumps({"query": query, "variables": {"backup": None}}),
                          "-F", 'map={"0": ["variables.backup"]}', "-F", "0=@" + f.name,
                          "http://127.0.0.1:%s/api/graphql" % token[1]], check=True, capture_output=True, text=True).stdout
    os.unlink(f.name)
    rid = json.loads(out)["data"]["restoreBackup"]["id"]
    for _ in range(120):
        state = gql("query($id: String!) { restoreStatus(id: $id) { state } }", {"id": rid})["restoreStatus"]["state"]
        if state in ("SUCCESS", "FAILURE"):
            break
        time.sleep(0.5)
    print("restore", state)
    for c in gql("query($ids: [Int!]) { chapters(filter: { id: { in: $ids } }) { nodes { id isRead lastReadAt } } }", {"ids": list(times)})["chapters"]["nodes"]:
        at = int(c["lastReadAt"])
        print(c["id"], "read" if c["isRead"] else "unread", at, datetime.datetime.fromtimestamp(at).isoformat(timespec="minutes"), "ok" if at == times[c["id"]] else "WANTED " + str(times[c["id"]]))


main(sys.argv[1:])
