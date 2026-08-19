#!/usr/bin/env python3
"""Pull the entire r/ninjaslushi dump from pullpush.io (Pushshift successor).

Paginates backwards in time via the `before` cursor. Writes newline-delimited
JSON to data/submissions.ndjson and data/comments.ndjson. Resumable and
deduplicated by id.
"""
import json, os, sys, time, urllib.request, urllib.error

SUB = "ninjaslushi"
OUT = os.path.join(os.path.dirname(__file__), "..", "data")
os.makedirs(OUT, exist_ok=True)
UA = "ninjaslushi-skill-archiver/1.0 (personal use)"

def fetch(kind, before):
    url = (f"https://api.pullpush.io/reddit/search/{kind}/"
           f"?subreddit={SUB}&size=100&sort=desc&sort_type=created_utc")
    if before:
        url += f"&before={before}"
    for attempt in range(6):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read()).get("data", [])
        except urllib.error.HTTPError as e:
            wait = 5 * (attempt + 1)
            print(f"  HTTP {e.code}, backoff {wait}s", flush=True)
            time.sleep(wait)
        except Exception as e:
            wait = 5 * (attempt + 1)
            print(f"  err {e}, backoff {wait}s", flush=True)
            time.sleep(wait)
    return []

def pull(kind, fname):
    path = os.path.join(OUT, fname)
    seen = set()
    # resume: load existing ids + find oldest created_utc as starting cursor
    before = None
    if os.path.exists(path):
        with open(path) as f:
            for line in f:
                try:
                    o = json.loads(line)
                    seen.add(o["id"])
                    c = int(o["created_utc"])
                    before = c if before is None else min(before, c)
                except Exception:
                    pass
        print(f"[{kind}] resuming: {len(seen)} already saved, before={before}", flush=True)
    out = open(path, "a")
    total = len(seen)
    page = 0
    while True:
        data = fetch(kind, before)
        if not data:
            break
        new = 0
        oldest = before
        for o in data:
            oid = o.get("id")
            c = o.get("created_utc")
            if c is None:
                continue
            c = int(c)
            oldest = c if oldest is None else min(oldest, c)
            if oid in seen:
                continue
            seen.add(oid)
            out.write(json.dumps(o) + "\n")
            new += 1
        out.flush()
        total += new
        page += 1
        print(f"[{kind}] page {page}: +{new} (total {total}), cursor→{oldest}", flush=True)
        if oldest == before and new == 0:
            break  # no progress
        before = oldest
        time.sleep(1.2)  # be polite to pullpush
    out.close()
    print(f"[{kind}] DONE: {total} records -> {path}", flush=True)
    return total

if __name__ == "__main__":
    kinds = sys.argv[1:] or ["submission", "comment"]
    for k in kinds:
        pull(k, f"{k}s.ndjson")
