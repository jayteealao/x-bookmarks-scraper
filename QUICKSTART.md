# Quick Start Guide

## Installation

```bash
# 1. Install dependencies
npm install

# 2. Install Playwright Chrome
npx playwright install chromium
```

## First Run: Discovery Mode

```bash
npm run discover
```

What happens:
1. Chrome opens and navigates to X Bookmarks
2. If not logged in, **log in manually in the browser**
3. Press Enter in the terminal to continue
4. The script scrolls a bit and captures some GraphQL responses
5. Results saved to `out/discovery.jsonl`

Check the output:
```bash
cat out/discovery.jsonl | head -1 | jq
```

## Second Run: Full Extraction

```bash
npm run extract
```

What happens:
1. Chrome opens (already logged in from last time)
2. Scrolls through ALL bookmarks automatically
3. Captures and parses all data
4. Saves to multiple JSONL files in `out/`

Check the results:
```bash
# Count tweets
wc -l out/tweetEntity.jsonl

# View first tweet
head -1 out/tweetEntity.jsonl | jq

# View summary report
cat out/report.json | jq
```

## Verify Capture

```bash
npm run verify
```

Compares HAR recording vs live capture to ensure completeness.

## Common Options

```bash
# Test with limited scrolls (faster)
npm run extract -- --max-scrolls=10

# Run in headless mode (no browser window)
npm run extract -- --headless

# Slower scrolling (more reliable)
npm run extract -- --scroll-delay=2000
```

## Output Files

After extraction, you'll have:

```
out/
├── tweetEntity.jsonl              ← All bookmarked tweets
├── twitterUser.jsonl              ← User profiles
├── tweetPublicMetrics.jsonl       ← Engagement stats
├── tweetMedia.jsonl               ← Photos/videos
├── tweetIncludes.jsonl            ← Relationships
├── tweetTextEntityAnnotation.jsonl ← URLs/hashtags/mentions
├── mediaKeys.jsonl                ← Media mappings
├── referencedTweets_byTweet.jsonl ← Quotes/replies/retweets
├── report.json                    ← Summary stats
└── x-bookmarks.har.zip            ← Raw network capture
```

## Importing to Room Database

The JSONL files can be directly imported into an Android Room database using the matching entity schemas. Each line is a complete JSON object for one row.

Example import (pseudo-code):
```kotlin
File("tweetEntity.jsonl").forEachLine { line ->
    val tweet = Json.decodeFromString<TweetEntity>(line)
    db.tweetDao().insert(tweet)
}
```

## Troubleshooting

**Problem**: "Not logged in" message
- **Solution**: Log in manually when the browser opens, then press Enter

**Problem**: No bookmarks found
- **Solution**: Make sure you actually have bookmarks on X, check `out/discovery.jsonl`

**Problem**: Parse errors in report
- **Solution**: X may have changed their API, check `out/report.json` for details

**Problem**: Browser crashes
- **Solution**: Use `--max-scrolls=100` to limit scrolling, or increase `--scroll-delay=2000`

## Tips

- First login will be slow (manual), but subsequent runs reuse the saved session
- Discovery mode is quick (~30 seconds), extraction can take 5-20 minutes for 1000+ bookmarks
- All data is local, nothing is sent to any server
- HAR files contain your cookies, don't share them
- If X changes their API, run discovery mode first to see the new structure
