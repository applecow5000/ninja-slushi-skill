#!/usr/bin/env python3
"""Stage 1: turn the raw r/ninjaslushi dump into clean, thread-reconstructed,
bucketed digests ready for semantic extraction.

Reads:  data/submissions.ndjson, data/comments.ndjson
Writes: data/threads.jsonl              (all clean threads, structured)
        data/digest/<bucket>.txt        (LLM/human-readable per bucket)

Filtering rationale (see repo discussion):
- score is a near-useless signal on a small sub -> not used to filter
- flair is the strongest prior but doubled (emoji vs plain) -> normalized
- empty selftext != noise (recipes live in title+image) -> kept
- comments carry the answers -> threads reconstructed via link_id
"""
import json, os, re, collections

ROOT = os.path.join(os.path.dirname(__file__), "..")
DATA = os.path.join(ROOT, "data")
DIGEST = os.path.join(DATA, "digest")
os.makedirs(DIGEST, exist_ok=True)

DEAD = {"[removed]", "[deleted]", "", None}

def norm_flair(f):
    """Strip emoji/punctuation/case -> canonical bucket key."""
    if not f:
        return "none"
    t = re.sub(r"[^a-z0-9() ]", "", f.lower()).strip()
    t = re.sub(r"\s+", " ", t)
    if "recipe" in t:
        return "recipe"
    if "troubleshooting" in t and "machine" in t:
        return "troubleshooting-machine"
    if "troubleshooting" in t:
        return "troubleshooting-slushi"
    if "review" in t:
        return "review"
    if "stock" in t:
        return "stock-alert"
    if "question" in t:
        return "question"
    return "none"

# keyword routing for the large unflaired pile
RECIPE_KW = re.compile(r"\b(recipe|oz|cups?|tbsp|tsp|ml|ratio|mix|syrup|juice|"
                       r"vodka|rum|tequila|wine|margarita|slush|puree|sugar)\b", re.I)
TROUBLE_KW = re.compile(r"\b(leak|leaking|won'?t|wont|not (freez|slush|work|dispens)|"
                        r"error|broken|stuck|noise|loud|auger|drip|watery|frozen solid|"
                        r"warranty|replace|fix|problem|issue)\b", re.I)

def route_unflaired(title, body):
    text = f"{title} {body}"
    if TROUBLE_KW.search(text):
        return "troubleshooting-slushi"
    if RECIPE_KW.search(text):
        return "recipe"
    return "question"

def main():
    subs = [json.loads(l) for l in open(os.path.join(DATA, "submissions.ndjson"))]
    coms = [json.loads(l) for l in open(os.path.join(DATA, "comments.ndjson"))]

    # index comments by parent submission (link_id = "t3_<id>")
    by_link = collections.defaultdict(list)
    for c in coms:
        if c.get("body") in DEAD:
            continue
        link = (c.get("link_id") or "").replace("t3_", "")
        by_link[link].append(c)

    threads, buckets = [], collections.Counter()
    dropped = collections.Counter()
    fh = open(os.path.join(DATA, "threads.jsonl"), "w")

    for s in subs:
        bucket = norm_flair(s.get("link_flair_text"))
        if bucket == "stock-alert":
            dropped["stock-alert"] += 1
            continue
        title = (s.get("title") or "").strip()
        body = s.get("selftext")
        body = "" if body in DEAD else body.strip()
        author = s.get("author")
        cmts = sorted(by_link.get(s["id"], []),
                      key=lambda c: c.get("score", 0), reverse=True)
        # drop only if there is genuinely nothing to learn from
        if not title and not body and not cmts:
            dropped["empty"] += 1
            continue
        if author in DEAD and not body and not cmts:
            dropped["deleted-author-empty"] += 1
            continue
        if bucket == "none":
            bucket = route_unflaired(title, body)
        rec = {
            "id": s["id"],
            "bucket": bucket,
            "title": title,
            "body": body,
            "author": author if author not in DEAD else None,
            "score": s.get("score", 0),
            "flair_raw": s.get("link_flair_text"),
            "created_utc": s.get("created_utc"),
            "permalink": "https://reddit.com" + s.get("permalink", ""),
            "num_comments": len(cmts),
            "comments": [
                {"author": c.get("author"), "score": c.get("score", 0),
                 "body": c.get("body", "").strip()}
                for c in cmts[:15]  # top 15 by score is plenty
            ],
        }
        threads.append(rec)
        buckets[bucket] += 1
        fh.write(json.dumps(rec) + "\n")
    fh.close()

    # write readable per-bucket digests
    order = ["recipe", "troubleshooting-slushi", "troubleshooting-machine",
             "review", "question"]
    for b in order:
        recs = [t for t in threads if t["bucket"] == b]
        recs.sort(key=lambda t: (t["score"], t["num_comments"]), reverse=True)
        with open(os.path.join(DIGEST, f"{b}.txt"), "w") as out:
            out.write(f"# r/ninjaslushi digest — bucket: {b} ({len(recs)} threads)\n\n")
            for t in recs:
                out.write(f"{'='*70}\n")
                out.write(f"TITLE: {t['title']}\n")
                if t["flair_raw"]:
                    out.write(f"FLAIR: {t['flair_raw']}  SCORE: {t['score']}  "
                              f"URL: {t['permalink']}\n")
                if t["body"]:
                    out.write(f"POST:\n{t['body']}\n")
                if t["comments"]:
                    out.write("COMMENTS (top by score):\n")
                    for c in t["comments"]:
                        out.write(f"  - [{c['score']}] {c['body']}\n")
                out.write("\n")

    print("kept threads:", len(threads))
    print("buckets:", dict(buckets))
    print("dropped:", dict(dropped))
    print("digests written to data/digest/")

if __name__ == "__main__":
    main()
