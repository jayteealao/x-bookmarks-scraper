/**
 * Room Entity Types for X Bookmarks
 * These correspond to the Kotlin Room entities
 */

export interface TweetEntity {
  tweetId: string;
  authorId: string;
  createdAt: string;
  text: string;
  conversationId?: string;
  inReplyToUserId?: string;
  lang?: string;
  source?: string;
  order: number; // encounter order
}

export interface TwitterUserEntity {
  userId: string;
  username: string;
  name: string;
  description?: string;
  profileImageUrl?: string;
  verified?: boolean;
  followersCount?: number;
  followingCount?: number;
  tweetCount?: number;
  listedCount?: number;
  createdAt?: string;
  location?: string;
  url?: string;
  pinnedTweetId?: string;
}

export interface TweetPublicMetrics {
  tweetId: string;
  retweetCount: number;
  replyCount: number;
  likeCount: number;
  quoteCount: number;
  bookmarkCount?: number;
  impressionCount?: number;
}

export interface TweetMediaEntity {
  mediaKey: string;
  type: string; // photo, video, animated_gif
  url?: string;
  previewImageUrl?: string;
  width?: number;
  height?: number;
  durationMs?: number;
  altText?: string;
}

export interface TweetIncludesEntity {
  tweetId: string;
  mediaKey?: string;
  referencedTweetId?: string;
  userId?: string; // for mentions
}

export interface TweetTextEntityAnnotation {
  tweetId: string;
  type: string; // url, hashtag, mention, cashtag
  start: number;
  end: number;
  tag?: string;
  url?: string;
  expandedUrl?: string;
  displayUrl?: string;
  unwoundUrl?: string;
  userId?: string; // for mentions
  username?: string; // for mentions
}

export interface MediaKeys {
  mediaKey: string;
  tweetId: string;
}

// Note: TweetReferencedTweets Room entity doesn't include tweetId
// So we use a custom format for export
export interface ReferencedTweetsByTweet {
  tweetId: string;
  refs: Array<{
    type: string; // retweeted, quoted, replied_to
    id: string;
  }>;
}

// Discovery output
export interface DiscoveryEntry {
  url: string;
  timestamp: string;
  operationName?: string;
  topLevelKeys: string[];
  dataKeys: string[];
  hasTimeline: boolean;
  timelinePath?: string;
  sampleEntryTypes?: string[];
  error?: string;
}

// Report output
export interface ExtractionReport {
  timestamp: string;
  totalGraphQLResponses: number;
  uniqueTweets: number;
  uniqueUsers: number;
  uniqueMedia: number;
  totalIncludes: number;
  totalAnnotations: number;
  totalMetrics: number;
  parseErrors: number;
  sampleErrors: Array<{
    url: string;
    error: string;
  }>;
}
