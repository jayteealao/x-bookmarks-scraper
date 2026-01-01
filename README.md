# X Bookmarks Scraper

A local exporter for X (Twitter) Bookmarks that bypasses API rate limits by using Playwright to drive a logged-in Chrome session, scroll through Bookmarks, and capture the underlying GraphQL JSON responses.

## Features

- 🔐 **Persistent Authentication**: Uses a persistent Chrome profile to maintain login across runs
- 📊 **Dual Capture**: Records data via both HAR files and live response interception
- 🔍 **Shape Discovery**: Analyzes GraphQL response structure before extraction
- 🛡️ **Defensive Parsing**: Handles payload shape changes gracefully
- 📁 **Room Entity Export**: Outputs JSONL files compatible with Android Room database
- 📈 **Progress Tracking**: Real-time feedback on extraction progress
- ✅ **Verification**: Compare HAR recordings against live capture

## Prerequisites

- Node.js 20+
- Chrome browser installed
- An X (Twitter) account with bookmarks

## Installation

```bash
# Install dependencies
npm install

# Install Playwright browsers
npx playwright install chromium
```

## Usage

### Phase 1: Discovery Mode

First run discovers the GraphQL response structure:

```bash
npm run discover
```

This will:
1. Open Chrome and navigate to your bookmarks
2. Capture GraphQL responses
3. Analyze their structure
4. Output findings to `out/discovery.jsonl`
5. Record network traffic to `out/x-bookmarks.har.zip`

**Important**: If not logged in, the browser will pause and wait for you to log in manually. After logging in, press Enter in the terminal to continue.

### Phase 2: Extraction Mode

Extract all bookmarks to JSONL files:

```bash
npm run extract
```

This will:
1. Scroll through all bookmarks (auto-stops when no new bookmarks appear)
2. Capture and parse GraphQL responses
3. Export data to multiple JSONL files in `out/`
4. Generate a summary report

### Verification

Compare HAR recording against live capture:

```bash
npm run verify
```

## Output Files

### Discovery Mode

- `out/discovery.jsonl` - GraphQL response structure analysis
- `out/x-bookmarks.har.zip` - Network traffic recording

### Extraction Mode

All files are in JSONL format (one JSON object per line):

- `out/tweetEntity.jsonl` - Tweet data (id, text, author, timestamps)
- `out/twitterUser.jsonl` - User profiles
- `out/tweetPublicMetrics.jsonl` - Engagement metrics (likes, retweets, etc.)
- `out/tweetMedia.jsonl` - Media attachments (photos, videos)
- `out/tweetIncludes.jsonl` - Relationships (tweet-media, tweet-user mentions)
- `out/tweetTextEntityAnnotation.jsonl` - Text entities (URLs, hashtags, mentions)
- `out/mediaKeys.jsonl` - Media key to tweet mappings
- `out/referencedTweets_byTweet.jsonl` - Referenced tweets (replies, quotes, retweets)
- `out/report.json` - Extraction summary with stats
- `out/x-bookmarks.har.zip` - Network traffic recording

## Room Entity Schema

The exported JSONL files map to these Room entities:

### TweetEntity
```typescript
{
  tweetId: string
  authorId: string
  createdAt: string
  text: string
  conversationId?: string
  inReplyToUserId?: string
  lang?: string
  source?: string
  order: number  // encounter order in bookmarks
}
```

### TwitterUserEntity
```typescript
{
  userId: string
  username: string
  name: string
  description?: string
  profileImageUrl?: string
  verified?: boolean
  followersCount?: number
  followingCount?: number
  tweetCount?: number
  listedCount?: number
  createdAt?: string
  location?: string
  url?: string
  pinnedTweetId?: string
}
```

### TweetPublicMetrics
```typescript
{
  tweetId: string
  retweetCount: number
  replyCount: number
  likeCount: number
  quoteCount: number
  bookmarkCount?: number
  impressionCount?: number
}
```

### TweetMediaEntity
```typescript
{
  mediaKey: string
  type: string  // photo, video, animated_gif
  url?: string
  previewImageUrl?: string
  width?: number
  height?: number
  durationMs?: number
  altText?: string
}
```

### TweetIncludesEntity
```typescript
{
  tweetId: string
  mediaKey?: string
  referencedTweetId?: string
  userId?: string  // for mentions
}
```

