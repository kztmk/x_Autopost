export const SHEETS = {
  POSTS: "Posts",
  POST_QUEUE: "Posts", // Alias for POSTS
  POSTED: "Posted",
  ERRORS: "Errors",
  ERROR_LOG: "Errors", // Alias for ERRORS
  // Add other sheet names if needed
} as const;

export const HEADERS = {
  POST_HEADERS: [
    "id", // 0
    "createdAt", // 1
    "postTo", // 2
    "contents", // 3
    "mediaUrls", // 4
    "postSchedule", // 5
    "inReplyToInternal", // 6
    "postId", // 7 (Posted X ID or ERROR or Reposted:...)
    "inReplyToOnX", // 8 (Posted X Reply ID)
    "quoteId", // 9 (Posted X Quote ID)
    "repostTargetId", // 10 (Repost Target X ID)
    "status", // 11 (Added status field: 'queued', 'posted', 'failed', etc.)
    "errorMessage", // 12 (Error message if status is 'failed')
  ] as const,

  // Alias for POST_HEADERS to maintain consistency
  POST_QUEUE_HEADERS: [
    "id",
    "createdAt",
    "postTo",
    "contents",
    "mediaUrls",
    "postSchedule",
    "inReplyToInternal",
    "postId",
    "inReplyToOnX",
    "quoteId",
    "repostTargetId",
    "status",
    "errorMessage",
  ] as const,

  POSTED_HEADERS: [
    "id",
    "createdAt",
    "postedAt", // Added
    "postTo",
    "contents",
    "mediaUrls",
    "postSchedule",
    "inReplyToInternal",
    "postId", // Posted X ID or Reposted:...
    "inReplyToOnX", // Posted X Reply ID
    "quoteId", // Posted X Quote ID
    // repostTargetId is not typically moved directly, postId indicates repost
  ] as const,

  ERROR_HEADERS: ["timestamp", "context", "message", "stack"] as const,

  // Alias for ERROR_HEADERS
  ERROR_LOG_HEADERS: ["timestamp", "context", "message", "stack"] as const,
} as const;

// Combine HEADERS and MAIN_HEADERS concept if MAIN_HEADERS only contained POSTED_HEADERS
// Or define MAIN_HEADERS separately if it has a different structure/purpose
export const MAIN_HEADERS = {
  POSTED_HEADERS: HEADERS.POSTED_HEADERS, // Alias or re-export if needed elsewhere
  POST_HEADERS: HEADERS.POST_HEADERS,
} as const;
