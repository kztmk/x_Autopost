export interface XAuthInfo {
  accountId: string;
  apiKey: string;
  apiKeySecret: string;
  accessToken: string;
  accessTokenSecret: string;
  note?: string; // 任意のメモフィールド
}

export interface XPostData {
  id?: string;
  createdAt?: string;
  postSchedule?: string;
  postTo?: string;
  contents?: string;
  mediaUrls?: string; // Changed from media
  inReplyToInternal?: string;
  postId?: string;
  inReplyToOnX?: string;
  quoteId?: string; // Added
  repostTargetId?: string; // Added
}

export interface XPostedData extends XPostData {
  postedAt: string;
}

export interface TriggerProps {
  intervalMinuts: number;
}

export interface PostError {
  timestamp: string;
  context: string;
  message: string;
  stack: string;
}

export interface PostScheduleUpdate {
  id: string;
  postSchedule: string; // ISO 8601 形式の文字列などを期待
}

export interface UpdateResult {
  id: string;
  status: "updated" | "not_found" | "error";
  postSchedule: string;
  message?: string;
}

export interface UpdateInReplyToResult {
  id: string;
  status: "updated" | "not_found" | "error";
  inReplyToInternal: string;
  message?: string;
}

export interface PostDeletion {
  id: string; // ID of the post to delete, or "all"
  postTo?: string; // Required if id is "all", specifies which account/platform's posts to delete
}

export interface DeleteResult {
  id: string;
  status: "deleted" | "not_found" | "error";
  message?: string;
}

export interface XPostDataInput {
  postTo: string;
  contents: string;
  mediaUrls?: string; // Changed from media
  postSchedule?: string; // 文字列形式を期待 (ISO 8601など)
  inReplytoInternal?: string;
  postId?: string;
  inReplyToOnX?: string;
  quoteId?: string; // Added
  repostTargetId?: string; // Added
}

export const SHEETS = {
  POSTS: "Posts",
  POSTED: "Posted",
  ERRORS: "Errors",
  XAUTH: "XAuth",
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
  XAUTH_HEADERS: [
    "accountId",
    "userId", // Add userId
    "apiKey",
    "apiKeySecret",
    "accessToken",
    "accessTokenSecret",
    "note",
  ] as const,
} as const;

// Combine HEADERS and MAIN_HEADERS concept if MAIN_HEADERS only contained POSTED_HEADERS
// Or define MAIN_HEADERS separately if it has a different structure/purpose
export const MAIN_HEADERS = {
  POSTED_HEADERS: HEADERS.POSTED_HEADERS, // Alias or re-export if needed elsewhere
} as const;

// Type for header map
export type HeaderMap = { [key: string]: number };