### TweetTextEntityAnnotation
```typescript
{
  tweetId: string
  type: string  // url, hashtag, mention, cashtag
  start: number
  end: number
  tag?: string
  url?: string
  expandedUrl?: string
  displayUrl?: string
  unwoundUrl?: string
  userId?: string
  username?: string
}
```

## CLI Options

```bash
npm run extract -- [options]
```

Options:
- `--mode=<discover|extract>` - Set capture mode (default: extract)
- `--headless` - Run browser in headless mode (default: false)
- `--max-scrolls=<number>` - Maximum scrolls (default: 1000)
- `--scroll-delay=<ms>` - Delay between scrolls (default: 1000)
- `--no-growth-threshold=<n>` - Stop after N scrolls with no new bookmarks (default: 6)
- `--profile-dir=<path>` - Chrome profile directory (default: ./x-profile)

Examples:

```bash
# Run extraction in headless mode
npm run extract -- --headless

# Limit to 50 scrolls for testing
npm run extract -- --max-scrolls=50

# Use custom profile directory
npm run extract -- --profile-dir=/path/to/profile

# Faster scrolling (caution: may miss data)
npm run extract -- --scroll-delay=500
```

## How It Works

### 1. Browser Automation
- Launches Chrome with a persistent context (maintains cookies between runs)
- Navigates to `https://x.com/i/bookmarks`
- Detects login state and prompts user if needed

### 2. Data Capture
- **HAR Recording**: Records all GraphQL requests at the browser context level
- **Live Interception**: Captures response bodies via `page.on("response")` event
- Filters to `/i/api/graphql/` endpoints
- Parses JSON responses in real-time

### 3. Scrolling Strategy
- Scrolls by ~2 viewports at a time
- Tracks unique tweet IDs to measure progress
- Stops when no new bookmarks appear for 6 consecutive scrolls
- Random delays (800-1200ms) to avoid rate limiting

### 4. Data Mapping
- Extracts timeline entries from GraphQL responses
- Unwraps nested tweet result structures
- Handles tombstones (deleted/unavailable tweets)
- Deduplicates entities across responses
- Maintains encounter order for tweets

### 5. Defensive Parsing
- Tries multiple known GraphQL response paths
- Gracefully handles missing fields
- Logs parse errors without crashing
- Continues extraction even if some responses fail

## Troubleshooting

### "Not logged in" message
- The browser will stay open - log in manually
- After logging in, press Enter in the terminal to continue
- Your session will be saved in `./x-profile` for future runs

### No bookmarks extracted
- Check `out/discovery.jsonl` to see what responses were captured
- X may have changed their GraphQL API structure
- Check `out/report.json` for parse errors

### HAR file is empty or small
- Ensure you're scrolling enough to load bookmarks
- Check that GraphQL responses are actually being made
- Try running in non-headless mode to observe the browser

### Browser crashes or hangs
- Reduce scroll speed with `--scroll-delay=2000`
- Lower max scrolls with `--max-scrolls=100`
- Check Chrome console for errors

### Rate limiting
- Increase `--scroll-delay` to 2000ms or higher
- The scraper uses random delays to appear more human-like
- If blocked, wait a few hours before trying again

## Project Structure

```
x-bookmarks-scraper/
├── src/
│   ├── index.ts                 # CLI entry point
│   ├── bookmarks-capture.ts     # Playwright runner
│   ├── shape-discovery.ts       # GraphQL response analyzer
│   ├── mapper.ts                # GraphQL to Room entity mapper
│   ├── verify-har.ts            # HAR verification script
│   └── types.ts                 # TypeScript type definitions
├── out/                         # Output directory (generated)
├── x-profile/                   # Chrome profile (generated)
├── package.json
├── tsconfig.json
└── README.md
```

## Development

```bash
# Build TypeScript
npm run build

# Run with tsx (no build needed)
npm run dev -- --mode=discover
```

## Security & Privacy

- All data stays local on your machine
- Login credentials are stored in the Chrome profile directory
- No data is sent to any third-party servers
- HAR files may contain cookies - do not share them publicly

## Limitations

- Only captures bookmarks visible in the timeline (X's GraphQL API controls this)
- Cannot capture bookmarks that fail to load
- Subject to X's rate limiting
- May break if X significantly changes their GraphQL API structure

## License

MIT

## Disclaimer

This tool is for personal use only. Respect X's Terms of Service. Use responsibly and don't abuse rate limits.
