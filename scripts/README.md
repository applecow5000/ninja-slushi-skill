# Data scripts

## `pull_dump.py` — archive the entire r/ninjaslushi subreddit

Pulls **all** submissions and comments for r/ninjaslushi from
[pullpush.io](https://pullpush.io) (the community-run successor to Pushshift,
whose own public API was shut down after Reddit's 2023 API changes).

### Run

```bash
python3 scripts/pull_dump.py                 # both submissions + comments
python3 scripts/pull_dump.py submission      # just submissions
python3 scripts/pull_dump.py comment         # just comments
```

Output (newline-delimited JSON, one raw record per line):

```
data/submissions.ndjson
data/comments.ndjson
```

### How it works / re-running

- Paginates backwards in time using pullpush's `before=<epoch>` cursor, 100
  records per request, sorted `desc` by `created_utc`.
- **Resumable & incremental:** on start it reads any existing `.ndjson`, loads
  the ids already saved, and continues from the oldest record. Re-running appends
  only new-to-the-file records (dedup by `id`) — safe to run repeatedly.
- **To refresh with the latest posts:** because it resumes from the *oldest*
  cursor and walks further back, a plain re-run backfills history. To also grab
  posts newer than your last pull, delete the `data/*.ndjson` files and run a
  full fresh pull, or run periodically and let it repopulate.
- Handles HTTP 429 / transient errors with exponential backoff and sleeps ~1.2s
  between pages to stay polite to pullpush.

### Notes

- No API key required. pullpush is a free community service — don't hammer it.
- Records are the raw Reddit API objects as archived by pullpush (fields like
  `title`, `selftext`, `body`, `score`, `created_utc`, `author`, `permalink`,
  `link_flair_text`, etc.).
- `data/` holds the raw dump; the distilled community knowledge for the skill
  lives in `references/`.
